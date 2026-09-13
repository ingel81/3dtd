import { describe, it, expect, vi } from 'vitest';
import { BloodMoonLook } from './blood-moon-look';
import { BLOOD_MOON_LOOK } from '../../configs/blood-moon.config';

const { fadeInMs, fadeOutMs } = BLOOD_MOON_LOOK;

function setup() {
  const mood = { setAmount: vi.fn(), dispose: vi.fn() };
  const enemies = { setBloodMoon: vi.fn() };
  const searchlights = { setAmount: vi.fn(), advance: vi.fn() };
  const oozes = { setBloodMoon: vi.fn() };
  const look = new BloodMoonLook({ mood, enemies, searchlights, oozes });
  return { look, mood, enemies, searchlights, oozes };
}

describe('BloodMoonLook', () => {
  it('fades in over the fade-in time once a blood moon wave runs, and out after it', () => {
    const { look } = setup();
    look.setActive(true);
    expect(look.isActive).toBe(true);
    look.update(fadeInMs / 2, true, false);
    expect(look.amount).toBeCloseTo(0.5);
    look.update(fadeInMs / 2, true, false);
    expect(look.amount).toBe(1);

    look.setActive(false);
    look.update(fadeOutMs, true, false);
    expect(look.amount).toBe(0);
  });

  it('holds while the game is paused and goes on without a jump', () => {
    const { look } = setup();
    look.setActive(true);
    look.update(fadeInMs / 4, true, false);
    const before = look.amount;
    look.update(10_000, false, false);
    expect(look.amount).toBe(before);
    look.update(16, true, false);
    expect(look.amount).toBeGreaterThan(before);
    expect(look.amount).toBeLessThan(1);
  });

  it('drops the look at once on a reset', () => {
    const { look } = setup();
    look.setActive(true);
    look.update(fadeInMs, true, false);
    look.setActive(false, true);
    expect(look.amount).toBe(0);
  });

  it('shows nothing while the display option is off, and fades back in when it is turned on mid-wave', () => {
    const { look } = setup();
    look.setActive(true);
    look.update(fadeInMs, true, false);
    look.setEnabled(false);
    expect(look.amount).toBe(0);
    look.update(fadeInMs, true, false);
    expect(look.amount).toBe(0);
    expect(look.isActive).toBe(true);

    look.setEnabled(true);
    expect(look.amount).toBe(0);
    look.update(fadeInMs, true, false);
    expect(look.amount).toBe(1);
  });

  it('stays off when the option is turned on outside a blood moon wave', () => {
    const { look } = setup();
    look.setEnabled(false);
    look.setEnabled(true);
    look.update(fadeInMs, true, false);
    expect(look.amount).toBe(0);
  });

  it('hands the amount to the mood only when it or the output target changes', () => {
    const { look, mood } = setup();
    look.update(16, true, false);
    expect(mood.setAmount).not.toHaveBeenCalled();

    look.setActive(true);
    look.update(fadeInMs, true, false);
    expect(mood.setAmount).toHaveBeenLastCalledWith(1, false);
    look.update(16, true, false);
    expect(mood.setAmount).toHaveBeenCalledTimes(1);

    look.update(16, true, true);
    expect(mood.setAmount).toHaveBeenLastCalledWith(1, true);
    expect(mood.setAmount).toHaveBeenCalledTimes(2);

    look.setActive(false, true);
    look.update(16, false, true);
    expect(mood.setAmount).toHaveBeenLastCalledWith(0, true);
  });

  it('lets the enemies glow along with the mood', () => {
    const { look, enemies, oozes } = setup();
    look.setActive(true);
    look.update(fadeInMs / 2, true, false);
    expect(enemies.setBloodMoon).toHaveBeenLastCalledWith(look.amount, false);
    expect(oozes.setBloodMoon).toHaveBeenLastCalledWith(look.amount);
    look.setActive(false, true);
    look.update(16, true, false);
    expect(enemies.setBloodMoon).toHaveBeenLastCalledWith(0, false);
    expect(oozes.setBloodMoon).toHaveBeenLastCalledWith(0);
  });

  it('lights the searchlights with the fade and sweeps them only while they show and the game runs', () => {
    const { look, searchlights } = setup();
    look.update(16, true, false);
    expect(searchlights.advance).not.toHaveBeenCalled();

    look.setActive(true);
    look.update(fadeInMs, true, false);
    expect(searchlights.setAmount).toHaveBeenLastCalledWith(1);
    expect(searchlights.advance).toHaveBeenLastCalledWith(fadeInMs);

    searchlights.advance.mockClear();
    look.update(500, false, false);
    expect(searchlights.advance).not.toHaveBeenCalled();

    look.setActive(false, true);
    look.update(16, true, false);
    expect(searchlights.setAmount).toHaveBeenLastCalledWith(0);
    expect(searchlights.advance).not.toHaveBeenCalled();
  });

  it('disposes its parts', () => {
    const { look, mood } = setup();
    look.dispose();
    expect(mood.dispose).toHaveBeenCalled();
  });
});
