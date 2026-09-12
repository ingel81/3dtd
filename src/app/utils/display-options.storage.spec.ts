import { describe, it, expect, beforeEach } from 'vitest';
import {
  LEGACY_FPS_LIMIT_KEY,
  LEGACY_SCREEN_SHAKE_KEY,
  STORAGE_KEY,
  loadDisplayOptions,
  persistDisplayOptions,
} from './display-options.storage';

const PANEL_OPTIONS = {
  enemies: true,
  animations: true,
  movement: true,
  textures: true,
  skeletonCloning: true,
  alphaBlend: true,
};

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
}

describe('persistDisplayOptions', () => {
  beforeEach(() => localStorage.clear());

  it('keeps options the writer does not own, such as damageNumbers', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ damageNumbers: false, healthBars: true }));

    persistDisplayOptions(PANEL_OPTIONS);

    expect(stored()).toEqual({ ...PANEL_OPTIONS, damageNumbers: false, healthBars: true });
  });

  it('writes the options when nothing is stored yet', () => {
    persistDisplayOptions(PANEL_OPTIONS);
    expect(stored()).toEqual(PANEL_OPTIONS);
  });

  it('replaces an unreadable entry', () => {
    for (const corrupt of ['{not json', 'null', '42', '[true]']) {
      localStorage.setItem(STORAGE_KEY, corrupt);
      persistDisplayOptions(PANEL_OPTIONS);
      expect(stored()).toEqual(PANEL_OPTIONS);
    }
  });
});

describe('loadDisplayOptions', () => {
  beforeEach(() => localStorage.clear());

  it('is empty when nothing or nothing readable is stored', () => {
    expect(loadDisplayOptions()).toEqual({});
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadDisplayOptions()).toEqual({});
  });

  it('folds the old frame-cap and screen-shake keys in and drops them', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ healthBars: false }));
    localStorage.setItem(LEGACY_FPS_LIMIT_KEY, '30');
    localStorage.setItem(LEGACY_SCREEN_SHAKE_KEY, 'false');

    expect(loadDisplayOptions()).toEqual({ healthBars: false, fpsLimit: 30, screenShake: false });
    expect(stored()).toEqual({ healthBars: false, fpsLimit: 30, screenShake: false });
    expect(localStorage.getItem(LEGACY_FPS_LIMIT_KEY)).toBeNull();
    expect(localStorage.getItem(LEGACY_SCREEN_SHAKE_KEY)).toBeNull();
  });

  it('keeps a value the object already holds over an old key', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ screenShake: true, fpsLimit: 60 }));
    localStorage.setItem(LEGACY_FPS_LIMIT_KEY, '30');
    localStorage.setItem(LEGACY_SCREEN_SHAKE_KEY, 'false');

    expect(loadDisplayOptions()).toEqual({ screenShake: true, fpsLimit: 60 });
    expect(localStorage.getItem(LEGACY_SCREEN_SHAKE_KEY)).toBeNull();
  });
});
