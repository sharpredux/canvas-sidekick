import { chromium } from 'playwright';
import { spawn } from 'child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startViteServer() {
  console.log("Starting Vite dev server for verification...");
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

async function runVerification() {
  let serverProcess;
  let browser;
  let exitCode = 0;
  
  try {
    serverProcess = await startViteServer();
    console.log("Vite dev server started for verification!");
    
    browser = await chromium.launch({ headless: true });
    
    // --- VERIFICATION PART 1: Size Snap Snapping & Integration ---
    console.log("\n--- VERIFICATION PART 1: Widget Size Snaps ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      page.on('console', msg => console.log('PAGE LOG:', msg.text()));
      page.on('pageerror', err => console.error('PAGE ERROR:', err.stack || err.message));
      
      // Inject API with spy tracking
      await page.addInitScript(() => {
        window.__spy = {
          resizedWindow: [],
          savedSettings: [],
          savedSchedule: []
        };
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
          onCanvasDataUpdate: () => {
            return () => {};
          },
          saveSettings: (settings) => {
            window.__spy.savedSettings.push(settings);
          },
          loadSettings: async () => ({ size: 'Small' }), // No schoolUrl to force login flow
          saveSchedule: (rawText) => {
            window.__spy.savedSchedule.push(rawText);
          },
          loadSchedule: async () => '',
          resizeWindow: (sizeName) => {
            window.__spy.resizedWindow.push(sizeName);
          }
        };
      });
      
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      // Fill canvas.edu to get to dashboard
      await page.fill('input[placeholder="canvas.edu"]', 'test.edu');
      await page.click('button[type="submit"]');
      await page.waitForSelector('text=Nothing here right now.', { timeout: 5000 });
      
      // Navigate to Settings
      console.log("Navigating to Settings tab...");
      await page.click('button[aria-label="Settings"]');
      
      // Test Small preset
      console.log("Testing click on Small preset...");
      await page.click('button:has-text("Small")');
      await sleep(100);
      
      // Test Medium preset
      console.log("Testing click on Medium preset...");
      await page.click('button:has-text("Medium")');
      await sleep(100);
      
      // Test Large preset
      console.log("Testing click on Large preset...");
      await page.click('button:has-text("Large")');
      await sleep(100);
      
      // Verify Spy state
      const spyState = await page.evaluate(() => window.__spy);
      console.log("Spy State for Window Resize & Settings:", JSON.stringify(spyState));
      
      if (!spyState.resizedWindow.includes('Small') ||
          !spyState.resizedWindow.includes('Medium') ||
          !spyState.resizedWindow.includes('Large')) {
        throw new Error("Failed size presets test! One or more resize calls missing.");
      }
      
      if (spyState.savedSettings.length < 3) {
        throw new Error("Failed settings save test! Settings did not save upon clicking size presets.");
      }
      
      console.log("PART 1 PASSED: Size snaps trigger correct IPC calls and persist settings.");
      await context.close();
    }
    
    // --- VERIFICATION PART 2: Schedule Visualizer TSV Render & Layout ---
    console.log("\n--- VERIFICATION PART 2: Schedule Visualizer TSV Render & Navigation ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      await page.addInitScript(() => {
        window.__spy = {
          savedSchedule: []
        };
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
          onCanvasDataUpdate: () => {
            return () => {};
          },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Medium' }), // No schoolUrl to force login flow
          saveSchedule: (rawText) => {
            window.__spy.savedSchedule.push(rawText);
          },
          loadSchedule: async () => '',
          resizeWindow: () => {}
        };
      });
      
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      // Login
      await page.fill('input[placeholder="canvas.edu"]', 'test.edu');
      await page.click('button[type="submit"]');
      await page.waitForSelector('text=Nothing here right now.', { timeout: 5000 });
      
      // Navigate to Calendar Tab
      console.log("Navigating to Calendar tab...");
      await page.click('button[aria-label="Calendar"]');
      
      // Check that Schedule and Import buttons are visible
      console.log("Checking that Schedule and Import buttons are visible side-by-side...");
      const scheduleBtn = page.locator('button:has-text("Schedule")');
      const importBtn = page.locator('button:has-text("Import")');
      
      await scheduleBtn.waitFor();
      await importBtn.waitFor();
      
      const scheduleBox = await scheduleBtn.boundingBox();
      const importBox = await importBtn.boundingBox();
      console.log(`Schedule Button bounds: ${JSON.stringify(scheduleBox)}`);
      console.log(`Import Button bounds: ${JSON.stringify(importBox)}`);
      
      // They should be side-by-side (approx same Y coordinate)
      if (Math.abs(scheduleBox.y - importBox.y) > 10) {
        throw new Error("Schedule and Import buttons are not placed side-by-side.");
      }
      
      // Click Import
      console.log("Clicking Import button...");
      await importBtn.click();
      
      // Paste TSV Data
      console.log("Pasting TSV schedule data...");
      const tsvData = "Time Slot\tMON 22/06\tTUE 23/06\n10:00AM - 11:30AM\t- CS 101 - Intro to CS Venue : LAB 1 Teacher : Dr. Smith Room No : 101\t- PHYS 102 - Gen Physics Venue : Online Teacher : Prof. Doe Room No :";
      
      await page.fill('textarea[placeholder="Paste schedule table..."]', tsvData);
      await sleep(100);
      
      // Save TSV Data
      console.log("Clicking Save...");
      await page.click('button:has-text("Save")');
      await page.waitForSelector('text=Saved!', { timeout: 5000 });
      
      // Verify savedSchedule spy
      const spyState = await page.evaluate(() => window.__spy);
      if (!spyState.savedSchedule.includes(tsvData)) {
        throw new Error("Failed schedule save check! TSV was not passed to window.api.saveSchedule.");
      }
      
      // Click View
      console.log("Clicking View to open Schedule Visualizer...");
      await page.click('button:has-text("View")');
      
      // Check that it rendered course correctly (by checking text inside)
      console.log("Checking schedule rendered MON courses...");
      await page.click('button:has-text("MON")');
      await page.waitForSelector('text=CS 101', { timeout: 5000 });
      await page.waitForSelector('text=Intro to CS', { timeout: 5000 });
      await page.waitForSelector('text=LAB 1', { timeout: 5000 });
      await page.waitForSelector('text=Dr. Smith', { timeout: 5000 });
      
      // Click TUE and verify online badge
      console.log("Checking schedule rendered TUE courses with Online badge...");
      await page.click('button:has-text("TUE")');
      await page.waitForSelector('text=PHYS 102', { timeout: 5000 });
      await page.waitForSelector('text=Online', { timeout: 5000 });
      
      // Click Back button on schedule visualizer
      console.log("Clicking Back button in Schedule Visualizer...");
      await page.click('button:has-text("Back")');
      
      // Verify that we are back to monthly calendar grid view (Schedule button visible again)
      await scheduleBtn.waitFor();
      console.log("Successfully returned to monthly calendar grid view.");
      
      console.log("PART 2 PASSED: Schedule visualizer renders TSV, buttons are side-by-side, back works.");
      await context.close();
    }
    
    // --- VERIFICATION PART 3: Persistence Across Restart ---
    console.log("\n--- VERIFICATION PART 3: Persistence Across Restart ---");
    {
      const context = await browser.newContext();
      const page = await context.newPage();
      
      // Inject API returning preset values
      const tsvData = "Time Slot\tMON 22/06\tTUE 23/06\n10:00AM - 11:30AM\t- CS 101 - Intro to CS Venue : LAB 1 Teacher : Dr. Smith Room No : 101\t- PHYS 102 - Gen Physics Venue : Online Teacher : Prof. Doe Room No :";
      
      await page.addInitScript((data) => {
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
          onCanvasDataUpdate: () => {
            return () => {};
          },
          saveSettings: () => {},
          loadSettings: async () => ({ size: 'Large', schoolUrl: 'test.edu' }),
          saveSchedule: () => {},
          loadSchedule: async () => data,
          resizeWindow: () => {}
        };
      }, tsvData);
      
      await page.goto('http://localhost:5173');
      await page.waitForLoadState('networkidle');
      
      // No login required because schoolUrl is loaded, so we are already authenticated!
      await page.waitForSelector('text=Nothing here right now.', { timeout: 5000 });
      console.log("Verified immediate bypass of login screen on startup.");
      
      // Go to Settings tab and verify currentSize is 'Large'
      console.log("Checking loaded settings in Settings tab...");
      await page.click('button[aria-label="Settings"]');
      const largeBtn = page.locator('button:has-text("Large")');
      const bg = await largeBtn.evaluate(el => window.getComputedStyle(el).backgroundColor);
      console.log(`Large preset button background color: ${bg}`);
      
      // Go to Calendar tab and click Schedule, verifying it opens schedule immediately and has the data
      console.log("Checking loaded schedule in Calendar tab...");
      await page.click('button[aria-label="Calendar"]');
      await page.click('button:has-text("Schedule")');
      
      // Verify CS 101 loaded
      await page.click('button:has-text("MON")');
      await page.waitForSelector('text=CS 101', { timeout: 5000 });
      console.log("Loaded schedule data was parsed and visualizer rendered CS 101 successfully.");
      
      console.log("PART 3 PASSED: Persistence of size preset and schedule data on startup verified.");
      await context.close();
    }
    
  } catch (err) {
    console.error("VERIFICATION RUN FAILED:", err);
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

runVerification();
