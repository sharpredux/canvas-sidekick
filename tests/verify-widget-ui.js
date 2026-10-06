import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { _electron as electron } from 'playwright';
import { LINUX_SIZES, TEXT_SCALES } from '../electron/widgetPreferences.js';

const userData = await mkdtemp(path.join(tmpdir(), 'canvas-widget-ui-'));
const scale = process.env.WIDGET_DISPLAY_SCALE || '1';
const executablePath = process.env.WIDGET_EXECUTABLE;
const errors = [];
const launch = () => electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${userData}`, `--force-device-scale-factor=${scale}`]
});

async function mockServices(application) {
  await application.evaluate(({ ipcMain }) => {
    for (const channel of ['has-session', 'fetch-canvas-data', 'ollama-version', 'ollama-tags', 'llm-chat', 'llm-parse-command', 'llm-estimate-task']) ipcMain.removeHandler(channel);
    ipcMain.removeAllListeners('start-canvas-polling');
    ipcMain.handle('has-session', () => true);
    ipcMain.handle('fetch-canvas-data', () => [{
      id: 'assignment_10', type: 'deadline',
      title: 'A very long assignment title with an unbroken suffix ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      course: 'A long course name for layout verification', completed: false,
      completionKnown: true, dueDate: new Date(Date.now() + 86400000).toISOString()
    }, {
      id: 'announcement_11', type: 'announcement', title: 'Announcement with a long title',
      course: 'Layout course', date: new Date().toISOString(), preview: 'Long announcement text '.repeat(20)
    }, {
      id: 'assignment_12', type: 'deadline', title: 'Meeting',
      course: 'A long meeting course name ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      zoomLink: 'https://zoom.us/j/123', completed: false,
      dueDate: new Date(Date.now() + 3600000).toISOString()
    }]);
    ipcMain.handle('ollama-version', () => ({ version: 'test' }));
    ipcMain.handle('ollama-tags', () => ({ models: [{ name: 'qwen2.5:3b' }] }));
    ipcMain.handle('llm-chat', () => ({ message: { content: 'Long chat reply '.repeat(30) } }));
    ipcMain.handle('llm-parse-command', () => ({ intent: 'none' }));
    ipcMain.handle('llm-estimate-task', () => ({ estimated_time: '30m' }));
  });
}

async function assertLayout(page, label) {
  const overflow = await page.evaluate(() => {
    const container = document.querySelector('.app-container');
    const viewport = container.getBoundingClientRect();
    return [...container.querySelectorAll('button, input, select, textarea, .agenda-item, .tabs, .item-course, .zoom-item-course, .item-time-text')]
      .filter(element => element.getClientRects().length)
      .filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.left < viewport.left - 1 || rect.right > viewport.right + 1;
      }).map(element => element.getAttribute('aria-label') || element.textContent || element.tagName);
  });
  assert.deepEqual(overflow, [], `${label}: controls must fit horizontally`);
}

let application = await launch();
try {
  let page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await mockServices(application);
  await page.evaluate(() => window.api.saveSettings({ schoolUrl: 'https://canvas.mock' }));
  await page.reload();
  await page.locator('.agenda-item').first().waitFor();
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), '0.1.6');
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1);

  for (const [size, dimensions] of Object.entries(LINUX_SIZES)) {
    for (const [textSize, textScale] of Object.entries(TEXT_SCALES)) {
      const label = `${size}/${textSize} at display scale ${scale}`;
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('button', { name: size, exact: true }).click();
      await page.getByRole('combobox', { name: 'Text size' }).selectOption(textSize);
      await assertLayout(page, label);
      const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
      assert.equal(bounds.width, dimensions.width);
      assert.equal(bounds.height, dimensions.height);
      await page.getByRole('button', { name: 'Tasks', exact: true }).click();
      await page.locator('.agenda-item').first().waitFor();
      assert.equal(await page.locator('.item-title').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize)), 16 * textScale);
      await assertLayout(page, label);
      if (textSize === 'Largest') await page.screenshot({ path: path.join(userData, `${size}-tasks-${scale}.png`) });
      await page.locator('.app-container').hover();
      await page.locator('.fab').click();
      await page.getByRole('button', { name: 'Add Task', exact: true }).scrollIntoViewIfNeeded();
      await assertLayout(page, `${label}/form`);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'Calendar', exact: true }).click();
      await page.getByRole('button', { name: 'Import', exact: true }).scrollIntoViewIfNeeded();
      await assertLayout(page, `${label}/calendar`);
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await page.getByRole('button', { name: 'Save', exact: true }).scrollIntoViewIfNeeded();
      await assertLayout(page, `${label}/schedule-import`);
      await page.getByRole('button', { name: 'Back to calendar', exact: true }).click();
      await page.getByRole('button', { name: 'Updates', exact: true }).click();
      await assertLayout(page, `${label}/updates`);
      await page.getByRole('button', { name: 'AI Chat', exact: true }).click();
      await page.getByPlaceholder('Ask me anything...').fill('Long message '.repeat(20));
      await page.locator('.ai-chat button[type="submit"]').click();
      await page.getByText('Long chat reply', { exact: false }).waitFor();
      await assertLayout(page, `${label}/chat`);
      if (textSize === 'Largest') await page.screenshot({ path: path.join(userData, `${size}-${scale}.png`) });
      console.log(`PASS: ${label}`);
    }
  }

  await page.evaluate(() => window.api.saveSettings({ schoolUrl: 'https://canvas.new' }));
  await page.waitForFunction(async () => (await window.api.loadSettings()).schoolUrl === 'https://canvas.new');
  const saved = JSON.parse(await readFile(path.join(userData, 'settings.json'), 'utf8'));
  assert.deepEqual(saved, { size: 'Large', textSize: 'Largest', schoolUrl: 'https://canvas.new' });
  // Simulate the fullscreen event without changing the desktop's fullscreen state.
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].emit('enter-full-screen'));
  assert.equal((await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())).width, 480);
  // Resizing beside the lower-right edge must move the larger window into view.
  const workArea = await application.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const { workArea } = screen.getDisplayMatching(window.getBounds());
    window.setBounds({ x: workArea.x + workArea.width - 280, y: workArea.y + workArea.height - 320, width: 280, height: 320 });
    return workArea;
  });
  await page.evaluate(() => window.api.resizeWindow('Large'));
  await page.waitForFunction(() => window.innerWidth === 480);
  const fitted = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.ok(fitted.x >= workArea.x && fitted.x + fitted.width <= workArea.x + workArea.width);
  assert.ok(fitted.y >= workArea.y && fitted.y + fitted.height <= workArea.y + workArea.height);
  if (process.env.DISPLAY) {
    const xid = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
    const hints = execFileSync('xprop', ['-id', String(xid), '_NET_WM_STATE'], { encoding: 'utf8' });
    for (const state of ['BELOW', 'STICKY', 'SKIP_TASKBAR', 'SKIP_PAGER']) assert.ok(hints.includes(`_NET_WM_STATE_${state}`), hints);
  }
  await application.close();
  application = await launch();
  await mockServices(application);
  page = await application.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Text size' }).inputValue(), 'Largest');
  assert.equal((await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())).width, 480);
  // Exercise the unauthenticated screen at the smallest size and largest text.
  await page.evaluate(() => { window.api.saveSettings({ size: 'Small', schoolUrl: '' }); window.api.resizeWindow('Small'); });
  await page.reload();
  await page.getByRole('button', { name: 'Log in', exact: true }).scrollIntoViewIfNeeded();
  await assertLayout(page, 'login');
  assert.deepEqual(errors, []);
  console.log(`PASS: persistence, fullscreen recovery, and login. Screenshots: ${userData}`);
} finally {
  await application.close();
}
