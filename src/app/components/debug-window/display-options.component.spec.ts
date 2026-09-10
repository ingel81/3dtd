import { describe, it, expect, beforeEach } from 'vitest';
import { DisplayOptions, STORAGE_KEY, persistDisplayOptions } from './display-options.storage';

const PANEL_OPTIONS: DisplayOptions = {
  enemies: true,
  healthBars: false,
  animations: true,
  movement: true,
  textures: true,
  skeletonCloning: true,
  alphaBlend: true,
  screenShake: true,
  colorGrading: 'none',
};

function stored(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
}

describe('persistDisplayOptions', () => {
  beforeEach(() => localStorage.clear());

  it('keeps options the panel does not own, such as damageNumbers', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ damageNumbers: false, healthBars: true }));

    persistDisplayOptions(PANEL_OPTIONS);

    expect(stored()).toEqual({ ...PANEL_OPTIONS, damageNumbers: false });
  });

  it('writes the panel options when nothing is stored yet', () => {
    persistDisplayOptions(PANEL_OPTIONS);
    expect(stored()).toEqual(PANEL_OPTIONS);
  });

  it('replaces an unreadable entry', () => {
    for (const corrupt of ['{not json', 'null', '42']) {
      localStorage.setItem(STORAGE_KEY, corrupt);
      persistDisplayOptions(PANEL_OPTIONS);
      expect(stored()).toEqual(PANEL_OPTIONS);
    }
  });
});
