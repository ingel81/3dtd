import { describe, it, expect } from 'vitest';
import { endZoneProximity } from './strategic-placement.service';

/**
 * The placement weight used to be linear in spawn proximity ("build from spawn
 * outward"). Together with an upgrade strategy that also only funded the
 * spawn-nearest towers, that produced a defense with a single killzone at the
 * spawn and nothing behind it. Measured over 1834 waves: in waves that leaked
 * nothing the furthest enemy died at a median of 12% along the path, and once
 * any enemy passed 80% one reached the base in 95% of cases.
 *
 * These assert the shape that replaces it.
 */
describe('endZoneProximity', () => {
  it('scores both ends above the middle', () => {
    const middle = endZoneProximity(0.5);
    expect(endZoneProximity(0)).toBeGreaterThan(middle);
    expect(endZoneProximity(1)).toBeGreaterThan(middle);
  });

  it('keeps the spawn end ahead, so early placements are unchanged', () => {
    expect(endZoneProximity(0)).toBeGreaterThan(endZoneProximity(1));
  });

  it('has its trough where the two branches cross, slightly past centre', () => {
    // 1 - t = W * t  =>  t = 1 / (1 + W) = 0.5555... for W = 0.8.
    // Not at 0.5: the spawn branch stays on top a little longer because it is
    // the steeper of the two.
    const samples = Array.from({ length: 1001 }, (_, i) => i / 1000);
    const trough = samples.reduce((a, b) =>
      endZoneProximity(b) < endZoneProximity(a) ? b : a);
    expect(trough).toBeCloseTo(1 / 1.8, 2);
  });

  it('rises monotonically towards the HQ past the trough', () => {
    // The regression that mattered: under the old linear weight this stretch
    // fell away to zero, so the last part of the path never got a tower.
    for (let t = 0.60; t < 1; t += 0.05) {
      expect(endZoneProximity(t)).toBeGreaterThan(endZoneProximity(t - 0.05));
    }
  });

  it('falls monotonically from the spawn to the trough', () => {
    for (let t = 0.05; t < 0.55; t += 0.05) {
      expect(endZoneProximity(t)).toBeLessThan(endZoneProximity(t - 0.05));
    }
  });

  it('clamps out-of-range input instead of extrapolating', () => {
    expect(endZoneProximity(-1)).toBe(endZoneProximity(0));
    expect(endZoneProximity(2)).toBe(endZoneProximity(1));
  });
});
