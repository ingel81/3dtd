import { describe, expect, it } from 'vitest';
import { footprintSampleOffsets, resolveTowerFootprint } from './tower-footprint';
import { PLINTH_CONFIG } from '../configs/placement.config';

describe('footprintSampleOffsets', () => {
  it('probes the centre, a ring at half the radius and one at the radius', () => {
    const offsets = footprintSampleOffsets(3.6);
    const distances = offsets.map(([dx, dz]) => Math.hypot(dx, dz));

    expect(offsets).toHaveLength(1 + 6 + 12);
    expect(distances[0]).toBe(0);
    expect(distances.slice(1, 7).every((d) => Math.abs(d - 1.8) < 1e-9)).toBe(true);
    expect(distances.slice(7).every((d) => Math.abs(d - 3.6) < 1e-9)).toBe(true);
  });

  it('keeps the probes on a wide footprint at most 2 m apart', () => {
    const offsets = footprintSampleOffsets(10);
    const outer = offsets.filter(([dx, dz]) => Math.abs(Math.hypot(dx, dz) - 10) < 1e-9);

    expect(outer.length).toBeGreaterThanOrEqual(Math.ceil((2 * Math.PI * 10) / 2));
    const [a, b] = outer;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThanOrEqual(2);
  });

  it('hands out the same list for the same radius', () => {
    expect(footprintSampleOffsets(4)).toBe(footprintSampleOffsets(4));
  });
});

describe('resolveTowerFootprint', () => {
  it('keeps the cursor surface and builds no plinth on even ground', () => {
    expect(resolveTowerFootprint(12, [12, 12, 12])).toEqual({ footY: 12, plinthHeight: 0 });
  });

  it('ignores unevenness below the threshold, keeping the cursor surface', () => {
    const step = PLINTH_CONFIG.MIN_UNEVENNESS * 0.9;
    expect(resolveTowerFootprint(12, [12 + step / 2, 12 - step / 2])).toEqual({ footY: 12, plinthHeight: 0 });
  });

  it('stands on the highest point and reaches down to the lowest on a pitched roof', () => {
    // 45° roof, cursor on the slope: ridge 2 m up, eave 1.5 m down.
    const footprint = resolveTowerFootprint(20, [20, 21, 22, 19.5, 18.5]);

    expect(footprint.footY).toBe(22);
    expect(footprint.plinthHeight).toBeCloseTo(3.5, 9);
  });

  it('counts the cursor surface itself, also when every probe is lower', () => {
    expect(resolveTowerFootprint(20, [19, 18])).toEqual({ footY: 20, plinthHeight: 2 });
  });

  it('does not climb a facade or crown far above the cursor surface', () => {
    const facade = 12 + PLINTH_CONFIG.MAX_RISE + 0.1;
    expect(resolveTowerFootprint(12, [12, facade, facade])).toEqual({ footY: 12, plinthHeight: 0 });
    expect(resolveTowerFootprint(12, [12, facade, 13])).toEqual({ footY: 13, plinthHeight: 1 });
  });

  it('does not reach down past an edge far below the cursor surface', () => {
    const street = 50 - PLINTH_CONFIG.MAX_DROP - 0.1;
    expect(resolveTowerFootprint(50, [50, street])).toEqual({ footY: 50, plinthHeight: 0 });
    expect(resolveTowerFootprint(50, [49, street])).toEqual({ footY: 50, plinthHeight: 1 });
  });

  it('skips probes that hit nothing', () => {
    expect(resolveTowerFootprint(5, [null, 6, null])).toEqual({ footY: 6, plinthHeight: 1 });
  });
});
