import { describe, expect, it, vi } from 'vitest';
import {
  FootprintColumn,
  decideTowerFootprint,
  footprintInnerCount,
  footprintSampleOffsets,
  footprintSurroundingOffsets,
  levelWithCursor,
  plinthOverhang,
  resolveTowerFootprint,
  sameFootprint,
} from './tower-footprint';
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

/**
 * The surroundings probes resolveTowerFootprint may ask for, over the same
 * surfaces as `columns`; a mock, to see whether it asked.
 */
const surroundings = (top: Surface, ground?: Surface, radius = R) =>
  vi.fn(() =>
    footprintSurroundingOffsets(radius).map(([x, z]): FootprintColumn | null => {
      const topY = top(x, z);
      return topY === null ? null : { groundY: ground?.(x, z) ?? topY, topY };
    }),
  );

/** Highest and lowest top among the probes where `counts` holds. */
const extremes = (top: Surface, counts: (x: number, z: number) => boolean = () => true, radius = R) => {
  const ys = footprintSampleOffsets(radius)
    .filter(([x, z]) => counts(x, z))
    .map(([x, z]) => top(x, z)!);
  return { max: Math.max(...ys), min: Math.min(...ys) };
};

/** Indices of the probes of the footprint of `radius` where `counts` holds */
const probesWhere = (counts: (x: number, z: number) => boolean, radius = R) =>
  footprintSampleOffsets(radius).flatMap(([x, z], index) => (counts(x, z) ? [index] : []));

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

describe('footprintInnerCount', () => {
  it('counts the centre and the inner ring, the probes before the outer ring', () => {
    expect(footprintInnerCount(3.6)).toBe(1 + 6);
    expect(footprintInnerCount(10)).toBe(1 + 16);
    const inner = footprintSampleOffsets(10).slice(1, footprintInnerCount(10));
    expect(inner.every(([x, z]) => Math.abs(Math.hypot(x, z) - 5) < 1e-9)).toBe(true);
  });
});

describe('footprintSurroundingOffsets', () => {
  it('probes eight directions ROOF_PROBE_REACH beyond the footprint, each opposite the one four on', () => {
    const offsets = footprintSurroundingOffsets(R);
    expect(offsets).toHaveLength(8);
    offsets.forEach(([x, z], k) => {
      expect(Math.hypot(x, z)).toBeCloseTo(R + PLINTH_CONFIG.ROOF_PROBE_REACH, 9);
      const [ox, oz] = offsets[(k + 4) % 8];
      expect(x + ox).toBeCloseTo(0, 9);
      expect(z + oz).toBeCloseTo(0, 9);
    });
    expect(footprintSurroundingOffsets(R)).toBe(offsets);
  });
});

