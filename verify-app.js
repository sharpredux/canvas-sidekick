import { chromium } from 'playwright';
import { spawn } from 'child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startViteServer() {
  console.log("Starting Vite dev server...");
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

async function runTests() {
  let serverProcess;
  let browser;
  let exitCode = 0;
  
  try {
    serverProcess = await startViteServer();
    console.log("Vite dev server started!");
    
    browser = await chromium.launch({ headless: true });
    
    // --- TEST 1: Browser Fallback ---
    console.log("\n--- TEST 1: Running Browser Fallback Test ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      page.on('console', msg => console.log('PAGE LOG:', msg.text()));
      page.on('pageerror', err => console.error('PAGE ERROR:', err.stack || err.message));
      
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      const heading = page.locator('h2');
      await expectText(heading, 'Connect to Canvas');
      
      await page.fill('input[placeholder="canvas.edu"]', 'mycanvas.edu');
      await page.click('button[type="submit"]');
      
      await page.waitForSelector('text=Authenticated Successfully!', { timeout: 5000 });
      console.log("Auth successful status seen.");
      
      try {
        await page.waitForSelector('text=Weekly Quiz 4', { timeout: 10000 });
        console.log("Mock data loaded successfully in browser fallback mode.");
      } catch (err) {
        console.log("Timeout waiting for Weekly Quiz 4. HTML Content:");
        const bodyContent = await page.evaluate(() => document.body.innerHTML);
        console.log(bodyContent);
        throw err;
      }
      
      await testTabs(page);
      console.log("TEST 1 PASSED!");
      await context.close();
    }
    
    // --- TEST 2: Electron API Success ---
    console.log("\n--- TEST 2: Running Electron API Success Test ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      page.on('console', msg => console.log('PAGE LOG:', msg.text()));
      page.on('pageerror', err => console.error('PAGE ERROR:', err.stack || err.message));
      
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loginCanvas: () => {
            setTimeout(() => {
              if (window.__triggerCanvasLoginSuccess) window.__triggerCanvasLoginSuccess();
            }, 100);
          },
          onCanvasLoginSuccess: (callback) => {
            window.__triggerCanvasLoginSuccess = callback;
          },
          fetchCanvasData: async () => {
            return [
              {
                id: 'custom-1',
                type: 'deadline',
                title: 'Real Electron Task 1',
                course: 'EL 101',
                dueDate: new Date(Date.now() + 1000 * 60 * 60 * 10).toISOString(),
                completed: false
              }
            ];
          },
          startCanvasPolling: () => {},
          onCanvasDataUpdate: (cb) => {
            window.__triggerCanvasDataUpdate = cb;
            return () => {};
          },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Small' }),
          saveSchedule: () => {},
          loadSchedule: async () => '',
          resizeWindow: () => {}
        };
      });
      
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      await page.fill('input[placeholder="canvas.edu"]', 'electron-canvas.edu');
      await page.click('button[type="submit"]');
      
      await page.waitForSelector('text=Real Electron Task 1', { timeout: 5000 });
      console.log("Custom Electron Canvas data rendered successfully.");
      
      await testTabs(page);
      console.log("TEST 2 PASSED!");
      await context.close();
    }
    
    // --- TEST 3: Electron API Failure (Robustness) ---
    console.log("\n--- TEST 3: Running Electron API Failure Test ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      page.on('console', msg => console.log('PAGE LOG:', msg.text()));
      page.on('pageerror', err => console.error('PAGE ERROR:', err.stack || err.message));
      
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loginCanvas: () => {
            setTimeout(() => {
              if (window.__triggerCanvasLoginSuccess) window.__triggerCanvasLoginSuccess();
            }, 100);
          },
          onCanvasLoginSuccess: (callback) => {
            window.__triggerCanvasLoginSuccess = callback;
          },
          fetchCanvasData: async () => {
            throw new Error("IPC Connection Timeout!");
          },
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => {
            return () => {};
          },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Medium' }),
          saveSchedule: () => {},
          loadSchedule: async () => '',
          resizeWindow: () => {}
        };
      });
      
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      await page.fill('input[placeholder="canvas.edu"]', 'failing-canvas.edu');
      await page.click('button[type="submit"]');
      
      await page.waitForSelector('text=Weekly Quiz 4', { timeout: 5000 });
      console.log("State machine successfully recovered from IPC error and loaded mock data fallback.");
      
      await testTabs(page);
      console.log("TEST 3 PASSED!");
      await context.close();
    }
    
    // --- TEST 4: Tab Event Edge Cases ---
    console.log("\n--- TEST 4: Running Tab Event Edge Cases Test ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      page.on('console', msg => console.log('PAGE LOG:', msg.text()));
      page.on('pageerror', err => console.error('PAGE ERROR:', err.stack || err.message));
      
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      await page.fill('input[placeholder="canvas.edu"]', 'tabtest.edu');
      await page.click('button[type="submit"]');
      await page.waitForSelector('text=Weekly Quiz 4', { timeout: 10000 });
      
      // Try to click near border at offset (5, 5) which is inside circular boundary
      const tabs = ['Calendar', 'Up Next', 'Tasks', 'Updates', 'Settings'];
      for (const tabId of tabs) {
        const btn = page.locator(`button[aria-label="${tabId}"]`);
        const box = await btn.boundingBox();
        if (box) {
          console.log(`Clicking ${tabId} at offset (5, 5)...`);
          await btn.click({ position: { x: 5, y: 5 }, force: true });
          await sleep(100);
          const className = await btn.getAttribute('class');
          if (!className.includes('active')) {
            throw new Error(`Failed to activate ${tabId} by clicking at (5, 5)!`);
          }
        }
      }
      
      // Let's also verify that clicking at (2, 2) indeed fails to activate it because of border-radius clipping
      console.log("Verifying edge behavior: clicking at (2, 2) on Tasks tab (currently active is Settings)...");
      const tasksBtn = page.locator('button[aria-label="Tasks"]');
      try {
        await tasksBtn.click({ position: { x: 2, y: 2 }, force: true });
        await sleep(100);
        const className = await tasksBtn.getAttribute('class');
        if (className.includes('active')) {
          console.log("Interesting: Click at (2, 2) succeeded. (Some browsers trigger it anyway).");
        } else {
          console.log("Confirmed edge case: Click at (2, 2) is lost (did not activate tab).");
        }
      } catch (e) {
        console.log("Confirmed edge case: Click at (2, 2) threw or failed:", e.message);
      }
      
      console.log("Performing fast consecutive clicks on different tabs...");
      await page.click('button[aria-label="Calendar"]', { force: true });
      await page.click('button[aria-label="Tasks"]', { force: true });
      await page.click('button[aria-label="Updates"]', { force: true });
      await page.click('button[aria-label="Settings"]', { force: true });
      await sleep(100);
      
      const settingsBtn = page.locator('button[aria-label="Settings"]');
      const activeClass = await settingsBtn.getAttribute('class');
      if (!activeClass.includes('active')) {
        throw new Error("Settings tab failed to activate after fast clicks!");
      }
      console.log("Fast consecutive clicks on different tabs handled correctly.");
      
      console.log("Performing fast consecutive clicks on the same tab...");
      for (let i = 0; i < 5; i++) {
        await page.click('button[aria-label="Up Next"]', { force: true });
      }
      await sleep(100);
      const upNextBtn = page.locator('button[aria-label="Up Next"]');
      const upNextClass = await upNextBtn.getAttribute('class');
      if (!upNextClass.includes('active')) {
        throw new Error("Up Next tab failed to remain active after consecutive duplicate clicks!");
      }
      console.log("Fast duplicate clicks on the same tab handled correctly.");
      
      console.log("TEST 4 PASSED!");
      await context.close();
    }
    
  } catch (err) {
    console.error("TEST RUN FAILED:", err);
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

async function expectText(locator, expected) {
  const text = await locator.innerText();
  if (text.trim() !== expected) {
    throw new Error(`Expected text '${expected}', but got '${text}'`);
  }
}

async function testTabs(page) {
  const tabs = ['Calendar', 'Up Next', 'Tasks', 'Updates', 'Settings'];
  for (const tabId of tabs) {
    await page.click(`button[aria-label="${tabId}"]`, { force: true });
    const btn = page.locator(`button[aria-label="${tabId}"]`);
    const className = await btn.getAttribute('class');
    if (!className.includes('active')) {
      throw new Error(`Tab ${tabId} did not become active on click`);
    }
  }
}

runTests();
