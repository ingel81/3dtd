'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { describe, it } = require('node:test');
const {
  DEFAULT_SIZE,
  MIN_SIZE,
  createStateTracker,
  initialWindowState,
  minimumSizeFor,
  parseWindowState,
  readWindowState,
  writeWindowState,
} = require('../src/window-state');

const display = (x, y, width, height) => ({ workArea: { x, y, width, height } });
const primary = display(0, 0, 1920, 1040);
const right = display(1920, 0, 2560, 1400);

describe('parseWindowState', () => {
  it('reads a saved state', () => {
    const text = JSON.stringify({ bounds: { x: 10, y: 20, width: 1400.4, height: 800 }, maximized: true });
    assert.deepEqual(parseWindowState(text), {
      bounds: { x: 10, y: 20, width: 1400, height: 800 },
      maximized: true,
      fullScreen: false,
    });
  });

  it('refuses broken or incomplete files', () => {
    for (const text of ['', '{', 'null', '[]', '{"bounds":{}}', '{"bounds":{"x":0,"y":0,"width":0,"height":5}}',
      '{"bounds":{"x":"0","y":0,"width":800,"height":600}}']) {
      assert.equal(parseWindowState(text), null, text);
    }
  });
});

describe('initialWindowState', () => {
  it('opens maximized and centered on the first start', () => {
    const state = initialWindowState(null, [primary, right], primary);
    assert.equal(state.maximized, true);
    assert.equal(state.fullScreen, false);
    assert.deepEqual(state.bounds, {
      x: (1920 - DEFAULT_SIZE.width) / 2,
      y: (1040 - DEFAULT_SIZE.height) / 2,
      ...DEFAULT_SIZE,
    });
  });

  it('shrinks the first window on a small screen', () => {
    const small = display(0, 0, 1280, 680);
    assert.deepEqual(initialWindowState(null, [small], small).bounds, { x: 0, y: 0, width: 1280, height: 680 });
  });

  it('restores a window on a display that still exists', () => {
    const saved = { bounds: { x: 2000, y: 100, width: 1600, height: 900 }, maximized: false, fullScreen: true };
    assert.deepEqual(initialWindowState(saved, [primary, right], primary), saved);
  });

  it('moves a window whose display is gone to the primary one', () => {
    const saved = { bounds: { x: 2000, y: 100, width: 1600, height: 900 }, maximized: true, fullScreen: false };
    const state = initialWindowState(saved, [primary], primary);
    assert.deepEqual(state.bounds, { x: 160, y: 70, width: 1600, height: 900 });
    assert.equal(state.maximized, true);
  });

  it('moves a window whose title bar is off screen', () => {
    const saved = { bounds: { x: 100, y: -500, width: 1200, height: 800 }, maximized: false, fullScreen: false };
    assert.deepEqual(initialWindowState(saved, [primary], primary).bounds, { x: 360, y: 120, width: 1200, height: 800 });
  });

  it('clamps a window larger than its display', () => {
    const saved = { bounds: { x: 0, y: 0, width: 3000, height: 2000 }, maximized: false, fullScreen: false };
    assert.deepEqual(initialWindowState(saved, [primary], primary).bounds, { x: 0, y: 0, width: 1920, height: 1040 });
  });
});

describe('minimumSizeFor', () => {
  it('uses the game minimum where it fits and the work area where it does not', () => {
    assert.deepEqual(minimumSizeFor(primary.workArea), MIN_SIZE);
    assert.deepEqual(minimumSizeFor({ x: 0, y: 0, width: 1000, height: 560 }), { width: 1000, height: 560 });
  });
});

describe('createStateTracker', () => {
  const fakeWindow = (overrides) => ({
    isFullScreen: () => false,
    isMinimized: () => false,
    isMaximized: () => false,
    getNormalBounds: () => ({ x: 10, y: 10, width: 1300, height: 800 }),
    ...overrides,
  });
  const initial = { bounds: { x: 224, y: 102, width: 1600, height: 900 }, maximized: true, fullScreen: false };

  it('keeps the windowed state through fullscreen', () => {
    const tracker = createStateTracker(initial);
    // What Windows reports while fullscreen: the screen, not maximized.
    const fullScreen = fakeWindow({
      isFullScreen: () => true,
      getNormalBounds: () => ({ x: -7, y: -7, width: 2064, height: 1120 }),
    });
    tracker.observe(fullScreen);
    assert.deepEqual(tracker.snapshot(fullScreen), { ...initial, fullScreen: true });
  });

  it('follows the window while it is windowed', () => {
    const tracker = createStateTracker(initial);
    const windowed = fakeWindow();
    tracker.observe(windowed);
    assert.deepEqual(tracker.snapshot(windowed), {
      bounds: { x: 10, y: 10, width: 1300, height: 800 },
      maximized: false,
      fullScreen: false,
    });
  });

  it('does not let the scaling error of window creation pile up', () => {
    // Asked for 900, Electron made it 907 and reports 907 from then on.
    const tracker = createStateTracker(initial, { ...initial.bounds, height: 907 });
    const untouched = fakeWindow({ isMaximized: () => true, getNormalBounds: () => ({ ...initial.bounds, height: 907 }) });
    tracker.observe(untouched);
    assert.deepEqual(tracker.snapshot(untouched), initial);

    // Resized by the player to 1200 x 707 as reported: saved minus the same error.
    const resized = fakeWindow({ getNormalBounds: () => ({ x: 300, y: 150, width: 1200, height: 707 }) });
    tracker.observe(resized);
    assert.deepEqual(tracker.snapshot(resized).bounds, { x: 300, y: 150, width: 1200, height: 700 });
  });

  it('ignores a minimized window', () => {
    const tracker = createStateTracker(initial);
    tracker.observe(fakeWindow({ isMinimized: () => true, getNormalBounds: () => ({ x: 0, y: 0, width: 1, height: 1 }) }));
    assert.deepEqual(tracker.snapshot(fakeWindow()), initial);
  });
});

describe('readWindowState / writeWindowState', () => {
  it('round-trips through the file and survives a missing one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), '3dtd-window-'));
    try {
      const file = path.join(dir, 'window-state.json');
      assert.equal(readWindowState(file), null);
      const state = { bounds: { x: 1, y: 2, width: 1300, height: 700 }, maximized: false, fullScreen: true };
      writeWindowState(file, state);
      assert.deepEqual(readWindowState(file), state);
      assert.ok(!fs.existsSync(`${file}.tmp`));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
