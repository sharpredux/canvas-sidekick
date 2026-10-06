import { app, BrowserWindow, ipcMain, session, safeStorage, net, powerMonitor, screen, shell } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { applyLinuxDesktopHints, getLinuxStartupStatus, setLinuxStartupStatus } from './linux.js';
import { normalizeSettings, mergeSettings, getWindowSize, fitWindowBounds } from './widgetPreferences.js';
import { fetchPaginatedCanvasData as fetchCanvasPages, mapCanvasTasks } from './canvasTasks.js';
import { applyWidgetWindowShape } from './windowShape.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow = null;
let koffiInstance = null;
let user32 = null;
let SetParentFn = null;
let FindWindowW = null;
let FindWindowExW = null;
let SendMessageTimeoutW = null;
let EnumWindowsProc = null;
let EnumWindows = null;

async function initWin32() {
  if (process.platform !== 'win32') return false;
  if (user32) return true;
  try {
    koffiInstance = (await import('koffi')).default;
    user32 = koffiInstance.load('user32.dll');
    SetParentFn         = user32.func('void *SetParent(void *hWndChild, void *hWndNewParent)');
    FindWindowW         = user32.func('void *FindWindowW(str16 lpClassName, str16 *lpWindowName)');
    FindWindowExW       = user32.func('void *FindWindowExW(void *hWndParent, void *hWndChildAfter, str16 lpszClass, str16 *lpszWindow)');
    SendMessageTimeoutW = user32.func('intptr_t SendMessageTimeoutW(void *hWnd, uint32_t Msg, intptr_t wParam, intptr_t lParam, uint32_t fuFlags, uint32_t uTimeout, intptr_t *lpdwResult)');
    EnumWindowsProc     = koffiInstance.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lParam)');
    EnumWindows         = user32.func('bool EnumWindows(EnumWindowsProc *lpEnumFunc, intptr_t lParam)');
    return true;
  } catch (err) {
    console.error('[desktop] Failed to load Win32 functions:', err);
    return false;
  }
}

/**
 * Embeds the Electron window into the Windows desktop shell layer (WorkerW),
 * making it render below all apps but above the wallpaper — exactly like Rainmeter.
 */
async function embedInDesktop(windowInstance) {
  if (process.platform === 'linux') {
    applyLinuxDesktopHints(windowInstance);
    return;
  }
  if (process.platform !== 'win32') return;
  try {
    const initialized = await initWin32();
    if (!initialized) return;

    // 1. Find Progman (the desktop background window)
    const progman = FindWindowW('Progman', null);
    if (!progman) { console.warn('[desktop] Could not find Progman'); return; }

    // 2. Send magic 0x052C message to force Windows to spawn a WorkerW layer
    const msgResult = [BigInt(0)];
    SendMessageTimeoutW(progman, 0x052C, 0, 0, 0x0002 /* SMTO_ABORTIFHUNG */, 1000, msgResult);

    // 3. Enumerate all top-level windows to find the WorkerW that sits BEHIND desktop icons
    let workerW = null;
    const cb = koffiInstance.register((hwnd) => {
      // Check if this window has a SHELLDLL_DefView child (that's the icon layer)
      const shellView = FindWindowExW(hwnd, null, 'SHELLDLL_DefView', null);
      if (shellView) {
        // The WorkerW AFTER this window in Z-order is the one behind icons
        workerW = FindWindowExW(null, hwnd, 'WorkerW', null);
        return false; // Stop enumeration
      }
      return true; // Continue
    }, koffiInstance.pointer(EnumWindowsProc));

    EnumWindows(cb, 0);
    koffiInstance.unregister(cb);

    if (!workerW) { console.warn('[desktop] Could not find WorkerW — falling back'); return; }

    // 4. Parent our Electron HWND into WorkerW
    const hwndBuffer = windowInstance.getNativeWindowHandle();
    SetParentFn(hwndBuffer, workerW);
    console.log('[desktop] Widget embedded into WorkerW ✓');
  } catch (err) {
    console.error('[desktop] embedInDesktop failed:', err);
  }
}

/**
 * Detaches the Electron window from the desktop shell parent.
 */
