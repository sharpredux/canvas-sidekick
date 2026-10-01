export const LINUX_SIZES = {
  Small: { width: 280, height: 320 },
  Medium: { width: 360, height: 520 },
  Large: { width: 480, height: 640 }
};

const LEGACY_SIZES = {
  Small: { width: 200, height: 200 },
  Medium: { width: 280, height: 448 },
  Large: { width: 280, height: 560 }
};

export const TEXT_SCALES = { Standard: 1, Larger: 1.125, Largest: 1.25 };

export function normalizeSettings(settings = {}) {
  const value = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  return {
    ...value,
    size: Object.hasOwn(LINUX_SIZES, value.size) ? value.size : 'Medium',
    textSize: Object.hasOwn(TEXT_SCALES, value.textSize) ? value.textSize : 'Standard'
  };
}

export function mergeSettings(previous, update) {
  return normalizeSettings({ ...normalizeSettings(previous), ...update });
}

export function getWindowSize(size, platform) {
  const sizes = platform === 'linux' ? LINUX_SIZES : LEGACY_SIZES;
  return { ...(Object.hasOwn(sizes, size) ? sizes[size] : sizes.Medium) };
}

// Electron bounds and work areas both use device-independent desktop pixels.
export function fitWindowBounds(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    width,
    height,
    x: Math.round(Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)))
  };
}
