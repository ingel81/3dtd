import { describe, expect, it } from 'vitest';
import { FootprintColumn, footprintSampleOffsets, resolveTowerFootprint } from './tower-footprint';
import { PLINTH_CONFIG } from '../configs/placement.config';

type Surface = (x: number, z: number) => number | null;

/** Radius of the footprint most tests use (archer, rocket) */
const R = 3.6;

/**
 * The columns resolveTowerFootprint gets for a footprint of `radius` at the
 * origin: the top surface from `top`, the ground from `ground` (the top where
 * not given, a surface without anything under it).
 */
const columns = (top: Surface, ground?: Surface, radius = R): (FootprintColumn | null)[] =>
  footprintSampleOffsets(radius).map(([x, z]) => {
    const topY = top(x, z);
    return topY === null ? null : { groundY: ground?.(x, z) ?? topY, topY };
  });

/** Highest and lowest top among the probes where `counts` holds. */
const extremes = (top: Surface, counts: (x: number, z: number) => boolean = () => true, radius = R) => {
  const ys = footprintSampleOffsets(radius)
    .filter(([x, z]) => counts(x, z))
    .map(([x, z]) => top(x, z)!);
  return { max: Math.max(...ys), min: Math.min(...ys) };
};

/** A parked car, 1.5 m high, on the box x0..x1, z0..z1 */
const car = (x0: number, x1: number, z0: number, z1: number) => (x: number, z: number) =>
  x >= x0 && x <= x1 && z >= z0 && z <= z1;

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
    expect(resolveTowerFootprint(12, R, columns(() => 12))).toEqual({ footY: 12, plinthHeight: 0 });
  });

  it('ignores unevenness below the threshold, keeping the cursor surface', () => {
    const step = PLINTH_CONFIG.MIN_UNEVENNESS * 0.9;
    const top = (x: number) => 12 + (x > 0 ? step / 2 : -step / 2);
    expect(resolveTowerFootprint(12, R, columns(top))).toEqual({ footY: 12, plinthHeight: 0 });
  });

  describe('on the ground', () => {
    it('stands on the highest point of a slope and reaches down to the lowest', () => {
      // 30 % across the diagonal, and 40° down to the north
      const diagonal = (x: number, z: number) => 10 + (0.3 * (x + z)) / Math.SQRT2;
      const steep = (_x: number, z: number) => 10 - 0.84 * z;

      for (const top of [diagonal, steep]) {
        const { max, min } = extremes(top);
        const footprint = resolveTowerFootprint(10, R, columns(top));
        expect(footprint.footY).toBeCloseTo(max, 9);
        expect(footprint.plinthHeight).toBeCloseTo(max - min, 9);
      }
    });

    it('does not climb onto a car beside the tower', () => {
      const onCar = car(2.2, 4.4, -2.3, 2.3);
      const top = (x: number, z: number) => (onCar(x, z) ? 13.5 : 12);
      expect(resolveTowerFootprint(12, R, columns(top))).toEqual({ footY: 12, plinthHeight: 0 });
    });

    it('nor onto a car the inner ring reaches', () => {
      const onCar = car(1, 3, -1.2, 1.2);
      const top = (x: number, z: number) => (onCar(x, z) ? 13.5 : 12);
      expect(resolveTowerFootprint(12, R, columns(top))).toEqual({ footY: 12, plinthHeight: 0 });
    });

    it('nor onto a hedge, a wall or a low crown along one side', () => {
      for (const height of [1.2, 4]) {
        const top = (_x: number, z: number) => (z >= 2 ? 12 + height : 12);
        expect(resolveTowerFootprint(12, R, columns(top))).toEqual({ footY: 12, plinthHeight: 0 });
      }
    });

    it('nor next to the Research Center, whose probes lie farther apart', () => {
      const onCar = car(8, 10.2, -2.3, 2.3);
      const top = (x: number, z: number) => (onCar(x, z) ? 13.5 : 12);
      expect(resolveTowerFootprint(12, 10, columns(top, undefined, 10))).toEqual({ footY: 12, plinthHeight: 0 });
    });

    it('climbs the slope around a car, but not the car, uphill or across', () => {
      const slope = (x: number) => 10 + 0.2 * x;
      for (const onCar of [car(2.2, 4.4, -2.3, 2.3), car(-2.3, 2.3, 2.2, 4.4)]) {
        const top = (x: number, z: number) => slope(x) + (onCar(x, z) ? 1.5 : 0);
        const { max, min } = extremes(top, (x, z) => !onCar(x, z));

        const footprint = resolveTowerFootprint(10, R, columns(top));
        expect(footprint.footY).toBeCloseTo(max, 9);
        expect(footprint.plinthHeight).toBeCloseTo(max - min, 9);
      }
    });

    it('still climbs a step up to MAX_STEP, a kerb or a low terrace', () => {
      const step = PLINTH_CONFIG.MAX_STEP - 0.1;
      const top = (x: number) => (x > 1 ? 12 + step : 12);
      const footprint = resolveTowerFootprint(12, R, columns(top));
      expect(footprint.footY).toBeCloseTo(12 + step, 9);
      expect(footprint.plinthHeight).toBeCloseTo(step, 9);
    });

    it('climbs a pitched roof also where its column shows no ground below', () => {
      // Ridge 2 m east of the cursor, 45° either side
      const top = (x: number) => 22 - Math.abs(x - 2);
      const { max, min } = extremes(top);
      const footprint = resolveTowerFootprint(20, R, columns(top));
      expect(footprint.footY).toBeCloseTo(max, 9);
      expect(footprint.plinthHeight).toBeCloseTo(max - min, 9);
    });

    it('stands on the cursor surface even when every probe around is lower', () => {
      // The cursor on something small, a car roof or a crest: its surface is what the player points at
      const top = (x: number, z: number) => (x === 0 && z === 0 ? 13.5 : 12);
      expect(resolveTowerFootprint(13.5, R, columns(top))).toEqual({ footY: 13.5, plinthHeight: 1.5 });
    });

    it('reaches down past a wall or an edge, but not past a drop far below', () => {
      expect(resolveTowerFootprint(50, R, columns((x) => (x > 1 ? 49 : 50)))).toEqual({ footY: 50, plinthHeight: 1 });
      const street = 50 - PLINTH_CONFIG.MAX_DROP - 0.1;
      expect(resolveTowerFootprint(50, R, columns((x) => (x > 1 ? street : 50)))).toEqual({
        footY: 50,
        plinthHeight: 0,
      });
    });

    it('skips probes that hit nothing', () => {
      const top = (x: number) => (x < 0 ? null : x > 1 ? 5.4 : 5);
      const footprint = resolveTowerFootprint(5, R, columns(top));
      expect(footprint.footY).toBeCloseTo(5.4, 9);
      expect(footprint.plinthHeight).toBeCloseTo(0.4, 9);
    });
  });

  describe('on a roof', () => {
    /** The street under the building */
    const street = () => 5;

    it('climbs what rises from the roof, which it would not on the ground', () => {
      const top = (x: number) => (x > 1 ? 21.5 : 20);
      expect(resolveTowerFootprint(20, R, columns(top, street))).toEqual({ footY: 21.5, plinthHeight: 1.5 });
      expect(resolveTowerFootprint(20, R, columns(top))).toEqual({ footY: 20, plinthHeight: 0 });
    });

    it('stands on the ridge of a pitched roof and reaches down to the eave', () => {
      const top = (x: number) => 22 - Math.abs(x - 2);
      const { max, min } = extremes(top);
      const footprint = resolveTowerFootprint(20, R, columns(top, street));
      expect(footprint.footY).toBeCloseTo(max, 9);
      expect(footprint.plinthHeight).toBeCloseTo(max - min, 9);
    });

    it('does not climb a facade far above the cursor surface', () => {
      const facade = 12 + PLINTH_CONFIG.MAX_RISE + 0.1;
      const ground = () => 0;
      expect(resolveTowerFootprint(12, R, columns((x) => (x > 1 ? facade : 12), ground))).toEqual({
        footY: 12,
        plinthHeight: 0,
      });
      expect(resolveTowerFootprint(12, R, columns((x) => (x > 1 ? 13 : 12), ground))).toEqual({
        footY: 13,
        plinthHeight: 1,
      });
    });
  });
});