async function detachFromDesktop(windowInstance) {
  if (process.platform !== 'win32') return;
  if (!windowInstance || windowInstance.isDestroyed()) return;
  try {
    const initialized = await initWin32();
    if (!initialized) return;

    const hwndBuffer = windowInstance.getNativeWindowHandle();
    SetParentFn(hwndBuffer, null);
    console.log('[desktop] Widget detached from WorkerW ✓');
  } catch (err) {
    console.error('[desktop] detachFromDesktop failed:', err);
  }
}

/** Register the app to auto-start when Windows boots. */
function setupAutoLaunch() {
  if (process.platform !== 'win32') return;
  app.setLoginItemSettings({
    openAtLogin: true,
    name: 'Canvas Sidekick'
  });
}

function decodeHtmlEntities(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&lsquo;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// ─── Canvas Fetch (shared by IPC handler + polling loop) ─────────────────────

function fetchPaginatedCanvasData(url, headers) {
  return fetchCanvasPages(url, headers, (target, options) => net.fetch(target, options));
}

async function ensureCookieLoaded(schoolUrl) {
  try {
    const urlObj = new URL(schoolUrl);
    const cookies = await session.defaultSession.cookies.get({
      url: urlObj.origin,
      name: 'canvas_session'
    });

    if (cookies.length === 0) {
      const userDataPath = app.getPath('userData');
      const cookiePath = path.join(userDataPath, 'canvas_cookie');
      if (fs.existsSync(cookiePath)) {
        const encrypted = fs.readFileSync(cookiePath);
        let sessionCookieValue;
        if (safeStorage.isEncryptionAvailable()) {
          sessionCookieValue = safeStorage.decryptString(encrypted);
        }
        if (sessionCookieValue) {
          await session.defaultSession.cookies.set({
            url: urlObj.origin,
            name: 'canvas_session',
            value: sessionCookieValue,
            domain: urlObj.hostname,
            path: '/',
            secure: true,
            httpOnly: true
          });
          console.log('[session] Loaded canvas_session cookie from disk into Electron session.');
        }
      }
    }
  } catch (err) {
    console.error('[session] Failed to ensure cookie is loaded:', err);
  }
}

async function fetchCanvasDataInternal(schoolUrl, trackedTasks = []) {
  const userDataPath = app.getPath('userData');
  const cookiePath = path.join(userDataPath, 'canvas_cookie');

  if (!fs.existsSync(cookiePath)) {
    throw new Error('no_cookie');
  }

  // Ensure the decrypted cookie is loaded in session.defaultSession
  await ensureCookieLoaded(schoolUrl);

  const headers = {
    'Accept': 'application/json'
  };

  // 1. Fetch upcoming events using pagination
  let eventsData;
  try {
    eventsData = await fetchPaginatedCanvasData(`${schoolUrl}/api/v1/users/self/upcoming_events`, headers);
  } catch (err) {
    if (err.message === 'unauthorized') {
      try { fs.unlinkSync(cookiePath); } catch (e) { console.error(e); }
      try {
        const urlObj = new URL(schoolUrl);
        await session.defaultSession.cookies.remove(urlObj.origin, 'canvas_session');
      } catch (e) { console.error(e); }
      throw err;
    }
    throw err;
  }

  const mappedEvents = await mapCanvasTasks(eventsData, schoolUrl, headers, fetchPaginatedCanvasData, trackedTasks);

  // 3. Fetch active courses to map course IDs to friendly names/codes
  const courseMap = new Map();
  const courseIds = [];
  try {
    const coursesData = await fetchPaginatedCanvasData(`${schoolUrl}/api/v1/courses?enrollment_state=active`, headers);
    if (Array.isArray(coursesData)) {
      coursesData.forEach(c => {
        if (c.id) {
          const contextCode = `course_${c.id}`;
          const displayName = c.course_code || c.name || 'Canvas Course';
          courseMap.set(contextCode, displayName);
          courseIds.push(contextCode);
        }
      });
    }
  } catch (err) {
    console.error('[fetch] Failed to fetch active courses:', err);
  }

  // 4. Fetch announcements (last 14 days)
  let announcements = [];
  if (courseIds.length > 0) {
    try {
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
      const startDateIso = fourteenDaysAgo.toISOString();

      let announcementsUrl = `${schoolUrl}/api/v1/announcements?`;
      courseIds.forEach(id => {
        announcementsUrl += `context_codes[]=${id}&`;
      });
      announcementsUrl += `start_date=${startDateIso}`;

      const annData = await fetchPaginatedCanvasData(announcementsUrl, headers);
      if (Array.isArray(annData)) {
        annData.forEach(ann => {
          const postedDate = new Date(ann.posted_at || ann.created_at);
          if (postedDate >= fourteenDaysAgo) {
            let msg = ann.message || '';
            msg = msg.replace(/<\/?(?:p|div|br|h[1-6]|li|ol|ul)\b[^>]*>/gi, ' ');
            const strippedMessage = msg.replace(/<[^>]*>/g, '').trim();
            const courseName = courseMap.get(ann.context_code) || 'Canvas Course';
            const authorName = ann.user_name || (ann.author && ann.author.display_name) || 'Unknown';
            announcements.push({
              id: ann.id ? ann.id.toString() : Math.random().toString(),
              type: 'announcement',
              title: decodeHtmlEntities(ann.title || 'Announcement'),
              course: courseName,
              date: ann.posted_at || ann.created_at,
              preview: decodeHtmlEntities(strippedMessage),
              author: authorName
            });
          }
        });
      }
    } catch (err) {
      console.error('[fetch] Failed to fetch announcements:', err);
    }
  }

  // 5. Fetch submission comments
  let comments = [];
  try {
    const streamData = await fetchPaginatedCanvasData(`${schoolUrl}/api/v1/users/self/activity_stream`, headers);
    if (Array.isArray(streamData)) {
      streamData.forEach(item => {
        if (item && item.type === 'Submission' && Array.isArray(item.submission_comments)) {
          const contextCode = item.context_code || (item.course_id ? `course_${item.course_id}` : '');
          const courseName = courseMap.get(contextCode) || 'Canvas Course';
          item.submission_comments.forEach(c => {
            comments.push({
              id: c.id ? c.id.toString() : Math.random().toString(),
              type: 'comment',
              title: item.title ? `Feedback on ${item.title}` : 'Feedback on Submission',
              course: courseName,
              date: c.created_at,
              preview: c.comment || '',
              author: c.author_name || 'Unknown'
            });
          });
        }
      });
    }
  } catch (err) {
    console.error('[fetch] Failed to fetch submission comments:', err);
  }

  return [
    ...mappedEvents,
    ...announcements,
    ...comments
  ];
}

// ─── Main Process Polling ─────────────────────────────────────────────────────

let pollingInterval = null;
let lastDataHash    = null;

/**
 * Starts a polling loop in the main process. Only pushes data to the renderer
 * when the Canvas response has actually changed (JSON hash comparison).
 * This eliminates wasteful renderer wake-ups for identical data.
 */
function startPolling(schoolUrl, webContents, trackedTasks = []) {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  lastDataHash = null;

  const tick = async () => {
    if (webContents.isDestroyed()) {
      clearInterval(pollingInterval);
      return;
    }
    try {
      const data = await fetchCanvasDataInternal(schoolUrl, trackedTasks);
      trackedTasks = data;
      
      // --- LOCAL ARCHIVE LOGIC ---
      try {
        const archiveDir = path.join(app.getPath('userData'), 'archive');
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
        const completedTasks = data.filter(e => e.completed && e.type === 'deadline');
        if (completedTasks.length > 0) {
          const tasksByDate = {};
          completedTasks.forEach(task => {
            if (!task.dueDate) return;
            const dateStr = new Date(task.dueDate).toISOString().split('T')[0];
            if (!tasksByDate[dateStr]) tasksByDate[dateStr] = [];
            tasksByDate[dateStr].push(task);
          });
          Object.keys(tasksByDate).forEach(dateStr => {
            const filePath = path.join(archiveDir, `${dateStr}.json`);
            let existing = [];
            if (fs.existsSync(filePath)) {
              try {
                existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
              } catch {
                existing = [];
              }
            }
            const existingIds = new Set(existing.map(t => t.id));
            const newTasks = tasksByDate[dateStr].filter(t => !existingIds.has(t.id));
            if (newTasks.length > 0) {
              fs.writeFileSync(filePath, JSON.stringify([...existing, ...newTasks], null, 2));
            }
          });
        }
      } catch (archErr) {
        console.error('[archive] Error saving archive:', archErr);
      }
      // --- END LOCAL ARCHIVE LOGIC ---

      webContents.send('canvas-fetch-occurred', Date.now());
      const hash = JSON.stringify(data);
      if (hash !== lastDataHash) {
        lastDataHash = hash;
        webContents.send('canvas-data-update', data);
        console.log('[poll] Data changed — pushed to renderer');
      } else {
        console.log('[poll] No change — renderer left idle');
      }
    } catch (err) {
      console.error('[poll] Polling error:', err);
      if (err.message === 'unauthorized') {
        webContents.send('canvas-unauthorized');
      }
    }
  };

  // 15 minutes — safe for Canvas rate limits, still timely for academic deadlines
  pollingInterval = setInterval(tick, 15 * 60 * 1000);
}

function readSettings() {
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) return normalizeSettings(JSON.parse(fs.readFileSync(settingsPath, 'utf8')));
  } catch (error) { console.error(error); }
  return normalizeSettings();
}

