import { chromium } from 'playwright';
import { spawn } from 'child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startViteServer() {
  console.log("Starting Vite dev server on port 5173...");
  const child = spawn('npx', ['vite', '--port', '5173'], { shell: true });
  
  return new Promise((resolve, reject) => {
    let resolved = false;
    child.stdout.on('data', (data) => {
      const output = data.toString();
      console.log("[Vite]", output.trim());
      if (output.includes('http://localhost:5173') || output.includes('Local:')) {
        if (!resolved) {
          resolved = true;
          resolve(child);
        }
      }
    });
    
    child.stderr.on('data', (data) => {
      console.error("[Vite Error]", data.toString().trim());
    });
    
    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
    
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(child);
      }
    }, 5000);
  });
}

// Global helpers for tests to control the mock state via page evaluations
async function setMockData(page, data) {
  await page.evaluate((d) => {
    localStorage.setItem('__mockCanvasData', JSON.stringify(d));
  }, data);
}



async function setFakeTime(page, time) {
  await page.evaluate((t) => {
    localStorage.setItem('__fakeTime', String(t));
    if (window.__setFakeTime) window.__setFakeTime(t);
  }, time);
}

async function advanceFakeTime(page, ms) {
  await page.evaluate((offset) => {
    const current = Number(localStorage.getItem('__fakeTime') || 1786500000000);
    const next = current + offset;
    localStorage.setItem('__fakeTime', String(next));
    if (window.__setFakeTime) window.__setFakeTime(next);
  }, ms);
}

async function resetAppState(page) {
  if (page.url() === 'about:blank') {
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
  }
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
}

async function resetAppStateAndLogin(page, initialSettings = { size: 'Medium', schoolUrl: 'https://canvas.edu' }) {
  if (page.url() === 'about:blank') {
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
  }
  await page.evaluate((settings) => {
    localStorage.clear();
    localStorage.setItem('__mockSettings', JSON.stringify(settings));
    // Default mock data to empty
    localStorage.setItem('__mockCanvasData', JSON.stringify([]));
  }, initialSettings);
  await page.reload();
  await page.waitForLoadState('networkidle');
  // Wait for application shell to be active
  await page.waitForSelector('button[aria-label="Up Next"]', { timeout: 5000 });
}

async function remountSettings(page) {
  await page.click('button[aria-label="Up Next"]');
  await sleep(100);
  await page.click('button[aria-label="Settings"]');
  await sleep(100);
}

async function clickCalendarDay(page, dayNum) {
  const cell = page.locator(`span:text-is("${dayNum}")`).first();
  await cell.waitFor({ timeout: 5000 });
  await cell.click();
  await sleep(200);
}

