'use strict';

/**
 * Window size, position, maximized and fullscreen across starts.
 *
 * Stored as JSON in userData. The decisions (what a first start looks like,
 * what happens when the saved monitor is gone) are plain functions over the
 * saved state and the current displays, so the tests cover them without
 * Electron.
 */

const fs = require('node:fs');

/** Normal-state size on the first start, before it is maximized. */
const DEFAULT_SIZE = { width: 1600, height: 900 };

/**
 * Smallest window the game accepts. 1024 x 600 still fits the work area of
 * a 1920 x 1080 laptop at 150 % scaling (1280 x 680 logical pixels).
 */
const MIN_SIZE = { width: 1024, height: 600 };

/** Height of the strip at the top that has to be on a screen to drag the window back. */
const TITLE_BAR_HEIGHT = 32;

/** A saved state, or null when the text is not one. */
function parseWindowState(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const bounds = raw?.bounds;
  if (!bounds || typeof bounds !== 'object') return null;
  const { x, y, width, height } = bounds;
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    bounds: { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) },
    maximized: raw.maximized === true,
    fullScreen: raw.fullScreen === true,
  };
}

function contains(area, point) {
  return (
    point.x >= area.x && point.x < area.x + area.width && point.y >= area.y && point.y < area.y + area.height
  );
}

/** Size clamped to the work area, then centered in it. */
function centeredIn(workArea, size) {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

/**
 * Where and how the window opens.
 *
 * First start: centered on the primary display, maximized. A saved window
 * whose title bar is on no display any more (monitor unplugged, resolution
 * changed) keeps its size and state but moves to the center of the primary
 * display; otherwise it could open where nobody can grab it.
 */
function initialWindowState(saved, displays, primary) {
  if (!saved) {
    return { bounds: centeredIn(primary.workArea, DEFAULT_SIZE), maximized: true, fullScreen: false };
  }

  const { bounds } = saved;
  const titleBar = { x: bounds.x + Math.round(bounds.width / 2), y: bounds.y + TITLE_BAR_HEIGHT / 2 };
  const display = displays.find((candidate) => contains(candidate.workArea, titleBar));
  if (!display) {
    return { bounds: centeredIn(primary.workArea, bounds), maximized: saved.maximized, fullScreen: saved.fullScreen };
  }

  return {
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: Math.min(bounds.width, display.workArea.width),
      height: Math.min(bounds.height, display.workArea.height),
    },
    maximized: saved.maximized,
    fullScreen: saved.fullScreen,
  };
}

/** Minimum size that still fits the work area the window opens on. */
function minimumSizeFor(workArea) {
  return {
    width: Math.min(MIN_SIZE.width, workArea.width),
    height: Math.min(MIN_SIZE.height, workArea.height),
  };
}

/**
 * What gets saved. Fullscreen is a layer on top of the windowed state: while
 * fullscreen, Windows reports the screen as the normal bounds and
 * isMaximized() as false, so the windowed part is only taken outside of
 * fullscreen (and outside of minimized) and kept through it. Leaving
 * fullscreen after a restart then returns to the same maximized or sized
 * window as before.
 *
 * `created` is what the window reports right after construction. With
 * fractional scaling Electron does not create the size it was asked for
 * (1600 x 900 at 125 % comes out 907 high), and the error depends on the
 * size. Saving the reported size would grow the window by a few pixels on
 * every start; the tracker subtracts this session's error instead, so an
 * untouched window saves exactly what it was opened with.
 */
function createStateTracker(initial, created = initial.bounds) {
  const error = {
    x: created.x - initial.bounds.x,
    y: created.y - initial.bounds.y,
    width: created.width - initial.bounds.width,
    height: created.height - initial.bounds.height,
  };
  let windowed = { bounds: initial.bounds, maximized: initial.maximized };
  return {
    observe(window) {
      if (window.isFullScreen() || window.isMinimized()) return;
      const reported = window.getNormalBounds();
      windowed = {
        bounds: {
          x: reported.x - error.x,
          y: reported.y - error.y,
          width: reported.width - error.width,
          height: reported.height - error.height,
        },
        maximized: window.isMaximized(),
      };
    },
    snapshot(window) {
      return { ...windowed, fullScreen: window.isFullScreen() };
    },
  };
}

function readWindowState(filePath) {
  try {
    return parseWindowState(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

/** Write through a temporary file, so a crash mid-write never leaves half a JSON. */
function writeWindowState(filePath, state) {
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state));
  fs.renameSync(temporary, filePath);
}

module.exports = {
  DEFAULT_SIZE,
  MIN_SIZE,
  createStateTracker,
  initialWindowState,
  minimumSizeFor,
  parseWindowState,
  readWindowState,
  writeWindowState,
};
