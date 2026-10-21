import { describe, expect, it } from 'vitest';
import type { CraterCut } from '../../../../map-ops/crater-water';
import { bedOf, chained, levelOf, type CraterWaterEntry } from './crater-water';

function entry(river: number, entry: number, exit: number, start: number | null, o: Partial<CraterCut> = {}): CraterWaterEntry {
  const cut: CraterCut = {
    river, entry, exit, levelIn: 10, levelOut: 9, lip: { x: 0, y: entry }, lipHalf: 6, floor: 2, level: 9,
    spill: { x: 0, y: exit }, downstream: true, volume: 1000, fillSeconds: 12, outflow: null, outflowMeets: null, ...o,
  };
  return { crater: { x: 0, y: (entry + exit) / 2, radius: (exit - entry) / 2 }, cut, kind: 'water', start };
}

describe('crater water over time', () => {
  it('fills a crater dug in the run from its floor, and stands one known before full', () => {
    const e = entry(0, 50, 80, 100);
    expect(levelOf(e, 100)).toBe(2);
    expect(levelOf(e, 106)).toBeGreaterThan(2);
    expect(levelOf(e, 106)).toBeLessThan(9);
    expect(levelOf(e, 112)).toBe(9);
    expect(levelOf({ ...e, start: null }, 0)).toBe(9);
  });

  it('runs the bed dry below it while it fills, and fills it again once it spills', () => {
    const e = entry(0, 50, 80, 100);
    const early = bedOf(e, 104);
    expect(early.dry).toBeCloseTo(12);
    expect(early.filled).toBe(0);
    expect(early.sink).toBeGreaterThan(0);
    // Spilled at 112: the water comes back down while the dry stretch went on
    const later = bedOf(e, 120);
    expect(later.filled).toBeGreaterThan(0);
    expect(later.filled).toBeLessThan(later.dry);
    // A crater known before leaves its bed as it is; one spilling elsewhere leaves it dry for good
    expect(bedOf({ ...e, start: null }, 0).sink).toBe(0);
    expect(bedOf({ ...e, start: null, cut: { ...e.cut, downstream: false } }, 0).sink).toBeGreaterThan(0);
    expect(bedOf({ ...e, cut: { ...e.cut, downstream: false } }, 1000).filled).toBe(0);
  });

  it('a crater below another gets water once the one above spills and the water came down to it', () => {
    const up = entry(0, 50, 80, 100);
    const down = entry(0, 120, 140, 101);
    const [a, b] = chained([down, up]).sort((p, q) => p.cut.entry - q.cut.entry);
    expect(a.start).toBe(100);
    // Full at 112, 40 m on at 2 m/s
    expect(b.start).toBeCloseTo(132);
    // Below one that spills elsewhere none comes
    const [, c] = chained([{ ...up, cut: { ...up.cut, downstream: false } }, down]).sort((p, q) => p.cut.entry - q.cut.entry);
    expect(c.start).toBe(Infinity);
    expect(levelOf(c, 1e6)).toBe(2);
    // Another river, or one known before, stays as it is
    expect(chained([up, entry(1, 120, 140, 101)])[1].start).toBe(101);
    expect(chained([up, { ...down, start: null }])[1].start).toBeNull();
  });
});
