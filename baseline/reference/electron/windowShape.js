import { createRequire } from 'node:module';

// Keep this radius aligned with .app-container.linux-widget in index.css.
const WIDGET_CORNER_RADIUS = 24;
const require = createRequire(import.meta.url);
const appliedShapes = new WeakMap();
let x11Api;

function getX11Api() {
  if (!x11Api) {
    const koffi = require('koffi');
    const x11 = koffi.load('libX11.so.6');
    const xext = koffi.load('libXext.so.6');
    koffi.struct('WidgetShapeRectangle', {
      x: 'short', y: 'short', width: 'unsigned short', height: 'unsigned short'
    });
    x11Api = {
      open: x11.func('void *XOpenDisplay(str name)'),
      close: x11.func('int XCloseDisplay(void *display)'),
      screen: x11.func('int XDefaultScreen(void *display)'),
      atom: x11.func('unsigned long XInternAtom(void *display, str name, int onlyIfExists)'),
      owner: x11.func('unsigned long XGetSelectionOwner(void *display, unsigned long selection)'),
      geometry: x11.func('int XGetGeometry(void *display, unsigned long window, _Out_ unsigned long *root, _Out_ int *x, _Out_ int *y, _Out_ unsigned int *width, _Out_ unsigned int *height, _Out_ unsigned int *border, _Out_ unsigned int *depth)'),
      shape: xext.func('void XShapeCombineRectangles(void *display, unsigned long window, int kind, int x, int y, WidgetShapeRectangle *rectangles, int count, int operation, int ordering)'),
      resetShape: xext.func('void XShapeCombineMask(void *display, unsigned long window, int kind, int x, int y, unsigned long mask, int operation)')
    };
  }
  return x11Api;
}

export function roundedWindowShape(width, height, cornerRadius = WIDGET_CORNER_RADIUS) {
  const radius = Math.min(Math.round(cornerRadius), Math.floor(width / 2), Math.floor(height / 2));
  const rects = [];
  // Approximate each circular corner with one-pixel scanlines. Native
  // clipping works even on X11 desktops without an alpha compositor.
  for (let y = 0; y < radius; y++) {
    const distance = radius - y - 0.5;
    const inset = Math.round(radius - Math.sqrt(radius * radius - distance * distance));
    const row = { x: inset, y, width: width - inset * 2, height: 1 };
    rects.push(row, { ...row, y: height - y - 1 });
  }
  if (height > radius * 2) {
    rects.push({ x: 0, y: radius, width, height: height - radius * 2 });
  }
  return rects;
}

export function applyWidgetWindowShape(windowInstance, scaleFactor = 1) {
  if (process.platform !== 'linux' || process.env.CANVAS_SIDEKICK_NATIVE_WAYLAND === '1' || windowInstance.isDestroyed()) return;
  const [width, height] = windowInstance.getSize();
  const api = getX11Api();
  const display = api.open(process.env.DISPLAY);
  if (!display) {
    windowInstance.setShape(roundedWindowShape(width, height));
    return;
  }
  try {
    const selection = api.atom(display, `_NET_WM_CM_S${api.screen(display)}`, 0);
    const composited = api.owner(display, selection) !== 0;
    const xid = windowInstance.getNativeWindowHandle().readUInt32LE(0);
    const pixelWidth = [0];
    const pixelHeight = [0];
    if (!api.geometry(display, xid, [0], [0], [0], pixelWidth, pixelHeight, [0], [0])) return;
    const signature = `${pixelWidth[0]}:${pixelHeight[0]}:${scaleFactor}:${composited}`;
    if (appliedShapes.get(windowInstance) === signature) return;

    // A bounding cutout is binary: it removes the partially transparent pixels
    // that make CSS curves smooth. With a compositor, leave drawing to the
    // renderer and round only the input region so empty corners pass clicks
    // through to the desktop. Keep the hard cutout as a non-composited fallback.
    // Logical getSize() can round up by a pixel as a window moves at fractional
    // scale. Use the actual X11 dimensions so dragging never changes its mask.
    const input = roundedWindowShape(pixelWidth[0], pixelHeight[0], WIDGET_CORNER_RADIUS * scaleFactor);
    if (composited) {
      api.resetShape(display, xid, 0 /* ShapeBounding */, 0, 0, 0 /* None */, 0 /* ShapeSet */);
    } else {
      api.shape(display, xid, 0 /* ShapeBounding */, 0, 0, input, input.length, 0 /* ShapeSet */, 0 /* Unsorted */);
    }
    api.shape(display, xid, 2 /* ShapeInput */, 0, 0, input, input.length, 0 /* ShapeSet */, 0 /* Unsorted */);
    appliedShapes.set(windowInstance, signature);
  } finally {
    // XCloseDisplay flushes pending shape changes before releasing the connection.
    api.close(display);
  }
}
