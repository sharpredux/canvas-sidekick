import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const userData = await mkdtemp(path.join(tmpdir(), 'canvas-completion-ui-'));
const application = await electron.launch({ args: ['.', `--user-data-dir=${userData}`] });
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await application.evaluate(({ ipcMain }) => {
    for (const channel of ['load-settings', 'has-session', 'fetch-canvas-data']) ipcMain.removeHandler(channel);
    ipcMain.removeAllListeners('start-canvas-polling');
    ipcMain.handle('load-settings', () => ({ size: 'Medium', schoolUrl: 'https://canvas.mock' }));
    ipcMain.handle('has-session', () => true);
    globalThis.testTaskCompleted = true;
    ipcMain.handle('fetch-canvas-data', () => [{
      id: 'assignment_10', type: 'deadline', title: 'Upload done', course: 'UI regression',
      completed: globalThis.testTaskCompleted, completionKnown: true,
      dueDate: new Date(Date.now() + 86400000).toISOString()
    }, {
      id: 'assignment_11', type: 'deadline', title: 'Paper outstanding', course: 'UI regression',
      completed: false, completionKnown: true, dueDate: new Date(Date.now() + 86400000).toISOString()
    }]);
  });
  await page.reload();
  const done = page.locator('.agenda-item').filter({ hasText: 'Upload done' });
  const outstanding = page.locator('.agenda-item').filter({ hasText: 'Paper outstanding' });
  await done.waitFor();
  assert.equal(await done.evaluate(element => element.classList.contains('checked-state')), true);
  assert.equal(await outstanding.evaluate(element => element.classList.contains('checked-state')), false);
  await done.click();
  await page.waitForFunction(() => !document.querySelector('.agenda-item')?.classList.contains('checked-state'));
  await page.reload();
  await done.waitFor();
  assert.equal(await done.evaluate(element => element.classList.contains('checked-state')), false);
  await outstanding.click();
  await page.waitForFunction(() => [...document.querySelectorAll('.agenda-item')].some(element =>
    element.textContent.includes('Paper outstanding') && element.classList.contains('checked-state')));
  await page.reload();
  await outstanding.waitFor();
  assert.equal(await outstanding.evaluate(element => element.classList.contains('checked-state')), true);

  // A changed Canvas state expires the old local override, then a new submission
  // checks the task automatically on the following refresh.
  await application.evaluate(() => { globalThis.testTaskCompleted = false; });
  await page.reload();
  await done.waitFor();
  await application.evaluate(() => { globalThis.testTaskCompleted = true; });
  await page.reload();
  await done.waitFor();
  assert.equal(await done.evaluate(element => element.classList.contains('checked-state')), true);
  assert.deepEqual(errors, []);
  console.log('PASS: checked and unchecked tasks, persistence after restart, and Canvas status changes.');
} finally {
  await application.close();
}
