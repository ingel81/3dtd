import { describe, it, expect, beforeEach } from 'vitest';
import {
  DebugWindowService,
  DebugWindowId,
  DEBUG_PANEL_MIN_SIZE,
  clampPanelSize,
} from './debug-window.service';

const STORAGE_KEY = 'td_debug_windows_v6';

const ALL_IDS: DebugWindowId[] = [
  'camera', 'wave', 'sound', 'events', 'devworld', 'bots',
  'tower', 'enemy', 'display', 'performance', 'los',
];

describe('clampPanelSize', () => {
  it('keeps a size that fits', () => {
    expect(clampPanelSize({ width: 400, height: 300 }, 1000, 800)).toEqual({ width: 400, height: 300 });
  });

  it('raises a size below the shared minimum', () => {
    expect(clampPanelSize({ width: 50, height: 20 })).toEqual(DEBUG_PANEL_MIN_SIZE);
  });

  it('caps a size to the available space', () => {
    expect(clampPanelSize({ width: 900, height: 900 }, 600, 500)).toEqual({ width: 600, height: 500 });
  });

  it('lets the minimum win when the space is smaller', () => {
    expect(clampPanelSize({ width: 900, height: 900 }, 100, 100)).toEqual(DEBUG_PANEL_MIN_SIZE);
  });
});

describe('DebugWindowService', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it('gives every panel a default size at or above the minimum', () => {
    const service = new DebugWindowService();
    for (const id of ALL_IDS) {
      const size = service.getSize(id);
      expect(size.width, id).toBeGreaterThanOrEqual(DEBUG_PANEL_MIN_SIZE.width);
      expect(size.height, id).toBeGreaterThanOrEqual(DEBUG_PANEL_MIN_SIZE.height);
    }
  });

  it('clamps a size below the minimum on update', () => {
    const service = new DebugWindowService();
    service.updateSize('camera', { width: 10, height: 10 });
    expect(service.getSize('camera')).toEqual(DEBUG_PANEL_MIN_SIZE);
  });

  it('restores a stored size in a new instance', () => {
    new DebugWindowService().updateSize('wave', { width: 480, height: 610 });
    expect(new DebugWindowService().getSize('wave')).toEqual({ width: 480, height: 610 });
  });

  it('falls back to the default size for a panel stored without one', () => {
    const defaultSize = new DebugWindowService().getSize('display');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      display: { isOpen: true, position: { x: 5, y: 6 }, zIndex: 120 },
    }));

    const service = new DebugWindowService();
    expect(service.getSize('display')).toEqual(defaultSize);
    expect(service.displayWindow().isOpen).toBe(true);
    expect(service.getPosition('display')).toEqual({ x: 5, y: 6 });
  });

  it('ignores a malformed stored size and clamps one below the minimum', () => {
    const defaultSize = new DebugWindowService().getSize('sound');
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sound: { size: { width: 'wide' } },
      tower: { size: { width: 120, height: 90 } },
    }));

    const service = new DebugWindowService();
    expect(service.getSize('sound')).toEqual(defaultSize);
    expect(service.getSize('tower')).toEqual(DEBUG_PANEL_MIN_SIZE);
  });
});
