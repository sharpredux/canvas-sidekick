import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import koffi from 'koffi';
import { _electron as electron } from 'playwright';
import { LINUX_SIZES } from '../electron/widgetPreferences.js';

// Inspect the X server's actual drawing and input region: a renderer screenshot
// alone cannot catch square native windows when the compositor is disabled.
const x11 = koffi.load('libX11.so.6');
const xext = koffi.load('libXext.so.6');
const rectangle = koffi.struct('CornerTestRectangle', {
  x: 'short', y: 'short', width: 'unsigned short', height: 'unsigned short'
});
const openDisplay = x11.func('void *XOpenDisplay(str name)');
const closeDisplay = x11.func('int XCloseDisplay(void *display)');
const free = x11.func('int XFree(void *data)');
const getRectangles = xext.func('void *XShapeGetRectangles(void *display, unsigned long window, int kind, _Out_ int *count, _Out_ int *ordering)');
const display = openDisplay(process.env.DISPLAY);
assert.ok(display, 'Run corner checks in an X11 graphical session');

function nativeShape(xid) {
  const count = [0];
  const ordering = [0];
  const pointer = getRectangles(display, xid, 0 /* ShapeBounding */, count, ordering);
  assert.ok(pointer);
  try {
    return koffi.decode(pointer, rectangle, count[0]);
  } finally {
    free(pointer);
  }
}

async function assertRounded(application, page, label) {
  const xid = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
  const rects = nativeShape(xid);
  const width = Math.max(...rects.map(rect => rect.x + rect.width));
  const height = Math.max(...rects.map(rect => rect.y + rect.height));
  const inside = (x, y) => rects.some(rect => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
    assert.equal(inside(x, y), false, `${label}: native corner (${x}, ${y}) must expose the desktop`);
  }
  for (const [x, y] of [[width >> 1, 0], [0, height >> 1], [width - 1, height >> 1], [width >> 1, height - 1], [width >> 1, height >> 1]]) {
    assert.equal(inside(x, y), true, `${label}: straight edges and content must remain visible`);
  }
  const css = await page.locator('.app-container').evaluate(element => ({
    radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height
  }));
  // Check the cutout along the circle's diagonal, including display scaling.
  const pixelScale = width / css.width;
  assert.ok(Math.abs(height / css.height - pixelScale) < 0.01, `${label}: shape follows window size`);
  const radius = css.radius * pixelScale;
  const topInset = Math.min(...rects.filter(rect => rect.y === 0).map(rect => rect.x));
  const expectedInset = radius - Math.sqrt(radius * radius - (radius - pixelScale / 2) ** 2);
  assert.ok(Math.abs(topInset - expectedInset) <= pixelScale, `${label}: native radius matches CSS`);
  const cutout = Math.floor(radius * 0.2);
  const content = Math.ceil(radius * 0.4);
  assert.equal(inside(cutout, cutout), false, `${label}: rounded arc cuts out the corner`);
  assert.equal(inside(content, content), true, `${label}: rounded arc preserves content`);
  console.log(`PASS: ${label}, native shape ${width}x${height}, CSS radius ${css.radius}`);
}

const userData = await mkdtemp(path.join(tmpdir(), 'canvas-widget-corners-'));
const scale = process.env.WIDGET_DISPLAY_SCALE || '1';
const executablePath = process.env.WIDGET_EXECUTABLE;
const launch = () => electron.launch({
  ...(executablePath ? { executablePath } : {}),
  args: [...(executablePath ? [] : ['.']), `--user-data-dir=${userData}`, `--force-device-scale-factor=${scale}`]
});

let application;
try {
  for (const size of Object.keys(LINUX_SIZES)) {
    await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ size }));
    application = await launch();
    const page = await application.firstWindow();
    await page.locator('.app-container').waitFor();
    await assertRounded(application, page, `${size} cold launch at scale ${scale}`);
    for (const [nextSize, dimensions] of Object.entries(LINUX_SIZES)) {
      await page.evaluate(size => window.api.resizeWindow(size), nextSize);
      await page.waitForFunction(width => window.innerWidth === width, dimensions.width);
      await assertRounded(application, page, `${size} → ${nextSize}`);
    }
    await page.reload();
    await page.locator('.app-container').waitFor();
    await assertRounded(application, page, `${size} reload`);
    await page.screenshot({ path: path.join(userData, `${size}-${scale}.png`) });
    await application.close();
    application = null;
  }
  console.log(`PASS: cold launches, resizing, reloads. Screenshots: ${userData}`);
} finally {
  if (application) await application.close();
  closeDisplay(display);
}
