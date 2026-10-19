import { CRATER_LIP, CRATER_REACH_SQ, RUBBLE_LUMP_M, craterCm, rubbleCm, rubbleLump } from './impact-stamp';

describe('impact stamps (docs/DESTRUCTION_PLAN.md)', () => {
  it('digs a crater: its depth in the middle, a smooth floor, a low wall just past the rim, nothing beyond', () => {
    const r = 2.5;
    expect(craterCm(0, r, 40)).toBe(-40);
    // Deeper towards the middle, all the way
    const along = [0, 0.5, 1, 1.5, 2, 2.4].map((d) => craterCm(d * d, r, 40));
    for (let i = 1; i < along.length; i++) expect(along[i]).toBeGreaterThanOrEqual(along[i - 1]);
    // The wall: up at the rim, its top CRATER_LIP.share of the depth at CRATER_LIP.peak
    expect(craterCm(r * r * CRATER_LIP.peak, r, 40)).toBe(Math.trunc(40 * CRATER_LIP.share));
    expect(craterCm(r * r, r, 40)).toBeGreaterThan(0);
    expect(craterCm(r * r * CRATER_REACH_SQ, r, 40)).toBe(0);
    expect(craterCm(1e6, r, 40)).toBe(0);
    // No crater without a radius or a depth; whole centimetres always
    expect(craterCm(0, 0, 40)).toBe(0);
    expect(craterCm(0, r, 0)).toBe(0);
    for (let d2 = 0; d2 < 12; d2 += 0.37) expect(Number.isInteger(craterCm(d2, r, 37))).toBe(true);
  });

  it('heaps rubble: its top in the middle, flat there, running out to nothing at its radius', () => {
    expect(rubbleCm(0, 6, 180)).toBe(180);
    expect(rubbleCm(0.01, 6, 180)).toBe(179);
    expect(rubbleCm(18, 6, 180)).toBe(90);
    expect(rubbleCm(36, 6, 180)).toBe(0);
    expect(rubbleCm(35.9, 6, 180)).toBe(0);
    expect(rubbleCm(0, 6, 0)).toBe(0);
  });

  it('makes a heap lumpy by patches: one factor per patch, 0.7 to 1.15, the same for every point in it', () => {
    const seen = new Set<number>();
    for (let i = -20; i < 20; i++) {
      for (let j = -20; j < 20; j++) {
        const f = rubbleLump(i * RUBBLE_LUMP_M + 0.1, j * RUBBLE_LUMP_M + 0.1);
        expect(f).toBeGreaterThanOrEqual(0.7);
        expect(f).toBeLessThanOrEqual(1.15);
        expect(rubbleLump(i * RUBBLE_LUMP_M + 1.4, j * RUBBLE_LUMP_M + 1.5)).toBe(f);
        seen.add(Math.round(f * 100));
      }
    }
    expect(seen.size).toBeGreaterThan(30);
  });
});
