import { chromium } from 'playwright';
import { spawn } from 'child_process';
import assert from 'assert';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startViteServer() {
  console.log("Starting Vite dev server for verification...");
  const child = spawn('npx', ['vite', '--port', '5173'], { shell: true });
  
  return new Promise((resolve, reject) => {
    let resolved = false;
    child.stdout.on('data', (data) => {
      const output = data.toString();
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

const SAMPLE_TSV = `Time Slot\tMon 08/06\tTue 09/06
7:30AM - 9:00AM\t- CCINOV8 - INNOVATION AND TECHNOLOGY MANAGEMENT Offline Venue : Online Teacher : Melvin Gabriel Ignacio Room No :\t
9:15AM - 10:45AM\t\t- CS410 - OPERATING SYSTEMS Offline Venue : Room 302 Teacher : Dr. John Smith Room No : 302`;

async function runVerification() {
  let serverProcess;
  let browser;
  let exitCode = 0;
  
  try {
    serverProcess = await startViteServer();
    console.log("Vite dev server started for verification.");
    
    browser = await chromium.launch({ headless: true });
    
    // --- VERIFICATION 1: Window Resizing Presets ---
    console.log("\n--- VERIFICATION 1: Size Presets & Resizing ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      let resizedTo = null;
      let savedSettings = null;
      
      page.on('console', msg => console.log('PAGE LOG:', msg.text()));
      page.on('pageerror', err => console.error('PAGE ERROR:', err.stack || err.message));

      await page.addInitScript(() => {
        let currentSettings = { size: 'Small', schoolUrl: 'mytest.edu' };
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
          fetchCanvasData: async () => [],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: (settings) => {
            console.log("window.api.saveSettings called with:", JSON.stringify(settings));
            currentSettings = settings;
            window.__savedSettings = settings;
          },
          loadSettings: async () => {
            console.log("window.api.loadSettings called, returning:", JSON.stringify(currentSettings));
            return currentSettings;
          },
          saveSchedule: () => {},
          loadSchedule: async () => '',
          resizeWindow: (size) => {
            console.log("window.api.resizeWindow called with:", size);
            window.__resizedTo = size;
          }
        };
      });
      
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      // Go to Settings tab
      await page.click('button[aria-label="Settings"]');
      await sleep(200);
      
      // Click Medium
      await page.click('button:has-text("Medium")');
      await sleep(100);
      resizedTo = await page.evaluate(() => window.__resizedTo);
      savedSettings = await page.evaluate(() => window.__savedSettings);
      assert.strictEqual(resizedTo, 'Medium', 'Should call resizeWindow with Medium');
      assert.strictEqual(savedSettings.size, 'Medium', 'Should save size Medium in settings');
      console.log("Snapped to Medium verified.");
      
      // Click Large
      await page.click('button:has-text("Large")');
      await sleep(100);
      resizedTo = await page.evaluate(() => window.__resizedTo);
      savedSettings = await page.evaluate(() => window.__savedSettings);
      assert.strictEqual(resizedTo, 'Large', 'Should call resizeWindow with Large');
      assert.strictEqual(savedSettings.size, 'Large', 'Should save size Large in settings');
      console.log("Snapped to Large verified.");
      
      // Click Small
      await page.click('button:has-text("Small")');
      await sleep(100);
      resizedTo = await page.evaluate(() => window.__resizedTo);
      savedSettings = await page.evaluate(() => window.__savedSettings);
      assert.strictEqual(resizedTo, 'Small', 'Should call resizeWindow with Small');
      assert.strictEqual(savedSettings.size, 'Small', 'Should save size Small in settings');
      console.log("Snapped to Small verified.");
      
      console.log("VERIFICATION 1 PASSED!");
      await context.close();
    }
    
    // --- VERIFICATION 2: Schedule Visualizer, Buttons Layout, Back Navigation ---
    console.log("\n--- VERIFICATION 2: Schedule Visualizer & Buttons ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      let savedTSV = null;
      
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
          fetchCanvasData: async () => [],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Small', schoolUrl: 'mytest.edu' }),
          saveSchedule: (tsv) => {
            window.__savedTSV = tsv;
          },
          loadSchedule: async () => ''
        };
      });
      
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      // Go to Calendar tab
      await page.click('button[aria-label="Calendar"]');
      await sleep(200);
      
      // 1. Check side-by-side buttons existence and layout
      const scheduleBtn = page.locator('button:has-text("Schedule")');
      const importBtn = page.locator('button:has-text("Import")');
      
      await expect(scheduleBtn).toBeVisible();
      await expect(importBtn).toBeVisible();
      
      // Let's verify padding
      const schedulePadding = await scheduleBtn.evaluate(el => window.getComputedStyle(el).padding);
      const importPadding = await importBtn.evaluate(el => window.getComputedStyle(el).padding);
      console.log(`Schedule Button Padding: ${schedulePadding}`);
      console.log(`Import Button Padding: ${importPadding}`);
      
      assert.ok(schedulePadding.includes('6px') && schedulePadding.includes('14px'), 'Schedule button should have 6px 14px padding');
      assert.ok(importPadding.includes('6px') && importPadding.includes('14px'), 'Import button should have 6px 14px padding');
      
      // 2. Click Import, input TSV data and save
      await importBtn.click();
      await sleep(100);
      
      await page.fill('textarea[placeholder="Paste schedule table..."]', SAMPLE_TSV);
      await page.click('button:has-text("Save")');
      await sleep(200);
      
      savedTSV = await page.evaluate(() => window.__savedTSV);
      assert.strictEqual(savedTSV, SAMPLE_TSV, 'Save schedule IPC should be called with correct TSV text');
      console.log("TSV schedule successfully saved.");
      
      // 3. View schedule visualizer and check content
      await page.click('button:has-text("View")');
      await sleep(200);
      
      const title = page.locator('h2:has-text("Your Schedule")');
      await expect(title).toBeVisible();
      
      // Check Mon class (Online)
      await page.click('button:has-text("MON")');
      await sleep(100);
      const monClassCode = page.locator('text=CCINOV8');
      const monClassTitle = page.locator('text=INNOVATION AND TECHNOLOGY MANAGEMENT');
      const monClassOnline = page.locator('text=Online');
      await expect(monClassCode).toBeVisible();
      await expect(monClassTitle).toBeVisible();
      await expect(monClassOnline).toHaveCount(2); // One is in venue tag, one is 'Online' badge. Let's make sure it is visible.
      
      // Check Tue class (Offline)
      await page.click('button:has-text("TUE")');
      await sleep(100);
      const tueClassCode = page.locator('text=CS410');
      const tueClassTitle = page.locator('text=OPERATING SYSTEMS');
      const tueClassVenue = page.locator('text=Room 302');
      await expect(tueClassCode).toBeVisible();
      await expect(tueClassTitle).toBeVisible();
      await expect(tueClassVenue).toBeVisible();
      console.log("TSV schedule data rendering correctly verified.");
      
      // 4. Test back navigation
      await page.click('button:has-text("Back")');
      await sleep(200);
      
      // We should be back on the monthly calendar grid view, and "Your Schedule" title should be gone.
      await expect(title).not.toBeVisible();
      const firstWeekdayLabel = page.locator('div:has-text("S")').first();
      await expect(firstWeekdayLabel).toBeVisible();
      console.log("Back navigation to monthly calendar grid view verified.");
      
      console.log("VERIFICATION 2 PASSED!");
      await context.close();
    }
    
    // --- VERIFICATION 3: Settings and Schedule Data Persistence ---
    console.log("\n--- VERIFICATION 3: Settings & Schedule Persistence ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.addInitScript((tsvData) => {
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
          fetchCanvasData: async () => [],
          startCanvasPolling: () => {},
          onCanvasDataUpdate: () => { return () => {}; },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Medium', schoolUrl: 'persisted-school.edu' }),
          saveSchedule: () => {},
          loadSchedule: async () => tsvData
        };
      }, SAMPLE_TSV);
      
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      // Check auto authentication (skipped AuthModal because schoolUrl was loaded)
      const connectHeading = page.locator('text=Connect to Canvas');
      await expect(connectHeading).not.toBeVisible();
      console.log("Bypassed AuthModal using loaded setting schoolUrl.");
      
      // Check widget size loaded correctly on start (we mocked it as Medium)
      await page.click('button[aria-label="Settings"]');
      await sleep(200);
      
      const mediumButton = page.locator('button:has-text("Medium")');
      const className = await mediumButton.evaluate(el => el.className);
      assert.ok(className.includes('active'), 'Medium preset button should be active on startup');
      console.log("Widget size loaded correctly on start.");
      
      // Check schedule data loaded correctly on start
      await page.click('button[aria-label="Calendar"]');
      await sleep(200);
      await page.click('button:has-text("Schedule")');
      await sleep(200);
      
      // Check MON class CCINOV8 loaded and rendered
      await page.click('button:has-text("MON")');
      await sleep(100);
      await expect(page.locator('text=CCINOV8')).toBeVisible();
      console.log("Schedule text loaded and rendered correctly on start.");
      
      console.log("VERIFICATION 3 PASSED!");
      await context.close();
    }
    
  } catch (err) {
    console.error("VERIFICATION RUN FAILED:", err);
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

function expect(locator) {
  return {
    toBeVisible: async () => {
      const isVisible = await locator.isVisible();
      if (!isVisible) {
        throw new Error(`Element ${locator.toString()} is not visible`);
      }
    },
    not: {
      toBeVisible: async () => {
        const isVisible = await locator.isVisible();
        if (isVisible) {
          throw new Error(`Element ${locator.toString()} is visible, but should not be`);
        }
      }
    },
    toHaveCount: async (expectedCount) => {
      const count = await locator.count();
      if (count !== expectedCount) {
        throw new Error(`Expected count ${expectedCount}, but got ${count}`);
      }
    }
  };
}

runVerification();