// Injected setup for Date, active intervals, and window.api bridge
async function configurePageMocks(page) {
  await page.addInitScript(() => {
    // 1. Setup Mock Date
    const storedFakeTime = localStorage.getItem('__fakeTime');
    const storedSettings = localStorage.getItem('__mockSettings');
    const storedData = localStorage.getItem('__mockCanvasData');
    const storedSchedule = localStorage.getItem('__mockSchedule');
    console.log('[MOCK INIT] fakeTime:', storedFakeTime, 'settings:', storedSettings, 'data:', storedData, 'schedule:', storedSchedule);
    window.__fakeTime = storedFakeTime ? Number(storedFakeTime) : 1786536000000; // default to 2026-08-11T12:00:00Z
    
    const RealDate = Date;
    class MockDate extends RealDate {
      constructor(...args) {
        if (args.length === 0 || (args.length === 1 && args[0] === undefined)) {
          super(window.__fakeTime);
        } else {
          super(...args);
        }
      }
    }
    MockDate.now = () => window.__fakeTime;
    MockDate.UTC = RealDate.UTC;
    MockDate.parse = RealDate.parse;
    
    Object.setPrototypeOf(MockDate, RealDate);
    MockDate.prototype = RealDate.prototype;
    window.Date = MockDate;

    window.__setFakeTime = (t) => {
      window.__fakeTime = t;
    };

    // 2. Setup active intervals tracker
    const activeIntervals = new Map();
    let nextIntervalId = 1;
    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;

    window.setInterval = (handler, timeout, ...args) => {
      const id = nextIntervalId++;
      const realId = originalSetInterval(handler, timeout, ...args);
      activeIntervals.set(id, { realId, handler, timeout, args });
      console.log(`[MOCK setInterval] id=${id} realId=${realId} timeout=${timeout}`);
      return id;
    };

    window.clearInterval = (id) => {
      console.log(`[MOCK clearInterval] id=${id}`);
      if (activeIntervals.has(id)) {
        const { realId } = activeIntervals.get(id);
        originalClearInterval(realId);
        activeIntervals.delete(id);
      } else {
        originalClearInterval(id);
      }
    };

    window.__getActiveIntervals = () => {
      return Array.from(activeIntervals.entries()).map(([id, info]) => ({
        id,
        timeout: info.timeout,
        handlerStr: info.handler.toString()
      }));
    };

    // 3. Setup window.api mock
    window.__spy = {
      saveSettings: [],
      loadSettingsCount: 0,
      saveSchedule: [],
      loadScheduleCount: 0,
      resizeWindow: [],
      closeAppCount: 0,
      minimizeAppCount: 0
    };

    window.__fetchOccurredListener = null;
    window.__dataUpdateListener = null;
    window.__loginSuccessListener = null;

    window.__mockSettings = storedSettings ? JSON.parse(storedSettings) : { size: 'Medium', schoolUrl: '' };

    window.__mockSchedule = storedSchedule || '';

    window.api = {
      closeApp: () => {
        window.__spy.closeAppCount++;
      },
      minimizeApp: () => {
        window.__spy.minimizeAppCount++;
      },
      loginCanvas: (url) => {
        window.__mockSettings.schoolUrl = url;
        localStorage.setItem('__mockSettings', JSON.stringify(window.__mockSettings));
        setTimeout(() => {
          if (window.__loginSuccessListener) window.__loginSuccessListener();
        }, 100);
      },
      onCanvasLoginSuccess: (callback) => {
        window.__loginSuccessListener = callback;
      },
      fetchCanvasData: async () => {
        const storedData = localStorage.getItem('__mockCanvasData');
        const data = storedData ? JSON.parse(storedData) : [];
        console.log('[MOCK API] fetchCanvasData returning:', JSON.stringify(data));
        const suppress = localStorage.getItem('__suppressFetchOccurred') === 'true';
        if (window.__fetchOccurredListener && !suppress) {
          window.__fetchOccurredListener(window.__fakeTime);
        }
        return data;
      },
      startCanvasPolling: () => {},
      onCanvasFetchOccurred: (cb) => {
        window.__fetchOccurredListener = cb;
        return () => {
          window.__fetchOccurredListener = null;
        };
      },
      onCanvasDataUpdate: (cb) => {
        window.__dataUpdateListener = cb;
        return () => {
          window.__dataUpdateListener = null;
        };
      },
      saveSettings: (settings) => {
        window.__spy.saveSettings.push(settings);
      },
      loadSettings: async () => {
        window.__spy.loadSettingsCount++;
        return window.__mockSettings;
      },
      saveSchedule: (rawText) => {
        window.__spy.saveSchedule.push(rawText);
      },
      loadSchedule: async () => {
        window.__spy.loadScheduleCount++;
        return window.__mockSchedule;
      },
      resizeWindow: (sizeName) => {
        window.__spy.resizeWindow.push(sizeName);
      }
    };

    // Custom E2E triggers
    window.__triggerCanvasFetchOccurred = (timestamp) => {
      if (window.__fetchOccurredListener) window.__fetchOccurredListener(timestamp);
    };
    window.__triggerCanvasDataUpdate = (data) => {
      if (window.__dataUpdateListener) window.__dataUpdateListener(data);
    };
  });
}