describe('levelWithCursor', () => {
  it('holds while every probe tops out within MIN_UNEVENNESS of the cursor surface', () => {
    expect(levelWithCursor(12, [{ groundY: 12, topY: 12.1 }, null, { groundY: 11.95, topY: 11.95 }])).toBe(true);
    expect(levelWithCursor(12, [])).toBe(true);
    expect(levelWithCursor(12, [{ groundY: 12, topY: 12 + PLINTH_CONFIG.MIN_UNEVENNESS * 1.1 }])).toBe(false);
    expect(levelWithCursor(12, [{ groundY: 12, topY: 12.15 }, { groundY: 11.9, topY: 11.9 }])).toBe(false);
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

    it('reaches down a step within MAX_DROP, but ends above a deeper one', () => {
      expect(resolveTowerFootprint(50, R, columns((x) => (x > 2 ? 49 : 50)))).toEqual({ footY: 50, plinthHeight: 1 });
      const lower = 50 - 2 * PLINTH_CONFIG.MAX_DROP;
      expect(resolveTowerFootprint(50, R, columns((x) => (x > 2 ? lower : 50)))).toEqual({
        footY: 50,
        plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT,
        overhang: probesWhere((x) => x > 2),
      });
    });

    it('counts probes that hit nothing as a drop', () => {
      const top = (x: number) => (x < -2 ? null : x > 1 ? 5.4 : 5);
      expect(resolveTowerFootprint(5, R, columns(top))).toEqual({
        footY: 5.4,
        plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT,
        overhang: probesWhere((x) => x < -2),
      });
    });

    it('does not climb a car beside the sidewalk, with the street level around', () => {
      // The cursor on the sidewalk, a kerb above the street that starts 1.5 m east; a car on the street
      const onCar = car(2.2, 4.4, -2.3, 2.3);
      const top = (x: number, z: number) => (x < 1.5 ? 12.15 : onCar(x, z) ? 13.5 : 12);
      const around = surroundings(top);
      expect(resolveTowerFootprint(12.15, R, columns(top), around)).toEqual({ footY: 12.15, plinthHeight: 0 });
      // The car makes the rules disagree: the ground around was asked, and it is no lower
      expect(around).toHaveBeenCalledTimes(1);
    });

    it('stays on the ground on a hillside, where the ground falls away on one side only', () => {
      // 30 % up to the east, the ground 3.5 m lower beyond the footprint to the west; a car uphill
      const onCar = car(2.2, 4.4, -2.3, 2.3);
      const top = (x: number, z: number) => 10 + 0.3 * x + (onCar(x, z) ? 1.5 : 0);
      const { max, min } = extremes(top, (x, z) => !onCar(x, z));
      const around = surroundings(top);

      const footprint = resolveTowerFootprint(10, R, columns(top), around);
      expect(footprint.footY).toBeCloseTo(max, 9);
      expect(footprint.plinthHeight).toBeCloseTo(max - min, 9);
      expect(around).toHaveBeenCalledTimes(1);
    });

    it('asks for the surroundings only when roof and ground rule give different feet', () => {
      const around = surroundings(() => 0);
      resolveTowerFootprint(12, R, columns(() => 12), around);
      resolveTowerFootprint(10, R, columns((x) => 10 + 0.3 * x), around);
      // Ground under the cursor's own column already says roof
      resolveTowerFootprint(20, R, columns((x) => (x > 1 ? 21.5 : 20), () => 5), around);
      expect(around).not.toHaveBeenCalled();
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

    describe('where the photogrammetry shows no ground under it', () => {
      /** A building 16 m across around the tower with `roof` on top, the street at 0 m around it */
      const building = (roof: (x: number, z: number) => number) => (x: number, z: number) =>
        Math.abs(x) < 8 && Math.abs(z) < 8 ? roof(x, z) : 0;

      it('stands on the higher part of a stepped roof, by the street on both sides', () => {
        const top = building((x) => (x > 1 ? 12 : 10));
        expect(resolveTowerFootprint(10, R, columns(top), surroundings(top))).toEqual({ footY: 12, plinthHeight: 2 });
        // Its own column alone does not tell, the ground rule would keep it on the lower part
        expect(resolveTowerFootprint(10, R, columns(top))).toEqual({ footY: 10, plinthHeight: 0 });
      });

      it('stands on the ridge of a gable roof with the cursor just below it', () => {
        // Ridge 10 m high, 0.9 m from the cursor and turned 30° off the x axis, 56° down to the
        // eaves at 2.5 m; the house 10 m deep and 16 m long
        const across = (x: number, z: number) => x * Math.cos(Math.PI / 6) + z * Math.sin(Math.PI / 6) - 0.9;
        const along = (x: number, z: number) => -x * Math.sin(Math.PI / 6) + z * Math.cos(Math.PI / 6);
        const top = (x: number, z: number) =>
          Math.abs(across(x, z)) <= 5 && Math.abs(along(x, z)) < 8 ? 10 - 1.5 * Math.abs(across(x, z)) : 0;
        const { max, min } = extremes(top);

        const decision = decideTowerFootprint(top(0, 0), R, columns(top), surroundings(top));
        expect(decision.rule).toBe('roof-surroundings');
        expect(decision.footprint.footY).toBeCloseTo(max, 9);
        expect(decision.footprint.plinthHeight).toBeCloseTo(max - min, 9);
        // The ridge caps the slope the ground rule reads, it would leave the tower in the roof
        expect(decision.groundTop).toBeLessThan(max);
      });
    });
  });

  describe('decideTowerFootprint', () => {
    it('names the rule the foot comes from', () => {
      const street = () => 5;
      const step = (x: number) => (x > 1 ? 21.5 : 20);
      const inBuilding = (x: number, z: number) => (Math.abs(x) < 8 && Math.abs(z) < 8 ? step(x) : 5);
      const onCar = car(2.2, 4.4, -2.3, 2.3);
      const byCar = (x: number, z: number) => (onCar(x, z) ? 13.5 : 12);

      expect(decideTowerFootprint(12, R, columns(() => 12)).rule).toBe('even');
      expect(decideTowerFootprint(10, R, columns((x) => 10 + 0.3 * x)).rule).toBe('agree');
      expect(decideTowerFootprint(20, R, columns(step, street)).rule).toBe('roof-column');
      expect(decideTowerFootprint(20, R, columns(inBuilding), surroundings(inBuilding)).rule).toBe('roof-surroundings');
      const onGround = decideTowerFootprint(12, R, columns(byCar), surroundings(byCar));
      expect(onGround).toMatchObject({ rule: 'ground', bottom: 12, groundTop: 12, roofTop: 13.5 });
      expect(onGround.surroundings).toHaveLength(8);
    });
  });

  describe('overhang (E18, braces under a plinth at a roof edge)', () => {
    /** The street far below a roof at 50 m */
    const deepStreet = 10;

    it('names the probes past a roof edge deeper than MAX_DROP, where the plinth hangs over the street', () => {
      // Roof at 50 m, 1 m higher west of x = -1, its edge 2 m east of the tower
      const top = (x: number) => (x > 2 ? deepStreet : x < -1 ? 51 : 50);
      const footprint = resolveTowerFootprint(50, R, columns(top, () => deepStreet));

      expect(footprint).toEqual({ footY: 51, plinthHeight: 1, overhang: probesWhere((x) => x > 2) });
      // The rim over the street: the outer ring at 0 and 30 degrees either side
      expect(footprint.overhang).toHaveLength(3);
    });

    it('names the probes that hit nothing as well', () => {
      const top = (x: number) => (x > 2 ? null : x < -1 ? 51 : 50);
      expect(resolveTowerFootprint(50, R, columns(top, () => deepStreet)).overhang).toEqual(probesWhere((x) => x > 2));
    });

    it('names none where the plinth reaches down to the street, within MAX_DROP', () => {
      const street = 50 - PLINTH_CONFIG.MAX_DROP + 1;
      const top = (x: number) => (x > 2 ? street : 50);
      expect(resolveTowerFootprint(50, R, columns(top, () => street))).toEqual({ footY: 50, plinthHeight: 50 - street });
    });

    it('puts a slab on a flat roof at its edge to carry the braces, and nothing in its middle', () => {
      const edge = (x: number) => (x > 2 ? deepStreet : 50);
      expect(resolveTowerFootprint(50, R, columns(edge, () => deepStreet))).toEqual({
        footY: 50,
        plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT,
        overhang: probesWhere((x) => x > 2),
      });
      expect(resolveTowerFootprint(50, R, columns(() => 50, () => deepStreet))).toEqual({ footY: 50, plinthHeight: 0 });
    });

    it('stands the slab on the highest probe of a roof that is even within MIN_UNEVENNESS', () => {
      const top = (x: number, z: number) => (x > 2 ? deepStreet : z > 1 ? 50.1 : 50);
      expect(resolveTowerFootprint(50, R, columns(top, () => deepStreet))).toMatchObject({
        footY: 50.1,
        plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT,
      });
    });

    describe('C10: the plinth ends within MAX_DROP at an edge, whatever lies below', () => {
      it('above a lower part of a stepped building, it hangs over the step on braces', () => {
        // Playtest 12: the lower part 12 m down drew the plinth down the facade
        const top = (x: number) => (x > 2 ? 38 : 50);
        expect(resolveTowerFootprint(50, R, columns(top, () => 5))).toEqual({
          footY: 50,
          plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT,
          overhang: probesWhere((x) => x > 2),
        });
      });

      it('at an edge the photogrammetry melts into a bevel, it reaches the bevel but not the step below', () => {
        // 2.8 m down over 1.3 m, then the lower part 12 m down
        const top = (x: number) => (x < 2 ? 50 : x < 3.3 ? 50 - (2.8 * (x - 2)) / 1.3 : 38);
        const footprint = resolveTowerFootprint(50, R, columns(top, () => 5));
        expect(footprint.footY).toBe(50);
        expect(footprint.plinthHeight).toBeCloseTo(50 - top(R * Math.cos(Math.PI / 6)), 9);
        expect(footprint.plinthHeight).toBeLessThanOrEqual(PLINTH_CONFIG.MAX_DROP);
        expect(footprint.overhang).toEqual(probesWhere((x) => x >= 3.3));
      });

      it('on a balcony or canopy within MAX_DROP it stands, past it and below a deeper one it hangs', () => {
        const withBalcony = (depth: number) => (x: number) => (x > 3.3 ? 35 : x > 2 ? 50 - depth : 50);
        expect(resolveTowerFootprint(50, R, columns(withBalcony(2.5), () => 5))).toEqual({
          footY: 50,
          plinthHeight: 2.5,
          overhang: probesWhere((x) => x > 3.3),
        });
        expect(resolveTowerFootprint(50, R, columns(withBalcony(5), () => 5))).toEqual({
          footY: 50,
          plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT,
          overhang: probesWhere((x) => x > 2),
        });
      });

      it('on a terrace, it reaches down a low wall to the ground below and hangs over a high one', () => {
        const terrace = (height: number) => (x: number) => (x > 2 ? 12 - height : 12);
        expect(resolveTowerFootprint(12, R, columns(terrace(2)))).toEqual({ footY: 12, plinthHeight: 2 });
        expect(resolveTowerFootprint(12, R, columns(terrace(5)))).toEqual({
          footY: 12,
          plinthHeight: PLINTH_CONFIG.MIN_BRACED_HEIGHT,
          overhang: probesWhere((x) => x > 2),
        });
      });

      it('on a hillside, it follows the slope further down than MAX_DROP', () => {
        const hill = (x: number, z: number) => 10 - (x + z) / Math.SQRT2;
        const { max, min } = extremes(hill);
        expect(max - min).toBeGreaterThan(2 * PLINTH_CONFIG.MAX_DROP);

        const footprint = resolveTowerFootprint(10, R, columns(hill));
        expect(footprint.footY).toBeCloseTo(max, 9);
        expect(footprint.plinthHeight).toBeCloseTo(max - min, 9);
        expect(footprint.overhang).toBeUndefined();
      });

      it('on a hillside ending in a retaining wall, it follows the slope and hangs over the wall', () => {
        const hill = (x: number) => 10 - 0.3 * x - (x > 2 ? 6 : 0);
        const { max, min } = extremes(hill, (x) => x <= 2);
        expect(resolveTowerFootprint(10, R, columns(hill))).toEqual({
          footY: max,
          plinthHeight: max - min,
          overhang: probesWhere((x) => x > 2),
        });
      });
    });

    it('names none on a slope on the ground or on a stepped roof', () => {
      const slope = resolveTowerFootprint(10, R, columns((x) => 10 + 0.3 * x));
      expect(slope.plinthHeight).toBeGreaterThan(0);
      expect(slope.overhang).toBeUndefined();
      const stepped = resolveTowerFootprint(20, R, columns((x) => (x > 1 ? 21.5 : 20), () => 5));
      expect(stepped).toEqual({ footY: 21.5, plinthHeight: 1.5 });
    });
  });
});

describe('plinthOverhang', () => {
  it('lists the columns that top out below the plinth or hit nothing, by index', () => {
    const columns = [{ groundY: 10, topY: 10 }, null, { groundY: 2, topY: 9.9 }, { groundY: 2, topY: 12 }];
    expect(plinthOverhang(10, columns)).toEqual([1, 2]);
    expect(plinthOverhang(10, [])).toEqual([]);
  });
});

describe('sameFootprint', () => {
  it('compares foot, plinth and overhang, no overhang the same as an empty one', () => {
    expect(sameFootprint({ footY: 1, plinthHeight: 1 }, { footY: 1, plinthHeight: 1, overhang: [] })).toBe(true);
    expect(sameFootprint({ footY: 1, plinthHeight: 1, overhang: [3] }, { footY: 1, plinthHeight: 1, overhang: [3] })).toBe(true);
    expect(sameFootprint({ footY: 1, plinthHeight: 1, overhang: [3] }, { footY: 1, plinthHeight: 1, overhang: [4] })).toBe(false);
    expect(sameFootprint({ footY: 1, plinthHeight: 1 }, { footY: 1, plinthHeight: 2 })).toBe(false);
    expect(sameFootprint({ footY: 1, plinthHeight: 1 }, { footY: 2, plinthHeight: 1 })).toBe(false);
  });
});
