import { describe, it, expect } from 'vitest';
import { BLOOD_MOON_FIRST_WAVE, BLOOD_MOON_INTERVAL, isBloodMoonWave, nextBloodMoonWave } from './blood-moon.config';

describe('isBloodMoonWave', () => {
  it('is every seventh wave from W14', () => {
    const waves: number[] = [];
    for (let wave = 1; wave <= 50; wave++) {
      if (isBloodMoonWave(wave)) waves.push(wave);
    }
    expect(waves).toEqual([14, 21, 28, 35, 42, 49]);
  });

  it('keeps the rhythm in endless play', () => {
    expect(isBloodMoonWave(BLOOD_MOON_FIRST_WAVE + 100 * BLOOD_MOON_INTERVAL)).toBe(true);
    expect(isBloodMoonWave(BLOOD_MOON_FIRST_WAVE + 100 * BLOOD_MOON_INTERVAL + 1)).toBe(false);
    expect(isBloodMoonWave(7)).toBe(false);
  });

  it('knows no blood moon before the first wave or between whole waves', () => {
    expect(isBloodMoonWave(0)).toBe(false);
    expect(isBloodMoonWave(-7)).toBe(false);
    expect(isBloodMoonWave(14.5)).toBe(false);
    expect(isBloodMoonWave(Number.NaN)).toBe(false);
  });
});

describe('nextBloodMoonWave', () => {
  it('names the first blood moon wave after the given one', () => {
    expect(nextBloodMoonWave(0)).toBe(14);
    expect(nextBloodMoonWave(13)).toBe(14);
    expect(nextBloodMoonWave(14)).toBe(21);
    expect(nextBloodMoonWave(20)).toBe(21);
    expect(nextBloodMoonWave(21)).toBe(28);
    expect(nextBloodMoonWave(700)).toBe(707);
  });

  it('always lands on a blood moon wave', () => {
    for (let wave = 0; wave < 100; wave++) {
      const next = nextBloodMoonWave(wave);
      expect(next).toBeGreaterThan(wave);
      expect(isBloodMoonWave(next)).toBe(true);
    }
  });
});
