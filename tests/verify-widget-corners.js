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
const defaultScreen = x11.func('int XDefaultScreen(void *display)');
const internAtom = x11.func('unsigned long XInternAtom(void *display, str name, int onlyIfExists)');
const selectionOwner = x11.func('unsigned long XGetSelectionOwner(void *display, unsigned long selection)');
const getImage = x11.func('void *XGetImage(void *display, unsigned long window, int x, int y, unsigned int width, unsigned int height, unsigned long planeMask, int format)');
const getPixel = x11.func('unsigned long XGetPixel(void *image, int x, int y)');
const destroyImage = x11.func('int XDestroyImage(void *image)');
const flush = x11.func('int XFlush(void *display)');
const rootWindow = x11.func('unsigned long XDefaultRootWindow(void *display)');
koffi.struct('CornerTestWindowAttributes', {
  x: 'int', y: 'int', width: 'int', height: 'int', borderWidth: 'int', depth: 'int',
  visual: 'void *', root: 'unsigned long', class: 'int', bitGravity: 'int',
  winGravity: 'int', backingStore: 'int', backingPlanes: 'unsigned long',
  backingPixel: 'unsigned long', saveUnder: 'int', colormap: 'unsigned long',
  mapInstalled: 'int', mapState: 'int', allEventMasks: 'long', yourEventMask: 'long',
  doNotPropagateMask: 'long', overrideRedirect: 'int', screen: 'void *'
});
const getAttributes = x11.func('int XGetWindowAttributes(void *display, unsigned long window, _Out_ CornerTestWindowAttributes *attributes)');
const clientMessage = koffi.struct('CornerTestClientMessage', {
  type: 'int', serial: 'unsigned long', send_event: 'int', display: 'void *',
  window: 'unsigned long', message_type: 'unsigned long', format: 'int',
  data: koffi.array('long', 5)
});
koffi.union('CornerTestEvent', { client: clientMessage, pad: koffi.array('long', 24) });
const sendEvent = x11.func('int XSendEvent(void *display, unsigned long window, int propagate, long mask, CornerTestEvent *event)');
const xtst = koffi.load('libXtst.so.6');
const motion = xtst.func('int XTestFakeMotionEvent(void *display, int screen, int x, int y, unsigned long delay)');
const button = xtst.func('int XTestFakeButtonEvent(void *display, unsigned int button, int pressed, unsigned long delay)');
const display = openDisplay(process.env.DISPLAY);
assert.ok(display, 'Run corner checks in an X11 graphical session');
const raisedApplications = new WeakSet();

function raiseTestWindow(xid) {
  // XGetImage cannot reliably read pixels obscured by another window. Raise
  // only this isolated test window; desktop hints are covered by the UI suite.
  for (const [action, state] of [[0, '_NET_WM_STATE_BELOW'], [1, '_NET_WM_STATE_ABOVE']]) {
    sendEvent(display, rootWindow(display), 0, (1 << 20) | (1 << 19), {
      client: {
        type: 33, serial: 0, send_event: 1, display, window: xid,
        message_type: internAtom(display, '_NET_WM_STATE', 0), format: 32,
        data: [action, internAtom(display, state, 0), 0, 1, 0]
      }
    });
  }
  flush(display);
}

function isComposited() {
  return selectionOwner(display, internAtom(display, `_NET_WM_CM_S${defaultScreen(display)}`, 0)) !== 0;
}

function nativeShape(xid, kind = 0 /* ShapeBounding */) {
  const count = [0];
  const ordering = [0];
  const pointer = getRectangles(display, xid, kind, count, ordering);
  assert.ok(pointer);
  try {
    return koffi.decode(pointer, rectangle, count[0]);
  } finally {
    free(pointer);
  }
}