function getStoredWindowSize() {
  return getWindowSize(readSettings().size, process.platform);
}

function resizeWidget(sizeName) {
  if (!mainWindow) return;
  const dimensions = getWindowSize(sizeName, process.platform);
  mainWindow.setResizable(true);
  if (process.platform === 'linux') {
    const bounds = mainWindow.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    mainWindow.setBounds(fitWindowBounds({ ...bounds, ...dimensions }, workArea));
  } else {
    mainWindow.setSize(dimensions.width, dimensions.height);
  }
  mainWindow.setResizable(false);
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  const size = getStoredWindowSize();
  const linuxPosition = process.platform === 'linux'
    ? (() => {
        const { workArea } = screen.getPrimaryDisplay();
        return fitWindowBounds({
          ...size,
          x: workArea.x + workArea.width - size.width - 24,
          y: workArea.y + 24
        }, workArea);
      })()
    : {};

  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    ...linuxPosition,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    minimizable: false,
    maximizable: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
      zoomFactor: process.platform === 'linux' ? 1 : 0.75,
      backgroundThrottling: true // Allow OS to throttle timers when widget is not focused
    }
  });

  const windowInstance = mainWindow;
  const updateShape = () => applyWidgetWindowShape(windowInstance);
  updateShape();
  windowInstance.on('resize', updateShape);
  screen.on('display-metrics-changed', updateShape);
  windowInstance.once('closed', () => screen.removeListener('display-metrics-changed', updateShape));

  // Shape the native window before its first visible frame so startup never
  // exposes a rectangular surface, even without desktop compositing.
  windowInstance.once('ready-to-show', () => {
    updateShape();
    windowInstance.show();
    embedInDesktop(windowInstance);
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Block F12 (devtools) and F11 (fullscreen) — either key would resize
  // the widget window away from its locked preset size.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' || input.key === 'F11') {
      event.preventDefault();
    }
  });

  // Safety net: if fullscreen is entered via any other path (e.g. OS shortcut),
  // immediately leave it and snap back to the stored preset size.
  mainWindow.on('enter-full-screen', () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(false);
    resizeWidget(readSettings().size);
  });

  // Intercept Win+D / 3-finger swipe "Show Desktop" gesture.
  // Windows forcibly minimizes all windows including those with minimizable:false.
  // Immediately restoring here keeps the widget permanently visible, Rainmeter-style.
  mainWindow.on('minimize', () => {
    if (mainWindow) mainWindow.restore();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpcAndSessionHandlers() {
  // Listen to cookie updates to automatically write them to disk
  session.defaultSession.cookies.on('changed', (event, cookie, cause, removed) => {
    if (cookie.name === 'canvas_session' && !removed) {
      try {
        if (safeStorage.isEncryptionAvailable()) {
          const encrypted = safeStorage.encryptString(cookie.value);
          const userDataPath = app.getPath('userData');
          fs.writeFileSync(path.join(userDataPath, 'canvas_cookie'), encrypted);
          console.log(`[session] canvas_session cookie changed (${cause}) — encrypted and persisted to disk`);
        }
      } catch (err) {
        console.error('[session] failed to persist updated cookie:', err);
      }
    }
  });

  // ── IPC Handlers ────────────────────────────────────────────────────────────

  ipcMain.on('close-app', () => app.quit());
  ipcMain.on('minimize-app', () => {
    if (mainWindow) mainWindow.minimize();
  });

  const settingsPath = path.join(app.getPath('userData'), 'settings.json');
  const schedulePath = path.join(app.getPath('userData'), 'schedule.txt');

  ipcMain.on('save-settings', (event, settings) => {
    try { fs.writeFileSync(settingsPath, JSON.stringify(mergeSettings(readSettings(), settings), null, 2), 'utf8'); } catch (e) { console.error(e); }
  });

  ipcMain.handle('load-settings', () => readSettings());

  ipcMain.handle('get-archived-tasks', async (event, dateStr) => {
    const filePath = path.join(app.getPath('userData'), 'archive', `${dateStr}.json`);
    if (fs.existsSync(filePath)) {
      try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return []; }
    }
    return [];
  });

  ipcMain.handle('has-session', () => {
    try {
      const cookiePath = path.join(app.getPath('userData'), 'canvas_cookie');
      return fs.existsSync(cookiePath);
    } catch (e) {
      console.error(e);
      return false;
    }
  });

  ipcMain.handle('get-startup', () => {
    if (process.platform === 'linux') return getLinuxStartupStatus();
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.on('set-startup', (event, enabled) => {
    if (process.platform === 'linux') {
      try {
        setLinuxStartupStatus(enabled);
      } catch (error) {
        console.error('[startup] Failed to update Linux autostart entry:', error);
      }
      return;
    }
    app.setLoginItemSettings({
      openAtLogin: enabled,
      name: 'Canvas Sidekick'
    });
  });

  ipcMain.handle('open-external', async (_event, url) => {
    if (typeof url !== 'string' || (!url.startsWith('https://') && !url.startsWith('http://'))) {
      throw new Error('Only HTTP(S) links can be opened externally.');
    }
    await shell.openExternal(url);
  });

  ipcMain.on('save-schedule', (event, rawText) => {
    try { fs.writeFileSync(schedulePath, rawText, 'utf8'); } catch (e) { console.error(e); }
  });

  ipcMain.handle('load-schedule', () => {
    try { if (fs.existsSync(schedulePath)) return fs.readFileSync(schedulePath, 'utf8'); } catch (e) { console.error(e); }
    return '';
  });

  ipcMain.on('resize-window', (_event, sizeName) => resizeWidget(sizeName));

  ipcMain.on('open-canvas-login', async (event, loginUrl = 'https://canvas.instructure.com/') => {
    let canvasOrigin;
    try {
      const parsedLoginUrl = new URL(loginUrl);
      if (parsedLoginUrl.protocol !== 'https:' && parsedLoginUrl.protocol !== 'http:') {
        throw new Error('Canvas URL must use HTTP or HTTPS');
      }
      canvasOrigin = parsedLoginUrl.origin;
    } catch (error) {
      console.error('[login] Invalid Canvas URL:', error);
      event.reply('canvas-login-failed', 'invalid-url');
      return;
    }

    let loginSucceeded = false;
    let verificationInFlight = false;
    let closeReason = 'cancelled';

    const loginWin = new BrowserWindow({
      width: 800,
      height: 600,
      parent: mainWindow || undefined,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    const loginSession = loginWin.webContents.session;

    const reply = (channel, ...args) => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, ...args);
    };

    const cookieMatchesCanvasOrigin = (cookie) => {
      const canvasHost = new URL(canvasOrigin).hostname;
      const cookieDomain = cookie.domain.replace(/^\./, '');
      return canvasHost === cookieDomain || canvasHost.endsWith(`.${cookieDomain}`);
    };

    let loginTimeout;

    const removeLoginListeners = () => {
      clearTimeout(loginTimeout);
      loginSession.cookies.removeListener('changed', handleCookieChange);
    };

    const completeLogin = () => {
      if (loginSucceeded) return;
      loginSucceeded = true;
      removeLoginListeners();
      reply('canvas-login-success', canvasOrigin);
      if (!loginWin.isDestroyed()) loginWin.close();
    };

    const verifyCanvasLogin = async () => {
      if (loginSucceeded || verificationInFlight || loginWin.isDestroyed()) return;
      verificationInFlight = true;

      try {
        const cookies = await loginSession.cookies.get({
          url: canvasOrigin,
          name: 'canvas_session'
        });
        if (cookies.length === 0) return;

        // A canvas_session cookie may also exist before authentication. Confirm
        // it by calling an endpoint that only returns JSON for a logged-in user.
        const response = await loginSession.fetch(`${canvasOrigin}/api/v1/users/self/profile`, {
          headers: { Accept: 'application/json' },
          credentials: 'include',
          redirect: 'manual'
        });
        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          completeLogin();
        }
      } catch (error) {
        console.warn('[login] Canvas session verification failed:', error.message);
      } finally {
        verificationInFlight = false;
      }
    };

    function handleCookieChange(_cookieEvent, cookie, _cause, removed) {
      if (removed || cookie.name !== 'canvas_session' || !cookieMatchesCanvasOrigin(cookie)) return;
      // Let Chromium finish committing the cookie before the authenticated probe.
      setTimeout(verifyCanvasLogin, 100);
    }

    loginSession.cookies.on('changed', handleCookieChange);

    // Canvas installations land on different pages after SSO (dashboard,
    // courses, profile, etc.), so probe after every relevant navigation rather
    // than requiring one hard-coded success URL.
    loginWin.webContents.on('did-navigate', verifyCanvasLogin);
    loginWin.webContents.on('did-navigate-in-page', verifyCanvasLogin);
    loginWin.webContents.on('did-finish-load', verifyCanvasLogin);

    loginTimeout = setTimeout(() => {
      if (!loginSucceeded && !loginWin.isDestroyed()) {
        closeReason = 'timeout';
        loginWin.close();
      }
    }, 3 * 60 * 1000);

    loginWin.on('closed', () => {
      removeLoginListeners();
      if (!loginSucceeded) reply('canvas-login-failed', closeReason);
    });

    loginWin.loadURL(loginUrl).catch((error) => {
      console.error('[login] Failed to load Canvas URL:', error);
      closeReason = 'load-failed';
      if (!loginWin.isDestroyed()) loginWin.close();
    });
  });

  // One-shot fetch (initial load + manual refresh)
  ipcMain.handle('fetch-canvas-data', async (_event, schoolUrl, trackedTasks) => {
    try {
      const data = await fetchCanvasDataInternal(schoolUrl, trackedTasks);
      _event.sender.send('canvas-fetch-occurred', Date.now());
      return data;
    } catch (err) {
      console.error('fetch-canvas-data failed:', err);
      if (err.message === 'no_cookie' || err.message === 'decrypt_failed' || err.message === 'unauthorized') {
        throw err;
      }
      throw err;
    }
  });

  // Renderer calls this once after auth — Main takes over all future polling
  ipcMain.on('start-canvas-polling', (_event, schoolUrl, trackedTasks) => {
    if (!mainWindow) return;
    console.log(`[poll] Starting main-process polling for ${schoolUrl}`);
    startPolling(schoolUrl, mainWindow.webContents, trackedTasks);
  });

  // ─── LLM IPC Handlers ───────────────────────────────────────────────────────
  const LLM_MODEL = 'qwen2.5:3b';
  const OLLAMA_API = 'http://127.0.0.1:11434/api';

  ipcMain.handle('ollama-version', async () => {
    const res = await net.fetch(`${OLLAMA_API}/version`);
    if (!res.ok) throw new Error('Ollama version check failed');
    return res.json();
  });

  ipcMain.handle('ollama-tags', async () => {
    const res = await net.fetch(`${OLLAMA_API}/tags`);
    if (!res.ok) throw new Error('Ollama model check failed');
    return res.json();
  });

  ipcMain.handle('ollama-pull', async (event, model = LLM_MODEL) => {
    const res = await net.fetch(`${OLLAMA_API}/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model })
    });
    if (!res.ok || !res.body) throw new Error('Ollama model download failed');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';

    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const progress = JSON.parse(line);
        if (!event.sender.isDestroyed() && progress.total && progress.completed) {
          event.sender.send('ollama-pull-progress', Math.round((progress.completed / progress.total) * 100));
        }
      }
      if (done) break;
    }
    return { ready: true };
  });

  ipcMain.handle('llm-chat', async (event, messages) => {
    try {
      const res = await net.fetch(`${OLLAMA_API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages,
          stream: false
        })
      });
      if (!res.ok) throw new Error('Ollama chat failed');
      const data = await res.json();
      return data;
    } catch (err) {
      console.error('[llm] chat error:', err);
      throw err;
    }
  });

  ipcMain.handle('llm-parse-command', async (event, userInput) => {
    const schema = {
      type: "object",
      properties: {
        intent: { type: "string", enum: ["delete_meeting", "add_task", "unknown"] },
        details: { type: "string" },
        taskTitle: { type: "string" },
        taskDueDate: { type: "string" }
      },
      required: ["intent"]
    };

    try {
      const res = await net.fetch(`${OLLAMA_API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: [{
            role: "system",
            content: "You are a command router. Parse the user's intent into structured JSON. If the intent is 'add_task', extract the task details into 'taskTitle' and 'taskDueDate'."
          }, {
            role: "user",
            content: userInput
          }],
          format: schema,
          stream: false
        })
      });
      if (!res.ok) throw new Error('Ollama command parsing failed');
      const data = await res.json();
      return JSON.parse(data.message.content);
    } catch (err) {
      console.error('[llm] parse-command error:', err);
      throw err;
    }
  });

  ipcMain.handle('llm-estimate-task', async (event, taskTitle, deadline) => {
    const schema = {
      type: "object",
      properties: {
        difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
        estimatedHours: { type: "number" }
      },
      required: ["difficulty", "estimatedHours"]
    };

    const systemPrompt = `You are an expert Task Estimator. 
Evaluate task difficulty and time based on title and deadlines.
Respond ONLY in JSON.

Examples:
User: Title: "Read Chapter 5", Deadline: "Next week"
Output: {"difficulty": "easy", "estimatedHours": 2}

User: Title: "Final Project Implementation", Deadline: "Tomorrow"
Output: {"difficulty": "hard", "estimatedHours": 12}

User: Title: "Weekly Quiz", Deadline: "In 2 days"
Output: {"difficulty": "medium", "estimatedHours": 1}`;

    try {
      const res = await net.fetch(`${OLLAMA_API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Title: "${taskTitle}", Deadline: "${deadline}"` }
          ],
          format: schema,
          stream: false
        })
      });
      if (!res.ok) throw new Error('Ollama task estimation failed');
      const data = await res.json();
      return JSON.parse(data.message.content);
    } catch (err) {
      console.error('[llm] estimate-task error:', err);
      throw err;
    }
  });
}

function registerPowerMonitorHandlers() {
  let reEmbedTimeout = null;

  powerMonitor.on('suspend', () => {
    console.log('[power] System suspend detected. Preparing desktop widget...');
    if (reEmbedTimeout) {
      clearTimeout(reEmbedTimeout);
      reEmbedTimeout = null;
    }
    if (mainWindow) {
      detachFromDesktop(mainWindow);
    }
  });

  powerMonitor.on('lock-screen', () => {
    console.log('[power] Screen lock detected. Preparing desktop widget...');
    if (reEmbedTimeout) {
      clearTimeout(reEmbedTimeout);
      reEmbedTimeout = null;
    }
    if (mainWindow) {
      detachFromDesktop(mainWindow);
    }
  });

  const reEmbed = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('[power] Restoring desktop widget integration...');
      embedInDesktop(mainWindow);
    } else {
      console.log('[power] Widget destroyed during power cycle. Re-creating...');
      createWindow();
    }
  };

  const handleResumeOrUnlock = () => {
    console.log('[power] System resume/unlock event. Scheduling re-embed/recreate...');
    if (reEmbedTimeout) {
      clearTimeout(reEmbedTimeout);
    }
    reEmbedTimeout = setTimeout(() => {
      reEmbedTimeout = null;
      reEmbed();
    }, 1500);
  };

  powerMonitor.on('resume', handleResumeOrUnlock);
  powerMonitor.on('unlock-screen', handleResumeOrUnlock);
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.commandLine.appendSwitch('enable-transparent-visuals');
if (process.platform === 'linux' && process.env.CANVAS_SIDEKICK_NATIVE_WAYLAND !== '1') {
  // X11/XWayland permits widget positioning and EWMH desktop-layer hints.
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

app.whenReady().then(() => {
  registerIpcAndSessionHandlers();
  registerPowerMonitorHandlers();
  setupAutoLaunch();
  setTimeout(createWindow, 200);
});

app.on('window-all-closed', () => {
  if (pollingInterval) clearInterval(pollingInterval);
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
