import { chromium } from 'playwright';
import { spawn } from 'child_process';

async function startViteServer() {
  console.log("Starting Vite dev server for challenger verification...");
  const child = spawn('npx', ['vite', '--port', '5173'], { shell: true });
  
  return new Promise((resolve, reject) => {
    let resolved = false;
    let port = '5173';
    child.stdout.on('data', (data) => {
      const output = data.toString();
      const match = output.match(/localhost:(\d+)/) || output.match(/Local:.*:(\d+)/);
      if (match) {
        port = match[1];
      }
      if (output.includes('http://localhost') || output.includes('Local:')) {
        if (!resolved) {
          resolved = true;
          resolve({ child, port });
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
        resolve({ child, port });
      }
    }, 5000);
  });
}

// Injects a DOM MutationObserver to record every state React commits to the DOM.
async function setupDomObserver(page) {
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err.stack || err.message));

  await page.addInitScript(() => {
    window.__domStates = [];
    console.log("Setting up MutationObserver in page...");
    const observer = new MutationObserver(() => {
      const root = document.getElementById('root');
      if (!root) {
        return;
      }
      const hasAppContainer = root.querySelector('.app-container') !== null;
      const hasAuthModal = root.textContent.includes('Connect to Canvas') || root.querySelector('input[placeholder="canvas.edu"]') !== null;
      const hasLoader = root.querySelector('svg') !== null;
      
      const state = {
        hasAppContainer,
        hasAuthModal,
        hasLoader,
        textContent: root.textContent.trim().substring(0, 100)
      };
      console.log("Observer captured state change:", JSON.stringify(state));
      window.__domStates.push(state);
    });
    observer.observe(document, { childList: true, subtree: true });
  });
}

async function runTests() {
  let serverProcess;
  let port;
  let browser;
  let exitCode = 0;
  
  try {
    const res = await startViteServer();
    serverProcess = res.child;
    port = res.port;
    console.log(`Vite dev server started on port ${port}!`);
    
    browser = await chromium.launch({ headless: true });
    
    // =========================================================================
    // TEST 1: settings.json has schoolUrl but hasSession is false (no cookie)
    // =========================================================================
    console.log("\n--- Challenger Test 1: schoolUrl exists but hasSession is false (no cookie) ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await setupDomObserver(page);
      
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loginCanvas: () => {},
          onCanvasLoginSuccess: () => {},
          fetchCanvasData: async () => {
            // Should not be called since hasSession is false
            throw new Error("Should not fetch canvas data when hasSession is false");
          },
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test-school.edu' }),
          saveSchedule: () => {},
          loadSchedule: async () => '',
          resizeWindow: () => {},
          hasSession: async () => false
        };
      });
      
      await page.goto(`http://localhost:${port}`);
      await page.waitForSelector('text=Connect to Canvas', { timeout: 5000 });
      
      const domStates = await page.evaluate(() => window.__domStates);
      console.log("Recorded DOM States (Test 1):", JSON.stringify(domStates, null, 2));
      
      // We must NEVER find a state where hasAppContainer is true AND hasAuthModal is false.
      const leakedDashboardState = domStates.find(s => s.hasAppContainer && !s.hasAuthModal && !s.hasLoader);
      if (leakedDashboardState) {
        console.error("LEAK DETECTED: Dashboard rendered without AuthModal overlay!", leakedDashboardState);
        throw new Error("Security / UI Bypass flash detected!");
      }
      
      console.log("Test 1 Passed: No dashboard flash when cookie is missing!");
      await context.close();
    }

    // =========================================================================
    // TEST 2: settings.json has schoolUrl, hasSession is true, but fetchCanvasData fails with unauthorized
    // =========================================================================
    console.log("\n--- Challenger Test 2: hasSession is true but fetchCanvasData returns unauthorized ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await setupDomObserver(page);
      
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loginCanvas: () => {},
          onCanvasLoginSuccess: () => {},
          fetchCanvasData: async () => {
            // Simulate API 401 unauthorized error
            await new Promise(resolve => setTimeout(resolve, 300)); // simulate network latency
            throw new Error("unauthorized");
          },
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test-school.edu' }),
          saveSchedule: () => {},
          loadSchedule: async () => '',
          resizeWindow: () => {},
          hasSession: async () => true
        };
      });
      
      await page.goto(`http://localhost:${port}`);
      await page.waitForSelector('text=Connect to Canvas', { timeout: 5000 });
      
      const domStates = await page.evaluate(() => window.__domStates);
      console.log("Recorded DOM States (Test 2):", JSON.stringify(domStates, null, 2));
      
      // We must NEVER find a state where hasAppContainer is true AND hasAuthModal is false.
      const leakedDashboardState = domStates.find(s => s.hasAppContainer && !s.hasAuthModal && !s.hasLoader);
      if (leakedDashboardState) {
        console.error("LEAK DETECTED: Dashboard rendered without AuthModal overlay during unauthorized session check!", leakedDashboardState);
        throw new Error("Security / UI Bypass flash detected!");
      }
      
      console.log("Test 2 Passed: No dashboard flash when cookie is invalid!");
      await context.close();
    }

    // =========================================================================
    // TEST 3: settings.json has schoolUrl, hasSession is true, and fetchCanvasData succeeds
    // =========================================================================
    console.log("\n--- Challenger Test 3: Valid Session transitions directly to dashboard without flashing AuthModal ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await setupDomObserver(page);
      
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loginCanvas: () => {},
          onCanvasLoginSuccess: () => {},
          fetchCanvasData: async () => {
            return [
              {
                id: 'task-valid',
                type: 'deadline',
                title: 'Valid Session Active Task',
                course: 'MATH 101',
                dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
                completed: false
              }
            ];
          },
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test-school.edu' }),
          saveSchedule: () => {},
          loadSchedule: async () => '',
          resizeWindow: () => {},
          hasSession: async () => true
        };
      });
      
      await page.goto(`http://localhost:${port}`);
      await page.waitForSelector('text=Valid Session Active Task', { timeout: 5000 });
      
      const domStates = await page.evaluate(() => window.__domStates);
      console.log("Recorded DOM States (Test 3):", JSON.stringify(domStates.map(s => ({
        hasAppContainer: s.hasAppContainer,
        hasAuthModal: s.hasAuthModal,
        hasLoader: s.hasLoader,
        textContent: s.textContent
      })), null, 2));
      
      // We must NEVER find a state where hasAuthModal is true.
      const leakedAuthModalState = domStates.find(s => s.hasAuthModal);
      if (leakedAuthModalState) {
        console.error("LEAK DETECTED: AuthModal login screen briefly rendered/flashed for a valid session!", leakedAuthModalState);
        throw new Error("UI AuthModal flash detected!");
      }
      
      console.log("Test 3 Passed: Transitions directly to dashboard without flashing AuthModal!");
      await context.close();
    }

  } catch (err) {
    console.error("CHALLENGER VERIFICATION FAILED:", err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (serverProcess) {
      console.log("Stopping Vite server...");
      serverProcess.kill();
    }
  }
  
  process.exit(exitCode);
}

runTests();