async function runTests() {
  let serverProcess;
  let browser;
  let exitCode = 0;
  
  try {
    serverProcess = await startViteServer();
    console.log("Vite dev server ready!");
    
    browser = await chromium.launch({ headless: true });
    
    // We execute tests. Most tests share a clean New York context, but timezone test uses multiple.
    const context = await browser.newContext({ timezoneId: 'America/New_York' });
    const page = await context.newPage();
    
    page.on('console', msg => {
      console.log(`[PAGE ${msg.type().toUpperCase()}]:`, msg.text());
    });
    page.on('pageerror', err => console.error('PAGE CRASH:', err.stack || err.message));
    
    await configurePageMocks(page);
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    let passedCount = 0;
    let failedCount = 0;
    const testResults = [];
    
    async function test(name, fn) {
      console.log(`Running test: ${name}...`);
      try {
        await fn();
        console.log(`  ✅ PASS`);
        testResults.push({ name, status: 'PASS' });
        passedCount++;
      } catch (err) {
        console.error(`  ❌ FAIL:`, err.message);
        testResults.push({ name, status: 'FAIL', error: err.message });
        failedCount++;
      }
    }
    
    // ==========================================
    // TIER 1: FEATURE COVERAGE
    // ==========================================
    
    await test("T1.1: Past Event Removal (Up Next)", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786536000000); // 2026-08-12T12:00:00Z
      await setMockData(page, [
        { id: 'e-past', type: 'event', title: 'Yesterday Meeting', dueDate: '2026-08-11T12:00:00.000Z' },
        { id: 'e-today', type: 'event', title: 'Today Meeting', dueDate: '2026-08-12T15:00:00.000Z' }
      ]);
      await page.reload();
      await page.waitForSelector('text=Today Meeting', { timeout: 3000 });
      
      const yesterdayVisible = await page.locator('text=Yesterday Meeting').count();
      if (yesterdayVisible > 0) throw new Error("Yesterday's event should have been filtered out");
    });
    
    await test("T1.2: Completed Task Removal (Up Next)", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await setMockData(page, [
        { id: 't-completed-past', type: 'deadline', title: 'Completed Past Assignment', dueDate: '2026-08-06T17:00:00.000Z', completed: true },
        { id: 't-incomplete-past', type: 'deadline', title: 'Incomplete Assignment', dueDate: '2026-08-06T17:00:00.000Z', completed: false }
      ]);
      await page.reload();
      await page.waitForSelector('text=Incomplete Assignment', { timeout: 3000 });
      
      const completedVisible = await page.locator('text=Completed Past Assignment').count();
      if (completedVisible > 0) throw new Error("Completed past task should have been filtered out");
    });
    
    await test("T1.3: Overdue Task Retention (Up Next)", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await setMockData(page, [
        { id: 't-overdue', type: 'deadline', title: 'Overdue Task', dueDate: '2026-08-06T16:00:00.000Z', completed: false }
      ]);
      await page.reload();
      const count = await page.locator('text=Overdue Task').count();
      if (count === 0) throw new Error("Overdue incomplete task should be retained");
    });
    
    await test("T1.4: Past Event Retention in Calendar", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786536000000);
      await setMockData(page, [
        { id: 'e-past', type: 'event', title: 'Yesterday Event Cal', dueDate: '2026-08-11T12:00:00.000Z' }
      ]);
      await page.reload();
      await page.click('button[aria-label="Calendar"]');
      await clickCalendarDay(page, 11);
      const count = await page.locator('text=Yesterday Event Cal').count();
      if (count === 0) throw new Error("Past events should remain visible in Calendar tab");
    });
    
    await test("T1.5: Completed Task Retention in Calendar", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786536000000);
      await setMockData(page, [
        { id: 't-completed-past-cal', type: 'deadline', title: 'Completed Task Cal', dueDate: '2026-08-12T10:00:00.000Z', completed: true }
      ]);
      await page.reload();
      await page.click('button[aria-label="Calendar"]');
      await clickCalendarDay(page, 12);
      const count = await page.locator('text=Completed Task Cal').count();
      if (count === 0) throw new Error("Completed past tasks should remain visible in Calendar tab");
    });
    
    await test("T1.6: Refresh Indicator - Just Now", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await page.click('button[aria-label="Settings"]');
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000));
      await sleep(100);
      const text = await page.locator('text=Just now').count();
      if (text === 0) throw new Error("Relative indicator should say 'Just now' immediately after sync");
    });
    
    await test("T1.7: Refresh Indicator - Minutes Ago", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await page.click('button[aria-label="Settings"]');
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000));
      await advanceFakeTime(page, 5 * 60 * 1000); // advance 5 minutes
      await remountSettings(page);
      const text = await page.locator('text=5m ago').count();
      if (text === 0) throw new Error("Relative indicator should update to reflect 5 minutes elapsed");
    });
    
    await test("T1.8: Refresh Indicator - Pre-sync Default", async () => {
      // Set schoolUrl in settings but do not trigger fetch event so lastRefreshTime remains null
      await resetAppState(page);
      await page.evaluate(() => {
        localStorage.setItem('__mockSettings', JSON.stringify({ size: 'Medium', schoolUrl: 'https://canvas.edu' }));
        localStorage.setItem('__suppressFetchOccurred', 'true');
      });
      await page.reload();
      await page.waitForSelector('button[aria-label="Up Next"]', { timeout: 5000 });
      await page.click('button[aria-label="Settings"]');
      const text = await page.locator('text=v0.0.0').count();
      if (text === 0) throw new Error("Relative indicator should display fallback 'v0.0.0' prior to first sync");
    });
    
    await test("T1.9: IPC Event Listening", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await page.click('button[aria-label="Settings"]');
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000 - 120000)); // 2 minutes ago
      await sleep(100);
      const text = await page.locator('text=2m ago').count();
      if (text === 0) throw new Error("Renderer should update relative time display automatically when IPC event occurs");
    });
    
    await test("T1.10: Force Sync Reset", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await page.click('button[aria-label="Settings"]');
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000 - 600000)); // 10 minutes ago
      await sleep(100);
      await page.waitForSelector('text=10m ago');
      
      await page.click('button:has-text("Force Sync")');
      await sleep(200);
      const text = await page.locator('text=Just now').count();
      if (text === 0) throw new Error("Force Sync button click did not reset relative sync time to 'Just now'");
    });
    
    // ==========================================
    // TIER 2: BOUNDARY & CORNER CASES
    // ==========================================
    
    await test("T2.1: Midnight Boundary Event Filtering", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000); // 2026-08-06T18:00:00Z
      await page.evaluate(() => {
        const localToday = new Date();
        localToday.setHours(0, 0, 0, 0);
        const yesterdayBoundary = new Date(localToday.getTime() - 1000); // 23:59:59 yesterday
        const todayBoundary = new Date(localToday.getTime() + 1000); // 00:00:01 today
        
        localStorage.setItem('__mockCanvasData', JSON.stringify([
          { id: 'e-bound-yesterday', type: 'event', title: 'Yesterday Boundary Event', dueDate: yesterdayBoundary.toISOString() },
          { id: 'e-bound-today', type: 'event', title: 'Today Boundary Event', dueDate: todayBoundary.toISOString() }
        ]));
      });
      await page.reload();
      await page.waitForSelector('text=Today Boundary Event', { timeout: 3000 });
      
      const yesterdayVisible = await page.locator('text=Yesterday Boundary Event').count();
      if (yesterdayVisible > 0) throw new Error("Event just before midnight was not correctly removed");
    });
    
    await test("T2.2: Task Removal Exact Deadline Boundary", async () => {
      const deadlineEpoch = 1786500000000;
      const deadlineISO = new Date(deadlineEpoch).toISOString();
      
      await resetAppStateAndLogin(page);
      await setMockData(page, [
        { id: 't-bound', type: 'deadline', title: 'Boundary Task', dueDate: deadlineISO, completed: true }
      ]);
      
      // 1. Check at deadline - 1ms
      await setFakeTime(page, deadlineEpoch - 1);
      await page.reload();
      let count = await page.locator('text=Boundary Task').count();
      if (count === 0) throw new Error("Completed task should remain visible 1ms before deadline");
      
      // 2. Check exactly at deadline
      await setFakeTime(page, deadlineEpoch);
      await page.reload();
      count = await page.locator('text=Boundary Task').count();
      if (count > 0) throw new Error("Completed task must disappear exactly at deadline");
      
      // 3. Check at deadline + 1ms
      await setFakeTime(page, deadlineEpoch + 1);
      await page.reload();
      count = await page.locator('text=Boundary Task').count();
      if (count > 0) throw new Error("Completed task must remain hidden after deadline has passed");
    });
    
    await test("T2.3: System Timezone Shift Correctness", async () => {
      // We launch separate contexts to test timezone changes.
      const deadlineEpoch = 1786017600000; // 2026-08-01T12:00:00.000Z
      const deadlineISO = new Date(deadlineEpoch).toISOString();
      const mockItems = [{ id: 't-tz', type: 'deadline', title: 'TZ Task', dueDate: deadlineISO, completed: true }];
      
      // Test New York (GMT-5)
      const nyContext = await browser.newContext({ timezoneId: 'America/New_York' });
      const nyPage = await nyContext.newPage();
      await configurePageMocks(nyPage);
      await resetAppStateAndLogin(nyPage);
      await setMockData(nyPage, mockItems);
      
      // NY: 1ms before deadline
      await setFakeTime(nyPage, deadlineEpoch - 1);
      await nyPage.reload();
      let count = await nyPage.locator('text=TZ Task').count();
      if (count === 0) throw new Error("NY: Task should be visible 1ms before deadline");
      
      // NY: exactly at deadline
      await setFakeTime(nyPage, deadlineEpoch);
      await nyPage.reload();
      count = await nyPage.locator('text=TZ Task').count();
      if (count > 0) throw new Error("NY: Task should disappear exactly at deadline");
      await nyContext.close();
      
      // Test Tokyo (GMT+9)
      const tokyoContext = await browser.newContext({ timezoneId: 'Asia/Tokyo' });
      const tokyoPage = await tokyoContext.newPage();
      await configurePageMocks(tokyoPage);
      await resetAppStateAndLogin(tokyoPage);
      await setMockData(tokyoPage, mockItems);
      
      // Tokyo: 1ms before deadline
      await setFakeTime(tokyoPage, deadlineEpoch - 1);
      await tokyoPage.reload();
      count = await tokyoPage.locator('text=TZ Task').count();
      if (count === 0) throw new Error("Tokyo: Task should be visible 1ms before deadline");
      
      // Tokyo: exactly at deadline
      await setFakeTime(tokyoPage, deadlineEpoch);
      await tokyoPage.reload();
      count = await tokyoPage.locator('text=TZ Task').count();
      if (count > 0) throw new Error("Tokyo: Task should disappear exactly at deadline");
      await tokyoContext.close();
    });
    
    await test("T2.4: Empty/Null Due Dates Handling", async () => {
      await resetAppStateAndLogin(page);
      await setMockData(page, [
        { id: 't-null-date', type: 'deadline', title: 'Null Date Task', dueDate: null },
        { id: 't-empty-date', type: 'deadline', title: 'Empty Date Task', dueDate: '' }
      ]);
      await page.reload();
      const nullCount = await page.locator('text=Null Date Task').count();
      const emptyCount = await page.locator('text=Empty Date Task').count();
      if (nullCount === 0 || emptyCount === 0) throw new Error("Tasks with missing or empty due dates caused filtering crash or were incorrectly hidden");
    });
    
    await test("T2.5: Multi-Day Overdue Task Persistence", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      const sevenDaysAgo = new Date(1786500000000 - 7 * 24 * 60 * 60 * 1000).toISOString();
      await setMockData(page, [
        { id: 't-7days', type: 'deadline', title: '7 Days Overdue Task', dueDate: sevenDaysAgo, completed: false }
      ]);
      await page.reload();
      const upNextCount = await page.locator('text=7 Days Overdue Task').count();
      await page.click('button[aria-label="Tasks"]');
      const tasksTabCount = await page.locator('text=7 Days Overdue Task').count();
      
      if (upNextCount === 0 || tasksTabCount === 0) {
        throw new Error("Task overdue by 7 days did not persist in Up Next or Tasks tab");
      }
    });
    
    await test("T2.6: Interval Drift and Clock Jump Backward", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await page.click('button[aria-label="Settings"]');
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000));
      
      // Jump clock backward 10 seconds
      await setFakeTime(page, 1786500000000 - 10000);
      await remountSettings(page);
      
      // It should handle negative times gracefully (typically shows "Just now")
      const justNowCount = await page.locator('text=Just now').count();
      const minAgoCount = await page.locator('text=0m ago').count();
      if (justNowCount === 0 && minAgoCount === 0) {
        throw new Error("Negative refresh delta caused by backward clock jump was not handled gracefully");
      }
    });
    
    await test("T2.7: Clock Jump Forward", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await page.click('button[aria-label="Settings"]');
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000));
      
      // Jump clock forward 1 hour
      await setFakeTime(page, 1786500000000 + 3600000);
      await remountSettings(page);
      
      const count = await page.locator('text=60m ago').count();
      if (count === 0) throw new Error("Clock forward jump was not reflected in sync indicator");
    });
    
    await test("T2.8: Failed Sync Indicator Preservation", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await page.click('button[aria-label="Settings"]');
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000 - 300000)); // 5 minutes ago
      await sleep(100);
      await page.waitForSelector('text=5m ago');
      
      // Make next fetch throw error
      await page.evaluate(() => {
        window.api.fetchCanvasData = async () => {
          throw new Error("Canvas sync connection timeout");
        };
      });
      
      await page.click('button:has-text("Force Sync")');
      await sleep(200);
      
      const count = await page.locator('text=5m ago').count();
      if (count === 0) throw new Error("Failed sync should preserve last known successful sync indicator");
    });
    
    await test("T2.9: Rapid Multiple Fetch Occurrences (Flooding)", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await page.click('button[aria-label="Settings"]');
      
      // Flood 20 fetch occurred events
      await page.evaluate(() => {
        for (let i = 0; i < 20; i++) {
          window.__triggerCanvasFetchOccurred(1786500000000);
        }
      });
      await sleep(200);
      const text = await page.locator('text=Just now').count();
      if (text === 0) throw new Error("Flooding UI updates caused instability or refresh indicator failure");
    });
    
    await test("T2.10: Startup State Race Condition", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      
      // Trigger sync event at startup BEFORE Settings is mounted
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000 - 120000)); // 2m ago
      
      // Navigate to Settings
      await page.click('button[aria-label="Settings"]');
      await sleep(100);
      
      const count = await page.locator('text=2m ago').count();
      if (count === 0) throw new Error("Startup fetch occurring before mounting was not cached or adopted correctly");
    });
    
    // ==========================================
    // TIER 3: CROSS-FEATURE COMBINATIONS
    // ==========================================
    
    await test("T3.1: Tab Switch and Settings Interval Cleanup (Memory Leak Verification)", async () => {
      await resetAppStateAndLogin(page);
      
      // Navigate to Settings
      await page.click('button[aria-label="Settings"]');
      await sleep(200);
      
      // Trace active intervals: check settings interval (30000ms) exists
      let activeIntervals = await page.evaluate(() => window.__getActiveIntervals());
      let hasSettingsTimer = activeIntervals.some(inv => inv.timeout === 30000 && (inv.handlerStr.includes('minutesAgo') || inv.handlerStr.includes('lastRefreshTime')));
      if (!hasSettingsTimer) throw new Error("Active interval of 30s not registered when Settings tab is mounted");
      
      // Switch tab away to Up Next
      await page.click('button[aria-label="Up Next"]');
      await sleep(200);
      
      // Verify interval has been cleared
      activeIntervals = await page.evaluate(() => window.__getActiveIntervals());
      hasSettingsTimer = activeIntervals.some(inv => inv.timeout === 30000 && (inv.handlerStr.includes('minutesAgo') || inv.handlerStr.includes('lastRefreshTime')));
      if (hasSettingsTimer) throw new Error("Interval of 30s was not cleared when Settings tab unmounted; memory leak detected");
    });
    
    await test("T3.2: Background Poll during Active Settings Timer", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await page.click('button[aria-label="Settings"]');
      
      // Set to 5m ago first
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000 - 300000));
      await sleep(100);
      await page.waitForSelector('text=5m ago');
      
      // Trigger background poll sync now
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000));
      await sleep(100);
      
      const count = await page.locator('text=Just now').count();
      if (count === 0) throw new Error("Background poll sync event did not immediately update active settings sync timer");
    });
    
    await test("T3.3: Task Completion and Midnight Rollover Intersection", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786536000000); // 2026-08-12T12:00:00Z
      await setMockData(page, [
        { id: 't-overdue-intersect', type: 'deadline', title: 'Overdue Intersect Task', dueDate: '2026-08-12T10:00:00.000Z', completed: false },
        { id: 'e-today-intersect', type: 'event', title: 'Today Intersect Event', dueDate: '2026-08-12T15:00:00.000Z' }
      ]);
      await page.reload();
      await page.waitForSelector('text=Overdue Intersect Task');
      await page.waitForSelector('text=Today Intersect Event');
      
      // Complete overdue task
      await page.click('text=Overdue Intersect Task');
      await sleep(200);
      let overdueVisible = await page.locator('text=Overdue Intersect Task').count();
      if (overdueVisible > 0) throw new Error("Overdue task should have disappeared instantly upon completion");
      
      // Advance to tomorrow
      await setFakeTime(page, 1786536000000 + 20 * 60 * 60 * 1000); // +20 hours (tomorrow morning)
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(window.__fakeTime)); // trigger midnight rollover check
      await sleep(200);
      
      // Today event should disappear from Up Next
      let eventVisible = await page.locator('text=Today Intersect Event').count();
      if (eventVisible > 0) throw new Error("Today event (now yesterday's) did not disappear after midnight rollover");
      
      // Go to Calendar tab and verify BOTH are present
      await page.click('button[aria-label="Calendar"]');
      await clickCalendarDay(page, 12);
      let calTaskVisible = await page.locator('text=Overdue Intersect Task').count();
      let calEventVisible = await page.locator('text=Today Intersect Event').count();
      if (calTaskVisible === 0 || calEventVisible === 0) {
        throw new Error("Task and Event intersection records were lost or hidden in Calendar view");
      }
    });
    
    // ==========================================
    // TIER 4: REAL-WORLD SCENARIOS
    // ==========================================
    
    await test("T4.1: The Idle Student Midnight Rollover", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786536000000); // 2026-08-12T12:00:00Z
      await setMockData(page, [
        { id: 'e-today-idle', type: 'event', title: 'Idle Student Today Event', dueDate: '2026-08-12T15:00:00.000Z' },
        { id: 'e-tomorrow-idle', type: 'event', title: 'Idle Student Tomorrow Event', dueDate: '2026-08-13T10:00:00.000Z' }
      ]);
      await page.reload();
      await page.waitForSelector('text=Idle Student Today Event');
      await page.waitForSelector('text=Idle Student Tomorrow Event');
      
      // Simulate crossing midnight: advance 20 hours
      await setFakeTime(page, 1786536000000 + 20 * 60 * 60 * 1000);
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(window.__fakeTime));
      await sleep(200);
      
      const todayVisible = await page.locator('text=Idle Student Today Event').count();
      const tomorrowVisible = await page.locator('text=Idle Student Tomorrow Event').count();
      
      if (todayVisible > 0) throw new Error("Yesterday's event remained visible on Up Next after simulated midnight rollover");
      if (tomorrowVisible === 0) throw new Error("Tomorrow's event (now today's) disappeared incorrectly");
    });
    
    await test("T4.2: The Overdue Submission Flow", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await setMockData(page, [
        { id: 't-overdue-sub', type: 'deadline', title: 'Overdue Assignment', dueDate: '2026-08-06T17:00:00.000Z', completed: false }
      ]);
      await page.reload();
      await page.waitForSelector('text=Overdue Assignment');
      
      // Complete assignment
      await page.click('text=Overdue Assignment');
      await sleep(200);
      
      const count = await page.locator('text=Overdue Assignment').count();
      if (count > 0) throw new Error("Overdue assignment did not disappear immediately upon completion");
    });
    
    await test("T4.3: Initial Onboarding and Sync Transitions", async () => {
      await resetAppState(page); // Clear localStorage, reset settings, reload
      
      // Verify login/auth modal is open
      const authHeader = await page.locator('text=Connect to Canvas').count();
      if (authHeader === 0) throw new Error("Authentication Onboarding Modal not displayed on clean setup");
      
      // Perform Auth Onboarding
      await page.fill('input[placeholder="canvas.edu"]', 'school.edu');
      await page.click('button[type="submit"]');
      
      // Wait for authentication success transitions
      await page.waitForSelector('button[aria-label="Settings"]', { timeout: 5000 });
      
      // Open settings, verify refresh indicator displays fallback 'v0.0.0'
      await page.click('button[aria-label="Settings"]');
      let fallbackText = await page.locator('text=v0.0.0').count();
      if (fallbackText === 0) throw new Error("Refresh indicator did not start with 'v0.0.0' fallback prior to sync");
      
      // Clear suppression flag and trigger sync
      await page.evaluate(() => localStorage.removeItem('__suppressFetchOccurred'));
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(window.__fakeTime));
      await sleep(100);
      
      const justNowText = await page.locator('text=Just now').count();
      if (justNowText === 0) throw new Error("Onboarding sync failed to transition refresh indicator to 'Just now'");
    });
    
    await test("T4.4: Network Drop and Offline Recovery", async () => {
      await resetAppStateAndLogin(page);
      await setFakeTime(page, 1786500000000);
      await page.click('button[aria-label="Settings"]');
      await page.evaluate(() => window.__triggerCanvasFetchOccurred(1786500000000));
      
      // Make next fetch throw error (Simulate network offline)
      await page.evaluate(() => {
        window.api.fetchCanvasData = async () => {
          throw new Error("Offline");
        };
      });
      
      // Advance time 10 minutes, verify indicator updates to 10m ago
      await advanceFakeTime(page, 10 * 60 * 1000);
      await remountSettings(page);
      await page.waitForSelector('text=10m ago');
      
      // Click Force Sync while offline, verify it remains 10m ago
      await page.click('button:has-text("Force Sync")');
      await sleep(200);
      let count = await page.locator('text=10m ago').count();
      if (count === 0) throw new Error("Offline Force Sync should preserve previous relative sync indicator");
      
      // Restore connection
      await page.evaluate(() => {
        window.api.fetchCanvasData = async () => {
          if (window.__fetchOccurredListener) window.__fetchOccurredListener(window.__fakeTime);
          return [];
        };
      });
      
      // Click Force Sync, verify indicator resets to 'Just now'
      await page.click('button:has-text("Force Sync")');
      await sleep(200);
      const justNowText = await page.locator('text=Just now').count();
      if (justNowText === 0) throw new Error("Force Sync did not recover relative sync time display to 'Just now' after restoring connection");
    });
    
    await test("T4.5: The Smartwatch Widget (Small Size) Constraint", async () => {
      await resetAppStateAndLogin(page);
      await setMockData(page, [
        { id: 't-small-1', type: 'deadline', title: 'Small Item 1', dueDate: '2026-08-06T19:00:00.000Z', timeEstimate: '30m' },
        { id: 't-small-2', type: 'deadline', title: 'Small Item 2', dueDate: '2026-08-06T20:00:00.000Z', timeEstimate: '1h' },
        { id: 't-small-3', type: 'deadline', title: 'Small Item 3', dueDate: '2026-08-06T21:00:00.000Z', timeEstimate: '2h' }
      ]);
      await page.reload();
      await page.waitForSelector('text=Small Item 1');
      await page.waitForSelector('text=Small Item 2');
      await page.waitForSelector('text=Small Item 3');
      
      // Go to Settings and Click "Small" Preset Button
      await page.click('button[aria-label="Settings"]');
      await page.click('button:has-text("Small")');
      await sleep(200);
      
      // 1. Verify app container has .compact-mode class
      const hasCompactMode = await page.locator('.app-container.compact-mode').count();
      if (hasCompactMode === 0) throw new Error("Root container did not adopt '.compact-mode' class in Small size");
      
      // Go back to Up Next tab
      await page.click('button[aria-label="Up Next"]');
      await sleep(200);
      
      // 2. Verify only 1 card is displayed
      const cardCount = await page.locator('.agenda-item-card').count();
      if (cardCount !== 1) throw new Error(`Small widget should slice list to exactly 1 card, but found ${cardCount}`);
      
      // 3. Verify non-essential text elements are hidden (display: none)
      const displayVal = await page.evaluate(() => {
        const est = document.querySelector('.item-estimate');
        return est ? window.getComputedStyle(est).display : 'not_found';
      });
      if (displayVal !== 'none') {
        throw new Error(`Non-essential text elements (item-estimate) should be display: none, but found: ${displayVal}`);
      }
    });
    
    // Print summary
    console.log("\n==========================================");
    console.log("             E2E TEST RUN SUMMARY         ");
    console.log("==========================================");
    console.log(`PASSED: ${passedCount}`);
    console.log(`FAILED: ${failedCount}`);
    
    if (failedCount > 0) {
      console.log("\nFailed Test Details:");
      testResults.forEach(r => {
        if (r.status === 'FAIL') console.log(`- ${r.name}: ${r.error}`);
      });
      exitCode = 1;
    }
    
  } catch (err) {
    console.error("CRITICAL RUNNER ERROR:", err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (serverProcess) {
      console.log("Killing local Vite server...");
      serverProcess.kill();
    }
  }
  
  process.exit(exitCode);
}

runTests();
