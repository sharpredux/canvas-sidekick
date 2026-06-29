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
    const context = await browser.newContext();
    const page = await context.newPage();
    
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.stack || err.message));
    
    // Mock the Electron window.api object
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
              id: 'deadline-1',
              type: 'deadline',
              title: 'Homework 1',
              course: 'CS 101 - Intro to CS',
              dueDate: '2026-07-02T23:59:00Z',
              completed: false
            },
            {
              id: 'event-1',
              type: 'event',
              title: 'Lab Session',
              course: 'CS 102 - Intermediate CS',
              dueDate: '2026-07-03T14:00:00Z',
              completed: false
            },
            {
              id: 'ann-1',
              type: 'announcement',
              title: 'Chapter 4 Reading',
              course: 'CS 101 - Intro to CS',
              date: '2026-06-25T08:00:00Z',
              preview: 'Please read chapter 4 before class.',
              author: 'Prof. Smith'
            },
            {
              id: 'ann-2',
              type: 'announcement',
              title: 'Project 1 Announcement',
              course: 'CS 102 - Intermediate CS',
              date: '2026-06-28T09:00:00Z',
              preview: 'Project 1 due next week.',
              author: 'Prof. Davis'
            },
            {
              id: 'comment-1',
              type: 'comment',
              title: 'Feedback on Thesis draft',
              course: 'CS 200 - Research Seminar',
              date: '2026-06-26T15:30:00Z',
              preview: 'Great start on your thesis. Need more data.',
              author: 'TA Johnson'
            }
          ];
        },
        startCanvasPolling: () => {},
        onCanvasDataUpdate: (cb) => {
          window.__triggerCanvasDataUpdate = cb;
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
    
    // Auth bypass
    await page.fill('input[placeholder="canvas.edu"]', 'test-updates-canvas.edu');
    await page.click('button[type="submit"]');
    
    // Wait for the main page to load
    await page.waitForSelector('text=Homework 1', { timeout: 5000 });
    console.log("Mock data (Homework 1) successfully loaded!");

    // --- TEST 1: Updates tab rendering and contents ---
    console.log("\n--- Verification: Updates Tab ---");
    await page.click('button[aria-label="Updates"]', { force: true });
    await sleep(200);

    // Verify all mock announcements and comments are displayed
    await page.waitForSelector('text=Project 1 Announcement', { timeout: 2000 });
    await page.waitForSelector('text=Feedback on Thesis draft', { timeout: 2000 });
    await page.waitForSelector('text=Chapter 4 Reading', { timeout: 2000 });

    console.log("All update titles are present under Updates tab.");

    // Verify previews
    await page.waitForSelector('text=Project 1 due next week.', { timeout: 2000 });
    await page.waitForSelector('text=Great start on your thesis. Need more data.', { timeout: 2000 });
    await page.waitForSelector('text=Please read chapter 4 before class.', { timeout: 2000 });

    console.log("All update previews are present under Updates tab.");

    // Verify authors
    await page.waitForSelector('text=By: Prof. Davis', { timeout: 2000 });
    await page.waitForSelector('text=By: TA Johnson', { timeout: 2000 });
    await page.waitForSelector('text=By: Prof. Smith', { timeout: 2000 });

    console.log("All update authors are present under Updates tab.");

    // --- TEST 2: Updates tab sorting (Newest first) ---
    console.log("\n--- Verification: Updates Sorting ---");
    const itemTitles = await page.locator('.item-title').allInnerTexts();
    console.log("Rendered update titles in order:", itemTitles);
    
    const expectedOrder = [
      'Project 1 Announcement', // 2026-06-28
      'Feedback on Thesis draft', // 2026-06-26
      'Chapter 4 Reading' // 2026-06-25
    ];

    if (itemTitles.length !== expectedOrder.length) {
      throw new Error(`Expected exactly ${expectedOrder.length} update items, but found ${itemTitles.length}`);
    }

    for (let i = 0; i < expectedOrder.length; i++) {
      if (itemTitles[i] !== expectedOrder[i]) {
        throw new Error(`Sorting mismatch at index ${i}: expected '${expectedOrder[i]}', got '${itemTitles[i]}'`);
      }
    }
    console.log("Sorting verification passed (Newest Updates First)!");

    // --- TEST 3: Pollution prevention in Up Next tab ---
    console.log("\n--- Verification: Pollution Prevention in Up Next tab ---");
    await page.click('button[aria-label="Up Next"]', { force: true });
    await sleep(200);

    const upNextTitles = await page.locator('.item-title').allInnerTexts();
    console.log("Rendered Up Next titles:", upNextTitles);

    const updatesInUpNext = upNextTitles.filter(t => expectedOrder.includes(t));
    if (updatesInUpNext.length > 0) {
      throw new Error(`Pollution detected: Announcements/comments found in Up Next: ${updatesInUpNext.join(', ')}`);
    }
    console.log("Up Next tab is free from announcements and comments pollution!");

    // --- TEST 4: Pollution prevention in Calendar tab ---
    console.log("\n--- Verification: Pollution Prevention in Calendar tab ---");
    await page.click('button[aria-label="Calendar"]', { force: true });
    await sleep(200);

    // Get all page text to ensure none of the update previews/authors/titles are visible
    const pageText = await page.innerText('body');
    const pollutedWords = [
      'Project 1 Announcement',
      'Feedback on Thesis draft',
      'Chapter 4 Reading',
      'Prof. Davis',
      'TA Johnson',
      'Prof. Smith'
    ];

    pollutedWords.forEach(word => {
      if (pageText.includes(word)) {
        throw new Error(`Pollution detected: '${word}' found on Calendar view!`);
      }
    });
    console.log("Calendar tab is free from announcements and comments pollution!");

    console.log("\nALL VERIFICATION TESTS PASSED SUCCESSFULLY!");
    
  } catch (err) {
    console.error("VERIFICATION FAILED:", err);
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
