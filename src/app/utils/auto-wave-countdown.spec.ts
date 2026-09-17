import { describe, expect, it } from 'vitest';
import { AUTO_WAVE_DELAY_MS, AutoWaveCountdown } from './auto-wave-countdown';

describe('AutoWaveCountdown', () => {
  it('is due once the delay of game time has passed, and only once', () => {
    const c = new AutoWaveCountdown();
    c.arm(5_000);
    expect(c.tick(5_000 + AUTO_WAVE_DELAY_MS - 1)).toBe(false);
    expect(c.tick(5_000 + AUTO_WAVE_DELAY_MS)).toBe(true);
    expect(c.armed).toBe(false);
    expect(c.tick(5_000 + AUTO_WAVE_DELAY_MS + 100)).toBe(false);
  });

  it('counts whole seconds up for the display', () => {
    const c = new AutoWaveCountdown(10_000);
    expect(c.secondsLeft(0)).toBeNull();
    c.arm(0);
    expect(c.secondsLeft(0)).toBe(10);
    expect(c.secondsLeft(100)).toBe(10);
    expect(c.secondsLeft(9_001)).toBe(1);
    expect(c.secondsLeft(12_000)).toBe(0);
  });

  it('shows the full delay right after arming at any game clock value', () => {
    // The clock after 391 sub-steps of 16.667 ms: deadline minus now is 10000.000000000002
    let now = 0;
    for (let i = 0; i < 391; i++) now += 16.667;
    const c = new AutoWaveCountdown(10_000);
    c.arm(now);
    expect(c.secondsLeft(now)).toBe(10);
  });

  it('stands while the game clock stands (pause)', () => {
    const c = new AutoWaveCountdown(10_000);
    c.arm(1_000);
    // Paused: the clock does not move, frames keep asking
    for (let i = 0; i < 100; i++) expect(c.tick(4_000)).toBe(false);
    expect(c.secondsLeft(4_000)).toBe(7);
  });

  it('cancel ends it, arming again restarts it', () => {
    const c = new AutoWaveCountdown(10_000);
    c.arm(0);
    c.cancel();
    expect(c.tick(20_000)).toBe(false);
    c.arm(0);
    c.arm(5_000);
    expect(c.tick(14_999)).toBe(false);
    expect(c.tick(15_000)).toBe(true);
  });
});
