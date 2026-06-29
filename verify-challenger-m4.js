import { chromium } from 'playwright';
import { spawn } from 'child_process';
import assert from 'assert';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const appUrl = `http://localhost:${port}`;
    
    // =========================================================================
    // VERIFICATION 1: Default widget size when settings.json is deleted or not found
    // =========================================================================
    console.log("\n--- Verification 1: Default widget size (settings.json not found) ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
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
          loadSettings: async () => null,
          loadSchedule: async () => '',
          hasSession: async () => false,
          fetchCanvasData: async () => [
            {
              id: 'task-1',
              type: 'deadline',
              title: 'Default Size Test Task',
              course: 'TEST 101',
              dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
              completed: false
            }
          ],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          resizeWindow: () => {}
        };
      });
      
      await page.goto(appUrl);
      await page.waitForSelector('text=Connect to Canvas', { timeout: 5000 });
      
      let hasCompactModeClass = await page.evaluate(() => {
        return document.querySelector('.app-container').classList.contains('compact-mode');
      });
      assert.strictEqual(hasCompactModeClass, false, "Container should not have compact-mode by default at login screen");
      
      await page.fill('input[placeholder="canvas.edu"]', 'test-school.edu');
      await page.click('button[type="submit"]');
      await page.waitForSelector('text=Default Size Test Task', { timeout: 5000 });
      
      hasCompactModeClass = await page.evaluate(() => {
        return document.querySelector('.app-container').classList.contains('compact-mode');
      });
      assert.strictEqual(hasCompactModeClass, false, "Container should not have compact-mode by default on dashboard");
      console.log("Verified: Default widget size is Medium (no compact-mode class applied).");
      
      await page.click('button[aria-label="Settings"]');
      await sleep(200);
      
      const mediumBtnClass = await page.locator('button:has-text("Medium")').getAttribute('class');
      assert.ok(mediumBtnClass.includes('active'), "Medium size preset button should be active when settings.json is missing");
      console.log("Verified: 'Medium' size preset button is active on startup.");
      
      await context.close();
    }
    
    // =========================================================================
    // VERIFICATION 2: CSS scaling behavior in compact mode
    // =========================================================================
    console.log("\n--- Verification 2: CSS scaling behavior in compact mode ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test-school.edu' }),
          loadSchedule: async () => '',
          hasSession: async () => true,
          fetchCanvasData: async () => [
            {
              id: 'task-1',
              type: 'deadline',
              title: 'Compact Size Test Task',
              course: 'TEST 101',
              dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
              completed: false
            }
          ],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          resizeWindow: () => {}
        };
      });
      
      await page.goto(appUrl);
      await page.waitForSelector('text=Compact Size Test Task', { timeout: 5000 });
      
      const hasCompactModeClass = await page.evaluate(() => {
        return document.querySelector('.app-container').classList.contains('compact-mode');
      });
      assert.strictEqual(hasCompactModeClass, true, "Container should have compact-mode class in Small size");
      
      const computedStyles = await page.evaluate(() => {
        const container = document.querySelector('.app-container');
        const style = window.getComputedStyle(container);
        return {
          tabBtnSize: style.getPropertyValue('--tab-btn-size').trim(),
          tabBtnGap: style.getPropertyValue('--tab-btn-gap').trim(),
          tabPaddingX: style.getPropertyValue('--tab-padding-x').trim()
        };
      });
      
      console.log("Compact mode CSS custom variables:", computedStyles);
      assert.strictEqual(computedStyles.tabBtnSize, '26px', "--tab-btn-size should be 26px in compact mode");
      assert.strictEqual(computedStyles.tabBtnGap, '4px', "--tab-btn-gap should be 4px in compact mode");
      assert.strictEqual(computedStyles.tabPaddingX, '8px', "--tab-padding-x should be 8px in compact mode");
      
      const btnBounds = await page.locator('button[aria-label="Calendar"]').boundingBox();
      console.log(`Calendar button bounding box in compact mode:`, btnBounds);
      assert.ok(Math.abs(btnBounds.width - 26) < 1, "Calendar button width should be close to 26px");
      assert.ok(Math.abs(btnBounds.height - 26) < 1, "Calendar button height should be close to 26px");
      console.log("Verified: Custom properties and actual element sizes scale down in compact mode.");
      
      await context.close();
    }
    
    // =========================================================================
    // VERIFICATION 3: Corner clipping prevention for the FAB button
    // =========================================================================
    console.log("\n--- Verification 3: Corner clipping prevention for the FAB button ---");
    {
      // --- PART 3A: Medium Mode FAB ---
      let containerBoundsMedium;
      let fabBoundsMedium;
      let distanceMedium;
      {
        const context = await browser.newContext();
        const page = await context.newPage();
        
        await page.addInitScript(() => {
          window.api = {
            closeApp: () => {},
            minimizeApp: () => {},
            loadSettings: async () => ({ size: 'Medium', schoolUrl: 'https://test-school.edu' }),
            loadSchedule: async () => '',
            hasSession: async () => true,
            fetchCanvasData: async () => [
              {
                id: 'task-1',
                type: 'deadline',
                title: 'FAB Test Task',
                course: 'TEST 101',
                dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
                completed: false
              }
            ],
            startCanvasPolling: () => {},
            onCanvasDataUpdate: () => { return () => {}; },
            saveSettings: () => {},
            resizeWindow: () => {}
          };
        });
        
        await page.goto(appUrl);
        await page.waitForSelector('text=FAB Test Task', { timeout: 5000 });
        
        await page.hover('.app-container');
        await sleep(500); // Allow fade-in
        
        containerBoundsMedium = await page.locator('.app-container').boundingBox();
        fabBoundsMedium = await page.locator('.fab').boundingBox();
        
        const containerBR = {
          x: containerBoundsMedium.x + containerBoundsMedium.width,
          y: containerBoundsMedium.y + containerBoundsMedium.height
        };
        const fabBR = {
          x: fabBoundsMedium.x + fabBoundsMedium.width,
          y: fabBoundsMedium.y + fabBoundsMedium.height
        };
        
        const dx = containerBR.x - fabBR.x;
        const dy = containerBR.y - fabBR.y;
        distanceMedium = Math.sqrt(dx * dx + dy * dy);
        
        console.log(`Container bounds (Medium):`, containerBoundsMedium);
        console.log(`FAB bounds (Medium):`, fabBoundsMedium);
        console.log(`Distance from container BR corner to FAB BR corner (Medium): ${distanceMedium.toFixed(2)}px`);
        
        assert.ok(distanceMedium <= 28, "FAB bottom-right corner must be within 28px of the container's bottom-right corner to prevent clipping");
        console.log("Verified: FAB is not clipped in Medium mode.");
        await context.close();
      }
      
      // --- PART 3B: Compact (Small) Mode FAB ---
      let containerBoundsSmall;
      let fabBoundsSmall;
      let distanceSmall;
      {
        const context = await browser.newContext();
        const page = await context.newPage();
        
        await page.addInitScript(() => {
          window.api = {
            closeApp: () => {},
            minimizeApp: () => {},
            loadSettings: async () => ({ size: 'Small', schoolUrl: 'https://test-school.edu' }),
            loadSchedule: async () => '',
            hasSession: async () => true,
            fetchCanvasData: async () => [
              {
                id: 'task-1',
                type: 'deadline',
                title: 'FAB Test Task',
                course: 'TEST 101',
                dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
                completed: false
              }
            ],
            startCanvasPolling: () => {},
            onCanvasDataUpdate: () => { return () => {}; },
            saveSettings: () => {},
            resizeWindow: () => {}
          };
        });
        
        await page.goto(appUrl);
        await page.waitForSelector('text=FAB Test Task', { timeout: 5000 });
        
        await page.hover('.app-container');
        await sleep(500); // Allow fade-in
        
        containerBoundsSmall = await page.locator('.app-container').boundingBox();
        fabBoundsSmall = await page.locator('.fab').boundingBox();
        
        const containerBR = {
          x: containerBoundsSmall.x + containerBoundsSmall.width,
          y: containerBoundsSmall.y + containerBoundsSmall.height
        };
        const fabBR = {
          x: fabBoundsSmall.x + fabBoundsSmall.width,
          y: fabBoundsSmall.y + fabBoundsSmall.height
        };
        
        const dx = containerBR.x - fabBR.x;
        const dy = containerBR.y - fabBR.y;
        distanceSmall = Math.sqrt(dx * dx + dy * dy);
        
        console.log(`Container bounds (Small):`, containerBoundsSmall);
        console.log(`FAB bounds (Small):`, fabBoundsSmall);
        console.log(`Distance from container BR corner to FAB BR corner (Small): ${distanceSmall.toFixed(2)}px`);
        
        assert.ok(distanceSmall <= 40, "FAB bottom-right corner must be within 40px of the container's bottom-right corner to prevent clipping in compact mode");
        console.log("Verified: FAB is not clipped in Small mode.");
        await context.close();
      }
    }
    
    // =========================================================================
    // VERIFICATION 4: WatchOS style large-type glanceability
    // =========================================================================
    console.log("\n--- Verification 4: WatchOS style large-type glanceability ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.addInitScript(() => {
        window.api = {
          closeApp: () => {},
          minimizeApp: () => {},
          loadSettings: async () => ({ size: 'Medium', schoolUrl: 'https://test-school.edu' }),
          loadSchedule: async () => '',
          hasSession: async () => true,
          fetchCanvasData: async () => [
            {
              id: 'task-1',
              type: 'deadline',
              title: 'Super Long Course Title that needs to be clamped cleanly without overflow or breaking the layout',
              course: 'CS 410 - Operating Systems and Systems Programming',
              dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
              completed: false
            }
          ],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          resizeWindow: () => {}
        };
      });
      
      await page.goto(appUrl);
      await page.waitForSelector('text=Super Long Course Title', { timeout: 5000 });
      
      // Verify pure black OLED backgrounds
      const bgColor = await page.evaluate(() => {
        return window.getComputedStyle(document.querySelector('.app-container')).backgroundColor;
      });
      console.log(`App container background color: ${bgColor}`);
      assert.ok(bgColor === 'rgb(0, 0, 0)' || bgColor === '#000000', "Background must be pure black for OLED");
      
      // Verify visual style elements
      const cardStyles = await page.evaluate(() => {
        const card = document.querySelector('.agenda-item');
        const style = window.getComputedStyle(card);
        const title = card.querySelector('.item-title');
        const titleStyle = window.getComputedStyle(title);
        const course = card.querySelector('.item-course');
        const courseStyle = window.getComputedStyle(course);
        
        return {
          cardBg: style.backgroundColor,
          cardRadius: style.borderRadius,
          titleFont: titleStyle.font,
          titleFontSize: titleStyle.fontSize,
          titleFontWeight: titleStyle.fontWeight,
          courseFontSize: courseStyle.fontSize
        };
      });
      
      console.log("Card & typography styles:", cardStyles);
      assert.ok(cardStyles.cardBg.includes('rgb(28, 28, 30)'), "Card background should be subtle watchOS gray #1c1c1e");
      assert.strictEqual(cardStyles.cardRadius, '14px', "Card border-radius should be 14px");
      assert.strictEqual(cardStyles.titleFontSize, '14px', "Glanceable title font-size must be 14px");
      assert.ok(parseInt(cardStyles.titleFontWeight) >= 600, "Glanceable title font-weight must be bold (600+)");
      console.log("Verified: Typography sizes and card styling meet watchOS large-type glanceability specs.");
      
      // Verify line clamping prevents visual bleed / overflow
      const titleHeight = await page.locator('.item-title').evaluate(el => el.clientHeight);
      const titleLineHeight = await page.locator('.item-title').evaluate(el => parseInt(window.getComputedStyle(el).lineHeight));
      console.log(`Title element height: ${titleHeight}px, line-height: ${titleLineHeight}px`);
      assert.ok(titleHeight <= (titleLineHeight * 2 + 5), "Title should be line clamped to at most 2 lines to prevent layout overflow");
      console.log("Verified: Long titles are properly line-clamped.");
      
      await context.close();
    }
    
    console.log("\nALL CHALLENGER VERIFICATION TESTS PASSED SUCCESSFULLY!");
  } catch (err) {
    console.error("CHALLENGER VERIFICATION FAILED:", err);
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

runTests();