async function assertRounded(application, page, label) {
  const xid = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
  // A visible DOM can precede the first native show. XGetImage requires the
  // actual X11 window to be viewable, especially under package-build load.
  const attributes = {};
  for (let attempt = 0; attempt < 40; attempt++) {
    assert.ok(getAttributes(display, xid, attributes));
    if (attributes.mapState === 2 /* IsViewable */) break;
    await page.waitForTimeout(25);
  }
  assert.equal(attributes.mapState, 2, `${label}: native window must be viewable`);
  if (!raisedApplications.has(application)) {
    raiseTestWindow(xid);
    await page.waitForTimeout(150);
    raisedApplications.add(application);
  }
  const composited = isComposited();
  const bounding = nativeShape(xid);
  const rects = nativeShape(xid, 2 /* ShapeInput */);
  const width = Math.max(...rects.map(rect => rect.x + rect.width));
  const height = Math.max(...rects.map(rect => rect.y + rect.height));
  const inside = (x, y) => rects.some(rect => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
  for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) {
    assert.equal(inside(x, y), false, `${label}: empty corner (${x}, ${y}) must pass clicks through`);
    assert.equal(bounding.some(rect => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height), composited,
      `${label}: drawing region must match compositor mode: ${JSON.stringify({ width, height, bounding })}`);
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
  if (composited) {
    // Read the actual X11 surface, not just a renderer screenshot. The curve
    // must contain partially transparent pixels rather than a staircase mask.
    const patchSize = Math.ceil(radius);
    let blended = null;
    for (let attempt = 0; attempt < 80 && blended === null; attempt++) {
      const image = getImage(display, xid, 0, 0, patchSize, patchSize, 0xffffffff, 2 /* ZPixmap */);
      assert.ok(image);
      try {
        // Mapping can precede the first GPU frame. Wait for the opaque fill,
        // then check antialiasing so an empty surface cannot pass this test.
        if (((getPixel(image, patchSize - 1, patchSize - 1) >>> 24) & 255) > 0) {
          assert.equal((getPixel(image, 0, 0) >>> 24) & 255, 0, `${label}: visual corner is transparent`);
          blended = 0;
          for (let y = 0; y < patchSize; y++) {
            for (let x = 0; x < patchSize; x++) {
              const alpha = (getPixel(image, x, y) >>> 24) & 255;
              if (alpha > 0 && alpha < 255) blended++;
            }
          }
        }
      } finally {
        destroyImage(image);
      }
      if (blended === null) await page.waitForTimeout(25);
    }
    assert.ok(blended >= 10, `${label}: curve must be antialiased on the native surface (got ${blended} blended pixels)`);
  }
  console.log(`PASS: ${label}, ${composited ? 'smooth alpha' : 'fallback cutout'} ${width}x${height}, CSS radius ${css.radius}`);
}

async function assertDrag(application, page) {
  // Remove the login overlay using isolated mock services so the pointer reaches
  // the same native drag region used by a signed-in widget.
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('has-session');
    ipcMain.handle('has-session', () => true);
    ipcMain.removeHandler('fetch-canvas-data');
    ipcMain.handle('fetch-canvas-data', () => []);
    ipcMain.removeAllListeners('start-canvas-polling');
  });
  await page.evaluate(() => window.api.saveSettings({ schoolUrl: 'https://canvas.mock' }));
  await page.reload();
  await page.locator('.auth-modal').waitFor({ state: 'hidden' });
  await page.locator('.tabs').waitFor();
  await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setPosition(300, 200);
    window.setAlwaysOnTop(true);
    window.focus();
  });
  const xid = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
  raiseTestWindow(xid);
  await page.waitForTimeout(150);
  const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const tabs = await page.locator('.tabs').boundingBox();
  // The padding above the tab buttons is the real native CSS drag region.
  const x = Math.round((bounds.x + tabs.x + tabs.width / 2) * Number(scale));
  const y = Math.round((bounds.y + tabs.y + 2) * Number(scale));
  motion(display, defaultScreen(display), x, y, 0);
  button(display, 1, 1, 0);
  flush(display);
  await page.waitForTimeout(100);
  try {
    for (let step = 1; step <= 12; step++) {
      motion(display, defaultScreen(display), x + step * 12, y + step * 4, 0);
      flush(display);
      await page.waitForTimeout(35);
      await assertRounded(application, page, `drag frame ${step}`);
    }
  } finally {
    button(display, 1, 0, 0);
    flush(display);
  }
  const moved = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  assert.ok(moved.x > bounds.x + 40, `Real pointer drag must move the native window: ${JSON.stringify({ bounds, moved })}`);
  await assertRounded(application, page, 'drag released');
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
      const xid = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNativeWindowHandle().readUInt32LE(0));
      // Wait for the native resize and its input region, not only the renderer's
      // new viewport, before inspecting the final geometry.
      for (let attempt = 0; attempt < 40; attempt++) {
        const rects = nativeShape(xid, 2);
        const width = Math.max(...rects.map(rect => rect.x + rect.width));
        const height = Math.max(...rects.map(rect => rect.y + rect.height));
        if (width === Math.round(dimensions.width * Number(scale)) && height === Math.round(dimensions.height * Number(scale))) break;
        await page.waitForTimeout(25);
      }
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertRounded(application, page, `${size} → ${nextSize}`);
    }
    await page.reload();
    await page.locator('.app-container').waitFor();
    await assertRounded(application, page, `${size} reload`);
    if (size === 'Large') await assertDrag(application, page);
    await page.screenshot({ path: path.join(userData, `${size}-${scale}.png`) });
    await application.close();
    application = null;
  }
  console.log(`PASS: cold launches, resizing, reloads, native antialiasing, and dragging. Screenshots: ${userData}`);
} finally {
  if (application) await application.close();
  closeDisplay(display);
}
