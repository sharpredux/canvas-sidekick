import { chromium } from 'playwright';
import { spawn } from 'child_process';
import assert from 'assert';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startViteServer() {
  console.log("Starting Vite dev server for task deletion verification...");
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

async function runTaskDeletionVerification() {
  let serverProcess;
  let browser;
  let exitCode = 0;
  
  try {
    serverProcess = await startViteServer();
    console.log("Vite dev server started.");
    
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.stack || err.message));

    // Mock electron APIs
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
            id: 'canvas-task-1',
            type: 'deadline',
            title: 'Canvas Assignment 1',
            course: 'CS 101',
            dueDate: new Date(Date.now() + 36000000).toISOString(),
            completed: false
          }
        ],
        startCanvasPolling: () => {},
        onCanvasDataUpdate: () => { return () => {}; },
        saveSettings: () => {},
        loadSettings: async () => ({ size: 'Medium', schoolUrl: 'test-school.edu' }),
        saveSchedule: () => {},
        loadSchedule: async () => ''
      };
    });
    
    await page.goto('http://localhost:5173');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Auth should be auto-bypassed due to loaded settings
    console.log("Waiting for Up Next page and tasks to render...");
    await page.waitForSelector('text=Canvas Assignment 1');
    
    // We should be on Up Next tab by default or switch to Tasks tab
    await page.click('button[aria-label="Tasks"]');
    await sleep(200);

    // 1. Verify that the regular Canvas task cannot be swiped/deleted
    console.log("Checking that non-custom tasks cannot be swiped/revealed...");
    // Let's attempt to double-click on the Canvas assignment
    const canvasItem = page.locator('.agenda-item:has-text("Canvas Assignment 1")');
    await canvasItem.dblclick();
    await sleep(100);
    
    // Verify that the wrapper and delete background do not exist for Canvas task
    const canvasDeleteBg = page.locator('.agenda-item-wrapper:has-text("Canvas Assignment 1") .agenda-item-background');
    const hasDeleteBg = await canvasDeleteBg.isVisible();
    assert.strictEqual(hasDeleteBg, false, "Canvas tasks should not have a delete background layer.");
    console.log("Verified: regular tasks are not swipable/deletable.");

    // 2. Add a new manual/custom task
    console.log("Adding a new custom task via UI...");
    
    // Click FAB to open task form
    await page.click('button.fab');
    await sleep(200);
    
    // Fill the inputs
    await page.fill('input[placeholder="Title"]', 'Auditor Deletion Test Task');
    await page.fill('input[placeholder="Course"]', 'AUDIT 101');
    await page.fill('input[placeholder="Time Estimate (e.g. 30m)"]', '2h');
    // Set a date in the future
    const futureDate = new Date(Date.now() + 86400000); // 1 day future
    const isoStr = futureDate.toISOString().slice(0, 16); // e.g. "2026-06-30T21:30"
    await page.fill('input[type="datetime-local"]', isoStr);
    
    // Submit form
    await page.click('button:has-text("Add Task")');
    await sleep(300);
    
    // Verify task was added
    console.log("Verifying task is visible on the Tasks tab...");
    const addedTask = page.locator('.item-title:has-text("Auditor Deletion Test Task")');
    const isAddedTaskVisible = await addedTask.isVisible();
    assert.strictEqual(isAddedTaskVisible, true, "Custom task should be added and visible in Tasks tab");
    
    // Verify localStorage holds the manual task
    let localTasks = await page.evaluate(() => JSON.parse(localStorage.getItem('manualTasks') || '[]'));
    console.log("Local manualTasks length after addition (raw):", localTasks.length);
    const manualOnly = localTasks.filter(t => t.isManual);
    console.log("Local manualTasks length after addition (manual only):", manualOnly.length);
    assert.strictEqual(manualOnly.length, 1, "localStorage manualTasks should have exactly 1 manual task");
    assert.strictEqual(manualOnly[0].title, "Auditor Deletion Test Task", "localStorage manualTasks task title should match");

    // 3. Double-click the task to reveal the delete button
    console.log("Double-clicking the custom task to reveal the delete button...");
    const customTaskWrapper = page.locator('.agenda-item-wrapper:has-text("Auditor Deletion Test Task")');
    const customTaskForeground = customTaskWrapper.locator('.agenda-item');
    await customTaskForeground.dblclick();
    await sleep(200);
    
    // Verify translation style of the foreground
    const styleAttr = await customTaskForeground.getAttribute('style');
    console.log("Foreground style attribute after double click:", styleAttr);
    assert.ok(styleAttr.includes('transform'), "Foreground should be shifted via transform property");
    assert.ok(styleAttr.includes('translateX(64px)'), "Foreground should be translated by 64px to the right");

    // Verify delete button background is visible
    const deleteButton = customTaskWrapper.locator('.agenda-item-background');
    const isDeleteButtonVisible = await deleteButton.isVisible();
    assert.strictEqual(isDeleteButtonVisible, true, "Delete button should be visible after revealing");

    // 4. Click the delete button
    console.log("Clicking the delete button...");
    await deleteButton.click();
    await sleep(300);

    // 5. Verify the custom task is gone from the UI
    const isTaskStillVisible = await addedTask.isVisible();
    assert.strictEqual(isTaskStillVisible, false, "Custom task should be removed from UI after deletion");
    console.log("Verified: task is removed from UI.");

    // 6. Verify localStorage has been updated
    localTasks = await page.evaluate(() => JSON.parse(localStorage.getItem('manualTasks') || '[]'));
    console.log("Local manualTasks length after deletion (raw):", localTasks.length);
    const manualOnlyAfter = localTasks.filter(t => t.isManual);
    console.log("Local manualTasks length after deletion (manual only):", manualOnlyAfter.length);
    assert.strictEqual(manualOnlyAfter.length, 0, "localStorage manualTasks should have 0 manual tasks after deletion");
    console.log("Verified: localStorage manualTasks updated correctly.");

    console.log("\nALL TASKS DELETION VERIFICATION CHECKS PASSED!");
    await context.close();

  } catch (err) {
    console.error("VERIFICATION CHECKS FAILED:", err);
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

runTaskDeletionVerification();
