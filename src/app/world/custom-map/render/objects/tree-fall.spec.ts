import { describe, it, expect } from 'vitest';
import { FELLED_PITCH, fallSeconds, fallTilt } from './tree-fall';

describe('tree-fall (docs/DESTRUCTION_PLAN.md, felled trees)', () => {
  it('tips a tree over about its foot, slowly at first and ever faster, to lie on its crown', () => {
    const tilts = Array.from({ length: 40 }, (_, k) => fallTilt(k * 0.05, 12));
    expect(tilts[0]).toBeGreaterThan(0);
    expect(tilts[0]).toBeLessThan(0.1);
    // Until it lands every step tips it further, and by more than the one before
    const landing = tilts.findIndex((t) => t >= FELLED_PITCH);
    for (let k = 1; k < (landing < 0 ? tilts.length : landing); k++) {
      expect(tilts[k]).toBeGreaterThan(tilts[k - 1]);
      if (k > 1) expect(tilts[k] - tilts[k - 1]).toBeGreaterThanOrEqual(tilts[k - 1] - tilts[k - 2] - 1e-6);
    }
    // Lying after its time, never past the tilt it lies at
    expect(fallTilt(fallSeconds(12), 12)).toBe(FELLED_PITCH);
    for (let t = 0; t < 6; t += 0.01) expect(fallTilt(t, 12)).toBeLessThanOrEqual(FELLED_PITCH);
  });

  it('falls in seconds that grow with the root of its height, and its crown springs back once it lands', () => {
    // A 12 m oak lands between 2 and 3 s after the blast (it was 1.4 s for every tree before)
    const lands = (h: number) => {
      let t = 0;
      while (fallTilt(t, h) < FELLED_PITCH - 0.01 && t < 10) t += 0.005;
      return t;
    };
    expect(lands(12)).toBeGreaterThan(2);
    expect(lands(12)).toBeLessThan(3);
    expect(lands(24) / lands(6)).toBeCloseTo(2, 1);
    expect(fallSeconds(24)).toBeGreaterThan(fallSeconds(6));
    // After landing the crown comes up a little and settles
    const after = Array.from({ length: 40 }, (_, k) => fallTilt(lands(12) + 0.02 + k * 0.02, 12));
    expect(Math.min(...after)).toBeLessThan(FELLED_PITCH - 0.02);
    expect(Math.min(...after)).toBeGreaterThan(FELLED_PITCH - 0.1);
  });
});
