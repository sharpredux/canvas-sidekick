import { app, BrowserWindow, ipcMain, session, safeStorage, net, powerMonitor } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

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
    name: 'Agitated Kepler'
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

async function fetchPaginatedCanvasData(url, headers) {
  let results = [];
  let nextUrl = url;
  if (!nextUrl.includes('per_page=')) {
    nextUrl += nextUrl.includes('?') ? '&per_page=100' : '?per_page=100';
  }

  while (nextUrl) {
    const res = await net.fetch(nextUrl, { headers, credentials: 'include' });
    if (res.status === 401) {
      throw new Error('unauthorized');
    }
    if (!res.ok) break;
    
    const data = await res.json();
    if (Array.isArray(data)) {
      results = results.concat(data);
    } else {
      results.push(data);
      break;
    }

    const linkHeader = res.headers.get('link');
    let foundNext = false;
    if (linkHeader) {
      const links = linkHeader.split(',');
      const nextMatch = links.find(l => l.includes('rel="next"'));
      if (nextMatch) {
        const urlMatch = nextMatch.match(/<([^>]+)>/);
        if (urlMatch) {
          nextUrl = urlMatch[1];
          foundNext = true;
        }
      }
    }
    if (!foundNext) break;
  }
  return results;
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

async function fetchCanvasDataInternal(schoolUrl) {
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
  let eventsData = [];
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
    return [];
  }

  // Group assignment IDs by course for batch submission fetching
  const courseAssignments = {};
  eventsData.forEach(event => {
    if (event.assignment && event.context_code && event.context_code.startsWith('course_')) {
      const courseId = event.context_code.split('_')[1];
      if (!courseAssignments[courseId]) courseAssignments[courseId] = [];
      courseAssignments[courseId].push(event.assignment.id);
    }
  });

  const submissionsMap = {}; // mapping of assignment_id -> workflow_state
  const submissionsScoreMap = {}; // mapping of assignment_id -> submission object
  
  for (const [courseId, assignmentIds] of Object.entries(courseAssignments)) {
    // Chunk into 20 per request to prevent URI Too Long (414)
    for (let i = 0; i < assignmentIds.length; i += 20) {
      const chunk = assignmentIds.slice(i, i + 20);
      const query = chunk.map(id => `assignment_ids[]=${id}`).join('&');
      try {
        const subData = await fetchPaginatedCanvasData(`${schoolUrl}/api/v1/courses/${courseId}/students/submissions?student_ids[]=self&${query}`, headers);
        if (Array.isArray(subData)) {
          subData.forEach(sub => {
            submissionsMap[sub.assignment_id.toString()] = sub.workflow_state;
            submissionsScoreMap[sub.assignment_id.toString()] = sub;
          });
        }
      } catch (err) {
        console.error(`[fetch] Failed to fetch submissions for course ${courseId}:`, err);
      }
    }
  }

  // Map to widget schema
  const mappedEvents = eventsData.map(event => {
    let zoomLink = null;
    if (event.description) {
      const match = event.description.match(/https:\/\/(?:[a-zA-Z0-9-]+\.)?zoom\.us\/j\/\d+/);
      if (match) zoomLink = match[0];
    }

    let isCompleted = false;
    if (event.assignment) {
      const sub = submissionsScoreMap[event.assignment.id.toString()];

      // 1. Explicit Workflow States
      if (sub && (sub.workflow_state === 'submitted' || sub.workflow_state === 'graded' || sub.workflow_state === 'pending_review')) {
        isCompleted = true;
      }
      
      // 2. The Excused Flag
      if (!isCompleted && sub && sub.excused === true) {
        isCompleted = true;
      }

      // 3. The Submitted_At Timestamp (Catches Group Assignments)
      if (!isCompleted && sub && sub.submitted_at) {
        isCompleted = true;
      }

      // 4. The Graded Flag / Score Presence
      if (!isCompleted && sub && sub.score !== null && sub.score !== undefined) {
        isCompleted = true;
      }

      // 5. Assignment-Level Submission Flag
      if (!isCompleted && event.assignment.has_submitted_submissions === true) {
        isCompleted = true;
      }

      // 6. Fallback in case upcoming_events embedded it anyway
      if (!isCompleted && event.assignment.submission && event.assignment.submission.workflow_state) {
        const embeddedState = event.assignment.submission.workflow_state;
        if (embeddedState === 'submitted' || embeddedState === 'graded' || embeddedState === 'pending_review') {
          isCompleted = true;
        }
      }
      
      // 7. Edge Case: Assignments that do not require online submissions
      // Prevent "Missing" false positives for assignments the user literally cannot submit online
      if (!isCompleted && event.assignment.submission_types) {
        const sTypes = event.assignment.submission_types;
        const canSubmitOnline = sTypes.some(type => 
          !['none', 'not_graded', 'on_paper', 'external_tool'].includes(type)
        );
        if (!canSubmitOnline) {
          if (sTypes.includes('external_tool')) {
            const sub = submissionsScoreMap[event.assignment.id.toString()];
            const hasScore = sub && sub.score !== null && sub.score !== undefined;
            const hasSubmittedSubmissions = event.assignment.has_submitted_submissions === true;
            if (hasScore || hasSubmittedSubmissions) {
              isCompleted = true;
            }
          } else {
            // Since it can't be submitted online (and isn't an external tool), we mark it as completed to prevent false 'Missing' flags
            isCompleted = true;
          }
        }
      }
    }

    return {
      id: event.id.toString(),
      type: event.type === 'assignment' ? 'deadline' : 'event',
      title: event.title,
      course: event.context_name || 'Canvas Course',
      dueDate: event.start_at,
      zoomLink,
      completed: isCompleted
    };
  });

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
function startPolling(schoolUrl, webContents) {
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
      const data = await fetchCanvasDataInternal(schoolUrl);
      
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
              try { existing = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e) {}
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

function getStoredWindowSize() {
  const SIZES = {
    Small: { width: 200, height: 200 },
    Medium: { width: 280, height: 448 },
    Large: { width: 280, height: 560 }
  };
  try {
    const settingsPath = path.join(app.getPath('userData'), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const data = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (data?.size && SIZES[data.size]) return SIZES[data.size];
    }
  } catch (e) { console.error(e); }
  return SIZES.Medium;
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  const size = getStoredWindowSize();
  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    minimizable: false,
    maximizable: false,
    resizable: false,
    skipTaskbar: true,
    paintWhenInitiallyHidden: false, // Don't waste GPU compositing before first show
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.js'),
      zoomFactor: 0.75,
      backgroundThrottling: true // Allow OS to throttle timers when widget is not focused
    }
  });

  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Embed window into desktop shell (Rainmeter-style) once content has loaded
  mainWindow.webContents.once('did-finish-load', () => {
    embedInDesktop(mainWindow);
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
    const storedSize = getStoredWindowSize();
    mainWindow.setSize(storedSize.width, storedSize.height);
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
    try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8'); } catch (e) { console.error(e); }
  });

  ipcMain.handle('load-settings', () => {
    try { if (fs.existsSync(settingsPath)) return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch (e) { console.error(e); }
    return { size: 'Medium' };
  });

  ipcMain.handle('get-archived-tasks', async (event, dateStr) => {
    const filePath = path.join(app.getPath('userData'), 'archive', `${dateStr}.json`);
    if (fs.existsSync(filePath)) {
      try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch(e) { return []; }
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
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.on('set-startup', (event, enabled) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      name: 'Agitated Kepler'
    });
  });

  ipcMain.on('save-schedule', (event, rawText) => {
    try { fs.writeFileSync(schedulePath, rawText, 'utf8'); } catch (e) { console.error(e); }
  });

  ipcMain.handle('load-schedule', () => {
    try { if (fs.existsSync(schedulePath)) return fs.readFileSync(schedulePath, 'utf8'); } catch (e) { console.error(e); }
    return '';
  });

  const SIZES = {
    Small: { width: 200, height: 200 },
    Medium: { width: 280, height: 448 },
    Large: { width: 280, height: 560 }
  };

  ipcMain.on('resize-window', (event, sizeName) => {
    if (!mainWindow) return;
    const dimensions = SIZES[sizeName] || SIZES.Small;
    mainWindow.setResizable(true);
    mainWindow.setSize(dimensions.width, dimensions.height);
    mainWindow.setResizable(false);
  });

  ipcMain.on('open-canvas-login', async (event, loginUrl = 'https://canvas.instructure.com/') => {
    let loginSucceeded = false;

    const loginWin = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    loginWin.loadURL(loginUrl);

    // Timeout: auto-close and notify after 3 minutes
    const loginTimeout = setTimeout(() => {
      if (!loginSucceeded && !loginWin.isDestroyed()) {
        loginWin.close();
      }
    }, 3 * 60 * 1000);

    // Detect if the window is closed without a successful login
    loginWin.on('closed', () => {
      clearTimeout(loginTimeout);
      if (!loginSucceeded) {
        event.reply('canvas-login-failed', 'cancelled');
      }
    });

    loginWin.webContents.on('did-navigate', async (e, url) => {
      if (url.includes('/login') || url.includes('saml') || url.includes('duosecurity')) return;

      try {
        const urlObj = new URL(url);
        if (urlObj.pathname === '/' || urlObj.searchParams.has('login_success')) {
          const cookies = await session.defaultSession.cookies.get({ url: urlObj.origin });
          const canvasSessionCookie = cookies.find(c => c.name === 'canvas_session');

          if (canvasSessionCookie) {
            loginSucceeded = true;
            clearTimeout(loginTimeout);
            loginWin.close();
            event.reply('canvas-login-success');
          }
        }
      } catch (err) {
        console.error('Failed to extract cookie:', err);
      }
    });
  });

  // One-shot fetch (initial load + manual refresh)
  ipcMain.handle('fetch-canvas-data', async (_event, schoolUrl) => {
    try {
      const data = await fetchCanvasDataInternal(schoolUrl);
      _event.sender.send('canvas-fetch-occurred', Date.now());
      return data;
    } catch (err) {
      console.error('fetch-canvas-data failed:', err);
      if (err.message === 'no_cookie' || err.message === 'decrypt_failed' || err.message === 'unauthorized') {
        throw err;
      }
      return [];
    }
  });

  // Renderer calls this once after auth — Main takes over all future polling
  ipcMain.on('start-canvas-polling', (_event, schoolUrl) => {
    if (!mainWindow) return;
    console.log(`[poll] Starting main-process polling for ${schoolUrl}`);
    startPolling(schoolUrl, mainWindow.webContents);
  });

  // ─── LLM IPC Handlers ───────────────────────────────────────────────────────
  const LLM_MODEL = 'qwen2.5:3b';
  const OLLAMA_API = 'http://127.0.0.1:11434/api';

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
    console.log('[power] System suspend detected. Detaching widget...');
    if (reEmbedTimeout) {
      clearTimeout(reEmbedTimeout);
      reEmbedTimeout = null;
    }
    if (mainWindow) {
      detachFromDesktop(mainWindow);
    }
  });

  powerMonitor.on('lock-screen', () => {
    console.log('[power] Screen lock detected. Detaching widget...');
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
      console.log('[power] Re-embedding existing widget into WorkerW...');
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
