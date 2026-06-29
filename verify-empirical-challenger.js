import { chromium } from 'playwright';
import { spawn } from 'child_process';
import assert from 'assert';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startViteServer() {
  console.log("Starting Vite dev server for empirical verification...");
  const child = spawn('npx', ['vite', '--port', '5173'], { shell: true });
  
  return new Promise((resolve, reject) => {
    let resolved = false;
    let port = '5173';
    child.stdout.on('data', (data) => {
      const output = data.toString();
      console.log("[Vite Output]", output.trim());
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

async function runEmpiricalVerification() {
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
    // ITEM 1: Default widget size when settings.json is deleted or not found
    // =========================================================================
    console.log("\n=== Checking Item 1: Default size is Medium when settings.json is missing ===");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Inject API simulating missing settings file (returning empty object or null)
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
          fetchCanvasData: async () => [
            {
              id: 'm1',
              type: 'deadline',
              title: 'Default Size Test Task',
              course: 'CS 101',
              dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
              completed: false
            }
          ],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          loadSettings: async () => null, // settings.json missing / not found
          saveSchedule: () => {},
          loadSchedule: async () => '',
          resizeWindow: () => {},
          hasSession: async () => true
        };
      });
      
      await page.goto(`http://localhost:${port}`);
      await page.waitForLoadState('networkidle');
      
      // Wait for login screen
      await page.waitForSelector('text=Connect to Canvas', { timeout: 5000 });
      
      // In App.jsx: const [widgetSize, setWidgetSize] = useState('Medium');
      // If loadSettings returns null, widgetSize must remain 'Medium'
      const appContainer = page.locator('.app-container');
      const hasCompactClass = await appContainer.evaluate(el => el.classList.contains('compact-mode'));
      console.log(`Has compact-mode class (Small): ${hasCompactClass}`);
      assert.strictEqual(hasCompactClass, false, "Should not be in compact mode by default when settings.json is missing");
      
      // Perform manual login to navigate to the main dashboard
      await page.fill('input[placeholder="canvas.edu"]', 'test-school.edu');
      await page.click('button[type="submit"]');
      
      // Wait for content area to show the item
      await page.waitForSelector('text=Default Size Test Task', { timeout: 5000 });
      
      // Switch to Settings tab to see if 'Medium' preset is selected
      await page.click('button[aria-label="Settings"]');
      await page.waitForSelector('text=Widget Size', { timeout: 5000 });
      
      // Check if Medium button is active (it has class active or is highlighted)
      const mediumBtn = page.locator('button:has-text("Medium")');
      const mediumClass = await mediumBtn.getAttribute('class');
      console.log(`Medium button class attributes: ${mediumClass}`);
      assert.ok(mediumClass.includes('active'), "Medium size preset button should be active by default");
      
      console.log("Item 1 Passed: Default size is correctly set to 'Medium' when settings.json is not found.");
      await context.close();
    }

    // =========================================================================
    // ITEM 2: The CSS scaling behavior in compact mode
    // =========================================================================
    console.log("\n=== Checking Item 2: CSS Scaling behavior in compact mode ===");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Inject API returning size: 'Small' (compact mode)
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loginCanvas: () => {},
          onCanvasLoginSuccess: () => {},
          fetchCanvasData: async () => [],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test.edu' }),
          saveSchedule: () => {},
          loadSchedule: async () => '',
          resizeWindow: () => {},
          hasSession: async () => true
        };
      });
      
      await page.goto(`http://localhost:${port}`);
      await page.waitForLoadState('networkidle');
      
      const appContainer = page.locator('.app-container');
      const hasCompactClass = await appContainer.evaluate(el => el.classList.contains('compact-mode'));
      console.log(`Has compact-mode class: ${hasCompactClass}`);
      assert.strictEqual(hasCompactClass, true, "Should have compact-mode class in Small widget mode");
      
      // Retrieve CSS variable values overridden in .app-container.compact-mode
      const btnSize = await appContainer.evaluate(el => window.getComputedStyle(el).getPropertyValue('--tab-btn-size').trim());
      const btnGap = await appContainer.evaluate(el => window.getComputedStyle(el).getPropertyValue('--tab-btn-gap').trim());
      const paddingX = await appContainer.evaluate(el => window.getComputedStyle(el).getPropertyValue('--tab-padding-x').trim());
      
      console.log(`Retrieved compact mode variables: --tab-btn-size=${btnSize}, --tab-btn-gap=${btnGap}, --tab-padding-x=${paddingX}`);
      
      assert.strictEqual(btnSize, '26px', "Tab button size should be scaled down to 26px in compact mode");
      assert.strictEqual(btnGap, '4px', "Tab button gap should be scaled down to 4px in compact mode");
      assert.strictEqual(paddingX, '8px', "Tab area horizontal padding should be scaled down to 8px in compact mode");
      
      console.log("Item 2 Passed: CSS scaling properties are correctly applied in compact mode.");
      await context.close();
    }

    // =========================================================================
    // ITEM 3: Corner clipping prevention for the FAB button
    // =========================================================================
    console.log("\n=== Checking Item 3: Corner clipping prevention for the FAB button ===");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Inject API returning size: 'Small' and mock data
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loginCanvas: () => {},
          onCanvasLoginSuccess: () => {},
          fetchCanvasData: async () => [
            {
              id: 't1',
              type: 'deadline',
              title: 'Glanceable Task 1',
              course: 'CS 101',
              dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
              completed: false
            }
          ],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test.edu' }),
          saveSchedule: () => {},
          loadSchedule: async () => '',
          resizeWindow: () => {},
          hasSession: async () => true
        };
      });
      
      await page.goto(`http://localhost:${port}`);
      await page.waitForLoadState('networkidle');
      
      // Hover over the container to make the FAB button visible (opacity: 1)
      const appContainer = page.locator('.app-container');
      await appContainer.hover();
      await sleep(500); // Wait for transition
      
      const fab = page.locator('.fab');
      await fab.waitFor({ state: 'visible', timeout: 5000 });
      
      // Retrieve dimensions
      const containerBox = await appContainer.boundingBox();
      const fabBox = await fab.boundingBox();
      
      console.log(`Container bounds: ${JSON.stringify(containerBox)}`);
      console.log(`FAB bounds: ${JSON.stringify(fabBox)}`);
      
      // Corner radius is 40px in compact mode (.app-container.compact-mode { border-radius: 40px; })
      const cornerRadius = 40;
      
      // Bottom-right corner circle center:
      const cx = containerBox.x + containerBox.width - cornerRadius;
      const cy = containerBox.y + containerBox.height - cornerRadius;
      
      // FAB center:
      const fx = fabBox.x + fabBox.width / 2;
      const fy = fabBox.y + fabBox.height / 2;
      
      // FAB radius:
      const fr = fabBox.width / 2;
      
      // Distance of FAB center from corner circle center:
      const d = Math.sqrt((fx - cx) ** 2 + (fy - cy) ** 2);
      
      // Furthest point on FAB circle from corner circle center:
      const d_max = d + fr;
      
      console.log(`Bottom-right corner center: (${cx}, ${cy})`);
      console.log(`FAB center: (${fx}, ${fy}), FAB radius: ${fr}`);
      console.log(`FAB center distance from corner center: ${d}`);
      console.log(`FAB furthest boundary point distance from corner center: ${d_max}`);
      console.log(`Container Corner Radius: ${cornerRadius}`);
      
      assert.ok(d_max < cornerRadius, `FAB button boundary (${d_max}px) must be inside corner radius (${cornerRadius}px) to prevent clipping`);
      
      // Double check that overflow is indeed hidden on the container
      const overflow = await appContainer.evaluate(el => window.getComputedStyle(el).overflow);
      console.log(`Container overflow style: ${overflow}`);
      assert.strictEqual(overflow, 'hidden', "Container must have overflow: hidden to enforce rounded boundaries");
      
      console.log("Item 3 Passed: FAB button geometry prevents any corner clipping inside the 40px rounded corners.");
      await context.close();
    }

    // =========================================================================
    // ITEM 4: WatchOS style large-type glanceability
    // =========================================================================
    console.log("\n=== Checking Item 4: WatchOS style large-type glanceability ===");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Inject API with multiple items to verify single-item restriction in Small size
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loginCanvas: () => {},
          onCanvasLoginSuccess: () => {},
          fetchCanvasData: async () => [
            {
              id: 't1',
              type: 'deadline',
              title: 'Immediate Task',
              course: 'CS 101 - Intro to CS',
              dueDate: new Date(Date.now() + 300 * 1000).toISOString(), // 5 mins
              completed: false
            },
            {
              id: 't2',
              type: 'deadline',
              title: 'Later Task',
              course: 'MATH 202',
              dueDate: new Date(Date.now() + 3600 * 1000).toISOString(), // 1 hour
              completed: false
            }
          ],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test.edu' }),
          saveSchedule: () => {},
          loadSchedule: async () => '',
          resizeWindow: () => {},
          hasSession: async () => true
        };
      });
      
      await page.goto(`http://localhost:${port}`);
      await page.waitForLoadState('networkidle');
      
      // Verify only 1 task item is rendered in Small mode
      await page.waitForSelector('text=Immediate Task', { timeout: 5000 });
      const agendaItemsCount = await page.locator('.agenda-item').count();
      console.log(`Number of rendered agenda items in Small mode: ${agendaItemsCount}`);
      assert.strictEqual(agendaItemsCount, 1, "Small mode should only render exactly one glanceable task item");
      
      // Check title typography and font size
      const itemTitle = page.locator('.agenda-item .item-title');
      const titleFont = await itemTitle.evaluate(el => window.getComputedStyle(el).font);
      const titleFontSize = await itemTitle.evaluate(el => window.getComputedStyle(el).fontSize);
      const titleFontWeight = await itemTitle.evaluate(el => window.getComputedStyle(el).fontWeight);
      
      console.log(`Title font: ${titleFont}, Font size: ${titleFontSize}, Font weight: ${titleFontWeight}`);
      
      assert.strictEqual(titleFontSize, '14px', "Title font size should be 14px for high legibility");
      assert.ok(titleFontWeight === '600' || titleFontWeight === 'bold', "Title should have bold weight (600) for glanceability");
      
      // Check high contrast background color (OLED Pure Black)
      const appContainer = page.locator('.app-container');
      const bgColor = await appContainer.evaluate(el => window.getComputedStyle(el).backgroundColor);
      console.log(`App container background color: ${bgColor}`);
      // rgb(0, 0, 0) is pure black
      assert.ok(bgColor === 'rgb(0, 0, 0)' || bgColor === '#000000', "Background must be pure black for watchOS style OLED efficiency and contrast");
      
      console.log("Item 4 Passed: WatchOS style large-type glanceability verified successfully.");
      await context.close();
    }

  } catch (err) {
    console.error("EMPIRICAL VERIFICATION FAILED:", err);
    exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (serverProcess) {
      console.log("Stopping Vite dev server...");
      serverProcess.kill();
    }
  }
  
  process.exit(exitCode);
}

runEmpiricalVerification();
