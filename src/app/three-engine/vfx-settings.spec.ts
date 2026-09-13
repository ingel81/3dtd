import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VFX_SETTINGS,
  VFX_PRESETS,
  matchingVfxPreset,
  readVfxSettings,
  withVfxPreset,
  type VfxPreset,
} from './vfx-settings';

const PRESETS: VfxPreset[] = ['low', 'medium', 'high'];

describe('VFX presets', () => {
  it('reads the default look as High', () => {
    expect(matchingVfxPreset(DEFAULT_VFX_SETTINGS)).toBe('high');
  });

  it.each(PRESETS)('recognises %s once it is applied', (preset) => {
    expect(matchingVfxPreset(withVfxPreset(DEFAULT_VFX_SETTINGS, preset))).toBe(preset);
  });

  it('never touches the freeze tint, and the match ignores it', () => {
    for (const preset of PRESETS) {
      const settings = withVfxPreset({ ...DEFAULT_VFX_SETTINGS, freezeTint: false }, preset);
      expect(settings.freezeTint).toBe(false);
      expect(matchingVfxPreset(settings)).toBe(preset);
    }
  });

  it('never touches the blood moon either, and the match ignores it', () => {
    for (const preset of PRESETS) {
      const settings = withVfxPreset({ ...DEFAULT_VFX_SETTINGS, bloodMoon: false }, preset);
      expect(settings.bloodMoon).toBe(false);
      expect(matchingVfxPreset(settings)).toBe(preset);
    }
  });

  it('reads a changed switch as a custom mix', () => {
    expect(matchingVfxPreset({ ...DEFAULT_VFX_SETTINGS, bloom: true })).toBeNull();
    expect(matchingVfxPreset({ ...DEFAULT_VFX_SETTINGS, colorGrading: 'noir' })).toBeNull();
    expect(matchingVfxPreset({ ...withVfxPreset(DEFAULT_VFX_SETTINGS, 'low'), groundMarks: true })).toBeNull();
  });

  it('switches more off the lower the preset', () => {
    const on = (preset: VfxPreset) => Object.values(VFX_PRESETS[preset]).filter((value) => value === true).length;
    expect(on('low')).toBeLessThan(on('medium'));
    expect(on('medium')).toBeLessThan(on('high'));
  });
});

describe('readVfxSettings', () => {
  it('takes stored values and the default for anything missing or of the wrong kind', () => {
    expect(readVfxSettings({})).toEqual(DEFAULT_VFX_SETTINGS);
    expect(readVfxSettings({ projectileTrails: false, bloom: 'yes', colorGrading: 'noir' })).toEqual({
      ...DEFAULT_VFX_SETTINGS,
      projectileTrails: false,
      colorGrading: 'noir',
    });
    expect(readVfxSettings({ colorGrading: 'sepia' }).colorGrading).toBe('none');
  });

  it('has the blood moon on unless it was switched off', () => {
    expect(readVfxSettings({}).bloodMoon).toBe(true);
    expect(readVfxSettings({ bloodMoon: false }).bloodMoon).toBe(false);
    expect(readVfxSettings({ bloodMoon: 'no' }).bloodMoon).toBe(true);
  });
});
