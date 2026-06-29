import { chromium } from 'playwright';
import { spawn } from 'child_process';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startViteServer() {
  console.log("Starting Vite dev server for task deletion verification...");
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
  
  const findings = [];
  
  try {
    const res = await startViteServer();
    serverProcess = res.child;
    port = res.port;
    console.log(`Vite dev server started on port ${port}!`);
    
    browser = await chromium.launch({ headless: true });
    const appUrl = `http://localhost:${port}`;
    
    const context = await browser.newContext();
    const page = await context.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.stack || err.message));
    
    // Inject API and seed manualTasks in localStorage BEFORE page load
    await page.addInitScript(() => {
      // Mock window.api
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
        loadSettings: async () => ({ size: 'Medium', schoolUrl: 'https://test-school.edu' }),
        loadSchedule: async () => '',
        hasSession: async () => true,
        fetchCanvasData: async () => [
          {
            id: 'canvas-deadline-1',
            type: 'deadline',
            title: 'Canvas Assignment 1',
            course: 'MATH 101',
            dueDate: new Date(Date.now() + 86400 * 1000).toISOString(),
            completed: false
          },
          {
            id: 'canvas-event-1',
            type: 'event',
            title: 'Canvas Event 1',
            course: 'PHYS 101',
            dueDate: new Date(Date.now() + 86400 * 1000).toISOString(),
            completed: false
          }
        ],
        startCanvasPolling: () => {},
        onCanvasDataUpdate: () => { return () => {}; },
        saveSettings: () => {},
        resizeWindow: () => {}
      };
      
      // Seed a custom task in localStorage
      const mockManualTasks = [
        {
          id: 'custom-task-1',
          type: 'deadline',
          title: 'Adversarial Custom Task',
          course: 'Personal',
          dueDate: new Date(Date.now() + 3600 * 1000).toISOString(),
          completed: false,
          isManual: true,
          isCustom: true
        }
      ];
      localStorage.setItem('manualTasks', JSON.stringify(mockManualTasks));
    });
    
    await page.goto(appUrl);
    await page.waitForLoadState('networkidle');
    
    // Wait for the elements to load on the dashboard
    await page.waitForSelector('text=Adversarial Custom Task', { timeout: 5000 });
    await page.waitForSelector('text=Canvas Assignment 1', { timeout: 5000 });
    console.log("Mock data and custom task loaded successfully!");
    
    // Helper to get transform translateX of an element
    const getTransformX = async (selector, textPattern) => {
      const el = page.locator(selector).filter({ hasText: textPattern });
      const transform = await el.evaluate(e => e.style.transform);
      const match = transform.match(/translateX\(([-?\d.]+)px\)/);
      return match ? parseFloat(match[1]) : 0;
    };
    
    // Helper to check task completed class/state
    const isTaskCompleted = async (textPattern) => {
      const card = page.locator('.agenda-item.watch-card').filter({ hasText: textPattern });
      const isChecked = await card.evaluate(e => e.classList.contains('checked-state'));
      return isChecked;
    };

    // =========================================================================
    // 1. Swipe Clamping (0px to 100px)
    // =========================================================================
    console.log("\n--- Verification 1: Swipe Clamping ---");
    {
      const customTask = page.locator('.agenda-item.watch-card').filter({ hasText: 'Adversarial Custom Task' });
      const box = await customTask.boundingBox();
      const startX = box.x + 30;
      const startY = box.y + box.height / 2;
      
      // A. Drag to right beyond 100px (e.g. 150px)
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 150, startY);
      await sleep(100);
      let offset = await getTransformX('.agenda-item.watch-card', 'Adversarial Custom Task');
      console.log(`Drag to 150px offset: ${offset}px (Expected: 100px)`);
      if (offset !== 100) {
        findings.push(`BUG: Drag to 150px resulted in offset ${offset}px (expected 100px clamp)`);
      }
      
      // B. Drag to left (e.g. -50px)
      await page.mouse.move(startX - 50, startY);
      await sleep(100);
      offset = await getTransformX('.agenda-item.watch-card', 'Adversarial Custom Task');
      console.log(`Drag to -50px offset: ${offset}px (Expected: 0px)`);
      if (offset !== 0) {
        findings.push(`BUG: Drag to -50px resulted in offset ${offset}px (expected 0px clamp)`);
      }
      
      // Clean up pointer state
      await page.mouse.up();
      await sleep(200);
    }
    
    // =========================================================================
    // 2. Snapping Boundaries (snapping at 50px to 64px)
    // =========================================================================
    console.log("\n--- Verification 2: Snapping Boundaries ---");
    {
      const customTask = page.locator('.agenda-item.watch-card').filter({ hasText: 'Adversarial Custom Task' });
      
      // Case A: Drag 40px (<= 50px) -> Should snap back to 0px
      const box = await customTask.boundingBox();
      const startX = box.x + 30;
      const startY = box.y + box.height / 2;
      
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 40, startY);
      await sleep(50);
      await page.mouse.up();
      await sleep(300); // wait for snap transition
      let offset = await getTransformX('.agenda-item.watch-card', 'Adversarial Custom Task');
      console.log(`Drag 40px snap result: ${offset}px (Expected: 0px)`);
      if (offset !== 0) {
        findings.push(`BUG: Drag 40px did not snap back to 0px, got ${offset}px`);
      }
      
      // Case B: Drag 60px (> 50px) -> Should snap to 64px
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 60, startY);
      await sleep(50);
      await page.mouse.up();
      await sleep(300); // wait for snap transition
      offset = await getTransformX('.agenda-item.watch-card', 'Adversarial Custom Task');
      console.log(`Drag 60px snap result: ${offset}px (Expected: 64px)`);
      if (offset !== 64) {
        findings.push(`BUG: Drag 60px did not snap to 64px, got ${offset}px`);
      }
      
      // Reset by clicking
      await customTask.click({ force: true });
      await sleep(300);
      
      // Case C: Drag exactly 50px -> Check if it snaps to 0px (strict inequality check)
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 50, startY);
      await sleep(50);
      await page.mouse.up();
      await sleep(300);
      offset = await getTransformX('.agenda-item.watch-card', 'Adversarial Custom Task');
      console.log(`Drag exactly 50px snap result: ${offset}px (Expected: 0px due to strictly greater than 50 threshold)`);
      if (offset !== 0) {
        findings.push(`NOTE: Drag exactly 50px did not snap back to 0px, got ${offset}px (threshold check behavior)`);
      }
    }
    
    // =========================================================================
    // 3. Click Behaviors: Drag vs Clean Click, Click-to-reset, Double-click
    // =========================================================================
    console.log("\n--- Verification 3: Click & Gesture Behaviors ---");
    {
      const customTask = page.locator('.agenda-item.watch-card').filter({ hasText: 'Adversarial Custom Task' });
      
      // 3.1 Drag vs Clean Click: Dragging to reveal should NOT toggle completion state
      let completed = await isTaskCompleted('Adversarial Custom Task');
      console.log(`Initial completion state: ${completed}`);
      if (completed) {
        findings.push("BUG: Custom task started as completed");
      }
      
      const box = await customTask.boundingBox();
      const startX = box.x + 30;
      const startY = box.y + box.height / 2;
      
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 70, startY);
      await sleep(50);
      await page.mouse.up();
      await sleep(300); // Now it's revealed/swiped
      
      let offset = await getTransformX('.agenda-item.watch-card', 'Adversarial Custom Task');
      if (offset !== 64) {
        findings.push(`BUG: Drag to 70px failed to swipe, got offset ${offset}px`);
      }
      
      completed = await isTaskCompleted('Adversarial Custom Task');
      console.log(`Completion state after drag-to-swipe: ${completed} (Expected: false)`);
      if (completed !== false) {
        findings.push("BUG: Drag-to-swipe toggled the completion state of the custom task");
      }
      
      // 3.2 Click-to-reset: Clean click on a swiped item should close the swipe, NOT toggle completion
      console.log("Clicking the swiped item to reset...");
      await customTask.click({ force: true });
      await sleep(300);
      
      offset = await getTransformX('.agenda-item.watch-card', 'Adversarial Custom Task');
      console.log(`Offset after reset click: ${offset}px (Expected: 0px)`);
      if (offset !== 0) {
        findings.push(`BUG: Click-to-reset failed, offset is ${offset}px instead of 0px`);
      }
      
      completed = await isTaskCompleted('Adversarial Custom Task');
      console.log(`Completion state after reset click: ${completed} (Expected: false)`);
      if (completed !== false) {
        findings.push("BUG: Reset click toggled the completion state of the custom task");
      }
      
      // 3.3 Clean click on unswiped item should toggle completion
      console.log("Clicking the unswiped item to toggle completion...");
      await customTask.click({ force: true });
      await sleep(200);
      
      completed = await isTaskCompleted('Adversarial Custom Task');
      console.log(`Completion state after normal click: ${completed} (Expected: true)`);
      if (completed !== true) {
        findings.push("BUG: Normal click on custom task did not toggle completion");
      }
      
      // Click again to revert to false
      await customTask.click({ force: true });
      await sleep(200);
      completed = await isTaskCompleted('Adversarial Custom Task');
      if (completed !== false) {
        findings.push("BUG: Second click on custom task did not revert completion to false");
      }
      
      // 3.4 Double-click logic on unswiped item
      console.log("Double clicking the unswiped item...");
      await customTask.dblclick({ force: true });
      await sleep(300);
      
      offset = await getTransformX('.agenda-item.watch-card', 'Adversarial Custom Task');
      console.log(`Offset after double-click: ${offset}px (Expected: 64px)`);
      if (offset !== 64) {
        findings.push(`BUG: Double-clicking unswiped custom task did not reveal it (got offset ${offset}px)`);
      }
      
      completed = await isTaskCompleted('Adversarial Custom Task');
      console.log(`Completion state after double-click: ${completed} (Expected: false)`);
      if (completed !== false) {
        findings.push(`BUG: Double click changed completion state to ${completed}`);
      }
      
      // Click-to-reset it back to 0px
      await customTask.click({ force: true });
      await sleep(300);
      
      // 3.5 ADVERSARIAL DISCOVERY: Double click on a swiped item
      console.log("Swiping custom task open again...");
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 70, startY);
      await sleep(50);
      await page.mouse.up();
      await sleep(300);
      
      offset = await getTransformX('.agenda-item.watch-card', 'Adversarial Custom Task');
      if (offset !== 64) {
        findings.push("Failed to pre-swipe custom task for double-click test");
      }
      
      console.log("Double clicking the SWIPED item...");
      await customTask.dblclick({ force: true });
      await sleep(300);
      
      offset = await getTransformX('.agenda-item.watch-card', 'Adversarial Custom Task');
      completed = await isTaskCompleted('Adversarial Custom Task');
      console.log(`After double clicking a swiped item: offset = ${offset}px, completed = ${completed}`);
      if (completed === true) {
        findings.push("BUG: Double-clicking a swiped custom task unexpectedly toggled its completion to true");
      }
      
      // Clean up/Reset
      await customTask.click({ force: true });
      await sleep(300);
    }
    
    // =========================================================================
    // 4. Standard Canvas Items Regression Testing
    // =========================================================================
    console.log("\n--- Verification 4: Standard Canvas Items Regression ---");
    {
      const canvasItem = page.locator('.agenda-item.watch-card').filter({ hasText: 'Canvas Assignment 1' });
      const box = await canvasItem.boundingBox();
      const startX = box.x + 30;
      const startY = box.y + box.height / 2;
      
      // 4.1 Verify standard item cannot be swiped, and check if dragging toggles completion
      console.log("Dragging standard Canvas item...");
      let isCompletedBeforeDrag = await isTaskCompleted('Canvas Assignment 1');
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 80, startY);
      await sleep(50);
      
      let offset = await getTransformX('.agenda-item.watch-card', 'Canvas Assignment 1');
      console.log(`Dragging standard item offset while mouse down: ${offset}px (Expected: 0px)`);
      if (offset !== 0) {
        findings.push(`BUG: Standard canvas item swiped, got offset ${offset}px`);
      }
      
      await page.mouse.up();
      await sleep(300);
      
      let isCompletedAfterDrag = await isTaskCompleted('Canvas Assignment 1');
      console.log(`Completion state of standard item after drag: ${isCompletedAfterDrag} (Before: ${isCompletedBeforeDrag})`);
      if (isCompletedAfterDrag !== isCompletedBeforeDrag) {
        findings.push("BUG: Dragging a standard Canvas item toggles its completion state (should do nothing)");
        
        // Reset the state since it toggled
        await canvasItem.click({ force: true });
        await sleep(200);
      }
      
      // 4.2 Verify standard item does not have delete button in DOM
      const wrapper = page.locator('.agenda-item-wrapper').filter({ hasText: 'Canvas Assignment 1' });
      const wrapperCount = await wrapper.count();
      console.log(`Wrapper count for standard item: ${wrapperCount} (Expected: 0)`);
      if (wrapperCount !== 0) {
        findings.push(`BUG: Standard item wrapped in agenda-item-wrapper (count: ${wrapperCount})`);
      }
      
      // 4.3 Verify double clicking standard item does not swipe it, and check completion behavior
      console.log("Double clicking standard item...");
      let isCompletedBeforeDblClick = await isTaskCompleted('Canvas Assignment 1');
      await canvasItem.dblclick({ force: true });
      await sleep(300);
      offset = await getTransformX('.agenda-item.watch-card', 'Canvas Assignment 1');
      console.log(`Standard item offset after double-click: ${offset}px (Expected: 0px)`);
      if (offset !== 0) {
        findings.push(`BUG: Double-clicking standard item applied swipe offset ${offset}px`);
      }
      
      let isCompletedAfterDblClick = await isTaskCompleted('Canvas Assignment 1');
      console.log(`Standard item completion after double-click: ${isCompletedAfterDblClick} (Before: ${isCompletedBeforeDblClick})`);
      // Since it's standard, there's no reset check, so it should toggle twice and end up unchanged.
      // But let's check if it actually ended up unchanged.
      if (isCompletedAfterDblClick !== isCompletedBeforeDblClick) {
        findings.push(`BUG: Double-clicking a standard Canvas item toggled its completion state from ${isCompletedBeforeDblClick} to ${isCompletedAfterDblClick}`);
        
        // Reset state
        await canvasItem.click({ force: true });
        await sleep(200);
      }
      
      // 4.4 Verify clicking standard deadline item toggles completion
      console.log("Clicking standard deadline item...");
      let completed = await isTaskCompleted('Canvas Assignment 1');
      
      await canvasItem.click({ force: true });
      await sleep(200);
      let afterClick = await isTaskCompleted('Canvas Assignment 1');
      console.log(`Standard deadline completion after click: ${afterClick} (Before: ${completed})`);
      if (afterClick === completed) {
        findings.push("BUG: Clicking standard deadline did not toggle completion");
      }
      
      await canvasItem.click({ force: true });
      await sleep(200);
      
      // 4.5 Verify clicking standard non-deadline item (like event) does NOT toggle completion
      const canvasEvent = page.locator('.agenda-item.watch-card').filter({ hasText: 'Canvas Event 1' });
      let eventCompleted = await isTaskCompleted('Canvas Event 1');
      console.log(`Standard event initial completion: ${eventCompleted}`);
      
      await canvasEvent.click({ force: true });
      await sleep(200);
      let eventCompletedAfterClick = await isTaskCompleted('Canvas Event 1');
      console.log(`Standard event completion after click: ${eventCompletedAfterClick}`);
      if (eventCompletedAfterClick !== false) {
        findings.push("BUG: Clicking non-deadline standard items toggled completion");
      }
    }
    
    // =========================================================================
    // 5. Test Deletion Functionality (Click to Delete)
    // =========================================================================
    console.log("\n--- Verification 5: Deletion Action ---");
    {
      const customTask = page.locator('.agenda-item.watch-card').filter({ hasText: 'Adversarial Custom Task' });
      const box = await customTask.boundingBox();
      const startX = box.x + 30;
      const startY = box.y + box.height / 2;
      
      // Swipe open
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 80, startY);
      await sleep(50);
      await page.mouse.up();
      await sleep(300);
      
      // Click the delete background area
      console.log("Clicking delete button...");
      const deleteBg = page.locator('.agenda-item-background');
      await deleteBg.click({ force: true });
      await sleep(300);
      
      // Verify custom task is gone from dashboard
      const count = await page.locator('.agenda-item.watch-card').filter({ hasText: 'Adversarial Custom Task' }).count();
      console.log(`Custom task count after deletion: ${count} (Expected: 0)`);
      if (count !== 0) {
        findings.push("BUG: Deletion action did not remove the custom task from the UI");
      }
    }
    
    console.log("\nALL VERIFICATIONS RAN.");
    console.log("\n--- FINDINGS SUMMARY ---");
    if (findings.length === 0) {
      console.log("No issues found! Everything is perfectly compliant.");
    } else {
      findings.forEach(f => console.log(`- ${f}`));
    }
    
  } catch (err) {
    console.error("\nCRITICAL FAILURE DURING RUN:", err);
  } finally {
    if (browser) await browser.close();
    if (serverProcess) {
      console.log("Stopping Vite dev server...");
      serverProcess.kill();
    }
  }
}

runTests();
