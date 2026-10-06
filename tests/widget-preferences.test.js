import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, mergeSettings, getWindowSize, fitWindowBounds } from '../electron/widgetPreferences.js';

test('Linux presets grow in width and height while Windows keeps its sizes', () => {
  assert.deepEqual(getWindowSize('Small', 'linux'), { width: 280, height: 320 });
  assert.deepEqual(getWindowSize('Medium', 'linux'), { width: 360, height: 520 });
  assert.deepEqual(getWindowSize('Large', 'linux'), { width: 480, height: 640 });
  assert.deepEqual(getWindowSize('Large', 'win32'), { width: 280, height: 560 });
  assert.deepEqual(getWindowSize('invalid', 'linux'), getWindowSize('Medium', 'linux'));
});

test('old and invalid preferences receive safe defaults', () => {
  for (const value of [null, [], { size: 'toString', textSize: 'invalid' }]) {
    assert.equal(normalizeSettings(value).size, 'Medium');
    assert.equal(normalizeSettings(value).textSize, 'Standard');
  }
  assert.deepEqual(normalizeSettings({ size: 'Small', schoolUrl: 'https://canvas.example' }), {
    size: 'Small', textSize: 'Standard', schoolUrl: 'https://canvas.example'
  });
});

test('partial saves preserve text size, login URL, and unrelated preferences', () => {
  let settings = { schoolUrl: 'https://canvas.example', size: 'Small', custom: true };
  settings = mergeSettings(settings, { textSize: 'Largest' });
  settings = mergeSettings(settings, { size: 'Large' });
  settings = mergeSettings(settings, { schoolUrl: 'https://canvas.new' });
  assert.deepEqual(settings, { schoolUrl: 'https://canvas.new', size: 'Large', textSize: 'Largest', custom: true });
});

test('window remains visible on offset displays and small work areas', () => {
  assert.deepEqual(fitWindowBounds({ x: -10, y: -40, width: 480, height: 640 },
    { x: -1280, y: 20, width: 1280, height: 1000 }), { x: -480, y: 20, width: 480, height: 640 });
  assert.deepEqual(fitWindowBounds({ x: 1900, y: 600, width: 480, height: 640 },
    { x: 100, y: 50, width: 300, height: 400 }), { x: 100, y: 50, width: 300, height: 400 });
});
