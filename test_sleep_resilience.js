import { app, BrowserWindow, powerMonitor } from 'electron';


// Stub app.quit so closing the window during test does not exit the app prematurely
app.quit = () => {
  console.log('[test] app.quit called (stubbed)');
};

// Start the main process logic
import './electron/main.js';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTest() {
  try {
    console.log('[test] Waiting for app to be ready...');
    await app.whenReady();

    // Wait for the window to be created (createWindow has a 200ms delay in main.js)
    console.log('[test] Waiting for window creation...');
    await delay(1000);

    let windows = BrowserWindow.getAllWindows();
    if (windows.length !== 1) {
      throw new Error(`Expected exactly 1 window, found ${windows.length}`);
    }

    const testWindow = windows[0];
    console.log('[test] Found main window. Verification: valid =', !testWindow.isDestroyed());
    if (testWindow.isDestroyed()) {
      throw new Error('Main window is destroyed initially');
    }

    // 1. Simulate suspend
    console.log('[test] Simulating suspend event...');
    powerMonitor.emit('suspend');
    await delay(500);
    if (testWindow.isDestroyed()) {
      throw new Error('Main window was destroyed during suspend');
    }
    console.log('[test] Suspend verification passed.');

    // 2. Simulate lock-screen
    console.log('[test] Simulating lock-screen event...');
    powerMonitor.emit('lock-screen');
    await delay(500);
    if (testWindow.isDestroyed()) {
      throw new Error('Main window was destroyed during lock-screen');
    }
    console.log('[test] Lock-screen verification passed.');

    // 3. Simulate resume
    console.log('[test] Simulating resume event...');
    powerMonitor.emit('resume');
    console.log('[test] Waiting 2000ms for resume handler to run...');
    await delay(2000);
    if (testWindow.isDestroyed()) {
      throw new Error('Main window was destroyed during resume');
    }
    console.log('[test] Resume verification passed.');

    // 4. Simulate unlock-screen
    console.log('[test] Simulating unlock-screen event...');
    powerMonitor.emit('unlock-screen');
    console.log('[test] Waiting 2000ms for unlock-screen handler to run...');
    await delay(2000);
    if (testWindow.isDestroyed()) {
      throw new Error('Main window was destroyed during unlock-screen');
    }
    console.log('[test] Unlock-screen verification passed.');

    // 5. Test Window Recreation when destroyed
    console.log('[test] Simulating window destruction/closure during sleep...');
    testWindow.close();
    await delay(500);

    // Verify window is null/destroyed
    windows = BrowserWindow.getAllWindows();
    console.log(`[test] Active windows after close: ${windows.length}`);
    
    console.log('[test] Simulating resume to trigger window recreation...');
    powerMonitor.emit('resume');
    console.log('[test] Waiting 2000ms for window recreation...');
    await delay(2000);

    windows = BrowserWindow.getAllWindows();
    console.log(`[test] Active windows after recreation resume: ${windows.length}`);
    if (windows.length !== 1) {
      throw new Error(`Expected exactly 1 window recreated, found ${windows.length}`);
    }
    if (windows[0].isDestroyed()) {
      throw new Error('Recreated window is destroyed');
    }
    console.log('[test] Window recreation verification passed.');

    console.log('[test] ALL SLEEP RESILIENCE TESTS PASSED SUCCESSFULLY!');
    process.exit(0);
  } catch (error) {
    console.error('[test] TEST FAILED:', error.message);
    process.exit(1);
  }
}

runTest();
