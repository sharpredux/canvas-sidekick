import { chromium } from 'playwright';
import { spawn } from 'child_process';
import assert from 'assert';


async function startViteServer() {
  console.log("Starting Vite dev server for auth scenario validation...");
  const child = spawn('npx', ['vite', '--port', '5173'], { shell: true });
  
  return new Promise((resolve, reject) => {
    let resolved = false;
    child.stdout.on('data', (data) => {
      const output = data.toString();
      console.log("[Vite]", output.trim());
      const match = output.match(/http:\/\/localhost:(\d+)/);
      if (match) {
        if (!resolved) {
          resolved = true;
          resolve({ child, port: match[1] });
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
        resolve({ child, port: '5173' });
      }
    }, 5000);
  });
}

async function runScenarioTests() {
  let serverProcess;
  let browser;
  let exitCode = 0;
  
  try {
    const { child, port } = await startViteServer();
    serverProcess = child;
    console.log(`Vite dev server started on port ${port}!`);
    
    browser = await chromium.launch({ headless: true });
    const appUrl = `http://localhost:${port}`;
    
    // =========================================================================
    // SCENARIO 1: settings.json has schoolUrl but NO session cookie exists
    // =========================================================================
    console.log("\n--- SCENARIO 1: settings.json has schoolUrl, missing session cookie ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Inject API mocking settings.json schoolUrl but hasSession = false
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test-school.edu' }),
          loadSchedule: async () => '',
          hasSession: async () => false, // missing session cookie
          fetchCanvasData: async () => {
            throw new Error('no_cookie');
          }
        };
      });
      
      await page.goto(appUrl);
      await page.waitForLoadState('networkidle');
      
      // Verify login modal is visible and interactive
      const connectHeading = page.locator('text=Connect to Canvas');
      await connectHeading.waitFor({ state: 'visible', timeout: 5000 });
      console.log("Login modal is visible.");
      
      // Ensure dashboard main area is NOT visible or interactive (covered by modal)
      const mockItemsList = page.locator('text=Operating Systems Lecture');
      const isMockItemVisible = await mockItemsList.isVisible();
      assert.strictEqual(isMockItemVisible, false, "Dashboard content must NOT be visible under AuthModal");
      console.log("Verified dashboard content is not leaked/visible.");
      
      await context.close();
      console.log("SCENARIO 1 PASSED!");
    }
    
    // =========================================================================
    // SCENARIO 2: settings.json has schoolUrl, cookie is present but expired/invalid
    // =========================================================================
    console.log("\n--- SCENARIO 2: settings.json has schoolUrl, invalid/expired session cookie ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Inject API mocking hasSession = true (file exists) but fetchCanvasData throws 'unauthorized'
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test-school.edu' }),
          loadSchedule: async () => '',
          hasSession: async () => true, // cookie file exists
          fetchCanvasData: async () => {
            throw new Error('unauthorized'); // invalid/expired
          }
        };
      });
      
      await page.goto(appUrl);
      await page.waitForLoadState('networkidle');
      
      // Verify modal is visible (transitioned cleanly to login without crash or loop)
      const connectHeading = page.locator('text=Connect to Canvas');
      await connectHeading.waitFor({ state: 'visible', timeout: 5000 });
      console.log("Login modal is visible after unauthorized error.");
      
      // Verify no crash/loop (we can verify page is responsive by interacting with login)
      const input = page.locator('input[placeholder="canvas.edu"]');
      await input.fill('interactive.edu');
      const inputValue = await input.inputValue();
      assert.strictEqual(inputValue, 'interactive.edu', "Login input should be fully interactive");
      console.log("Verified login modal is interactive and did not crash or loop.");
      
      await context.close();
      console.log("SCENARIO 2 PASSED!");
    }
    
    // =========================================================================
    // SCENARIO 3: settings.json has schoolUrl and cookie is valid
    // =========================================================================
    console.log("\n--- SCENARIO 3: settings.json has schoolUrl, valid session cookie ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      let modalRendered = false;
      
      // Listen to DOM elements to check if login modal is ever added
      page.on('console', msg => {
        if (msg.text().includes('AuthModal rendered')) {
          modalRendered = true;
        }
      });
      
      // Inject API mocking valid session
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test-school.edu' }),
          loadSchedule: async () => '',
          hasSession: async () => true,
          fetchCanvasData: async () => [
            {
              id: 'valid-1',
              type: 'deadline',
              title: 'Valid Cookie Task',
              course: 'VC 101',
              dueDate: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
              completed: false
            }
          ],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; }
        };
      });
      
      await page.goto(appUrl);
      
      // Wait for the main task from mock data to appear
      const taskLocator = page.locator('text=Valid Cookie Task');
      await taskLocator.waitFor({ state: 'visible', timeout: 5000 });
      console.log("Main dashboard content rendered successfully.");
      
      // Verify login modal is not visible
      const connectHeading = page.locator('text=Connect to Canvas');
      const isModalVisible = await connectHeading.isVisible();
      assert.strictEqual(isModalVisible, false, "Login modal should NOT be visible when session is valid");
      assert.strictEqual(modalRendered, false, "Login modal console log should not be observed");
      console.log("Verified login modal is not shown.");
      
      await context.close();
      console.log("SCENARIO 3 PASSED!");
    }
    
  } catch (err) {
    console.error("SCENARIO TESTS FAILED:", err);
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

runScenarioTests();
