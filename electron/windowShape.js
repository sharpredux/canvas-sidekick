// Keep this radius aligned with .app-container.linux-widget in index.css.
const WIDGET_CORNER_RADIUS = 24;

export function roundedWindowShape(width, height) {
  const radius = Math.min(WIDGET_CORNER_RADIUS, Math.floor(width / 2), Math.floor(height / 2));
  const rects = [];
  // Approximate each circular corner with one logical-pixel scanline. Native
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

export function applyWidgetWindowShape(windowInstance) {
  if (process.platform !== 'linux' || process.env.CANVAS_SIDEKICK_NATIVE_WAYLAND === '1' || windowInstance.isDestroyed()) return;
  const [width, height] = windowInstance.getSize();
  windowInstance.setShape(roundedWindowShape(width, height));
}
