import { describe, it, expect } from 'vitest';
import { BloodMoonFade } from './blood-moon-fade';

describe('BloodMoonFade', () => {
  it('starts at the normal look and reaches the blood moon after the fade-in time', () => {
    const fade = new BloodMoonFade(1000, 2000);
    expect(fade.amount).toBe(0);
    fade.setTarget(true);
    fade.step(500);
    expect(fade.amount).toBeCloseTo(0.5);
    fade.step(499);
    expect(fade.amount).toBeLessThan(1);
    fade.step(1);
    expect(fade.amount).toBe(1);
    fade.step(1000);
    expect(fade.amount).toBe(1);
  });

  it('eases in and out: slow at both ends, fast in the middle', () => {
    const fade = new BloodMoonFade(1000, 1000);
    fade.setTarget(true);
    fade.step(100);
    const first = fade.amount;
    fade.step(400);
    const middle = fade.amount;
    fade.step(100);
    expect(first).toBeLessThan(0.1 * 0.5);
    expect(fade.amount - middle).toBeGreaterThan(first);
  });

  it('fades out at its own speed', () => {
    const fade = new BloodMoonFade(1000, 2000);
    fade.snap(true);
    fade.setTarget(false);
    fade.step(1000);
    expect(fade.amount).toBeCloseTo(0.5);
    fade.step(1000);
    expect(fade.amount).toBe(0);
  });

  it('turns round halfway without a jump', () => {
    const fade = new BloodMoonFade(1000, 1000);
    fade.setTarget(true);
    fade.step(300);
    const before = fade.amount;
    fade.setTarget(false);
    expect(fade.amount).toBe(before);
    fade.step(100);
    expect(fade.amount).toBeLessThan(before);
  });

  it('holds on a step of zero, a negative one or NaN', () => {
    const fade = new BloodMoonFade(1000, 1000);
    fade.setTarget(true);
    fade.step(0);
    fade.step(-50);
    fade.step(Number.NaN);
    expect(fade.amount).toBe(0);
  });

  it('snaps without a fade', () => {
    const fade = new BloodMoonFade(1000, 1000);
    fade.snap(true);
    expect(fade.amount).toBe(1);
    fade.snap(false);
    expect(fade.amount).toBe(0);
  });
});
