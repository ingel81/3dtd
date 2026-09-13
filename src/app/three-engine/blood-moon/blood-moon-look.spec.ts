import { describe, it, expect } from 'vitest';
import { BloodMoonLook } from './blood-moon-look';
import { BLOOD_MOON_LOOK } from '../../configs/blood-moon.config';

const { fadeInMs, fadeOutMs } = BLOOD_MOON_LOOK;

describe('BloodMoonLook', () => {
  it('fades in over the fade-in time once a blood moon wave runs, and out after it', () => {
    const look = new BloodMoonLook();
    look.setActive(true);
    expect(look.isActive).toBe(true);
    look.update(fadeInMs / 2, true);
    expect(look.amount).toBeCloseTo(0.5);
    look.update(fadeInMs / 2, true);
    expect(look.amount).toBe(1);

    look.setActive(false);
    look.update(fadeOutMs, true);
    expect(look.amount).toBe(0);
  });

  it('holds while the game is paused and goes on without a jump', () => {
    const look = new BloodMoonLook();
    look.setActive(true);
    look.update(fadeInMs / 4, true);
    const before = look.amount;
    look.update(10_000, false);
    expect(look.amount).toBe(before);
    look.update(16, true);
    expect(look.amount).toBeGreaterThan(before);
    expect(look.amount).toBeLessThan(1);
  });

  it('drops the look at once on a reset', () => {
    const look = new BloodMoonLook();
    look.setActive(true);
    look.update(fadeInMs, true);
    look.setActive(false, true);
    expect(look.amount).toBe(0);
  });

  it('shows nothing while the display option is off, and fades back in when it is turned on mid-wave', () => {
    const look = new BloodMoonLook();
    look.setActive(true);
    look.update(fadeInMs, true);
    look.setEnabled(false);
    expect(look.amount).toBe(0);
    look.update(fadeInMs, true);
    expect(look.amount).toBe(0);
    expect(look.isActive).toBe(true);

    look.setEnabled(true);
    expect(look.amount).toBe(0);
    look.update(fadeInMs, true);
    expect(look.amount).toBe(1);
  });

  it('stays off when the option is turned on outside a blood moon wave', () => {
    const look = new BloodMoonLook();
    look.setEnabled(false);
    look.setEnabled(true);
    look.update(fadeInMs, true);
    expect(look.amount).toBe(0);
  });
});
