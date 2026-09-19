import { describe, expect, it } from 'vitest';
import { footprintInnerCount, footprintSampleOffsets } from '../../../utils/tower-footprint';
import { TOWER_TYPES } from '../../../configs/tower-types.config';
import { BRACE_MIN_RUN_M, plinthBraces } from './plinth-braces';
import { BRACE_TOP_Y, BRACE_WIDTH_M, plinthWallRadius, type PlinthBrace } from './plinth-geometry';

/** Footprint radius (archer, rocket) and plinth height of the tests */
const R = 3.6;
const HEIGHT = 1.5;

/** The probes of the footprint over the drop: where `air` holds */
const overhangWhere = (air: (x: number, z: number) => boolean) =>
  footprintSampleOffsets(R).flatMap(([x, z], index) => (air(x, z) ? [index] : []));

/** Horizontal point at `reach` along a corbel, `across` to the side of its middle */
const at = (brace: PlinthBrace, reach: number, across = 0) => {
  const side = brace.offset + across;
  return [
    Math.cos(brace.angle) * reach - Math.sin(brace.angle) * side,
    Math.sin(brace.angle) * reach + Math.cos(brace.angle) * side,
  ];
};
const run = (brace: PlinthBrace) => brace.topReach - brace.footReach;

describe('plinthBraces (E18, stone corbels under a plinth at a roof edge)', () => {
  it('puts none under a plinth that hangs over nothing: on the ground, on a roof away from its edge', () => {
    expect(plinthBraces(R, HEIGHT, [])).toEqual([]);
  });

  it('props a straight roof edge with two corbels square to it, from over the drop into the roof', () => {
    // The roof ends 2 m east of the tower
    const braces = plinthBraces(R, HEIGHT, overhangWhere((x) => x > 2));

    expect(braces).toHaveLength(2);
    for (const brace of braces) {
      // Straight out over the edge
      expect(Math.cos(brace.angle)).toBeCloseTo(1, 9);
      expect(at(brace, brace.topReach)[0]).toBeGreaterThan(2);
      expect(at(brace, brace.footReach)[0]).toBeLessThan(2);
    }
    // Side by side, apart, symmetric like the edge
    expect(braces[0].offset).toBeCloseTo(-braces[1].offset, 9);
    expect(Math.abs(braces[0].offset - braces[1].offset)).toBeGreaterThan(BRACE_WIDTH_M);
  });

  it('steps out from between the last probe on the roof and the first over the drop', () => {
    for (const brace of plinthBraces(R, HEIGHT, overhangWhere((x) => x > 2))) {
      // The roof's probes reach x = 1.8 (rim at 60 degrees), the first over the drop x = 3.12 (rim at 30 degrees)
      const [edgeX] = at(brace, brace.edgeReach);
      expect(edgeX).toBeGreaterThan(1.8);
      expect(edgeX).toBeLessThan(3.12);
      expect(brace.edgeReach).toBeGreaterThanOrEqual(brace.footReach);
      expect(brace.edgeReach).toBeLessThan(brace.topReach);
    }
  });

  it('keeps the front face of each corbel inside the wall under the rim, its outer corner close to it', () => {
    for (const brace of plinthBraces(R, HEIGHT, overhangWhere((x) => x > 2))) {
      // How far each front corner lies inside the wall: the flat face lies further in where the wall curves away
      const gaps = [-BRACE_WIDTH_M / 2, BRACE_WIDTH_M / 2].map((across) => {
        const [x, z] = at(brace, brace.topReach, across);
        return plinthWallRadius(R, HEIGHT, Math.atan2(z, x), BRACE_TOP_Y) - Math.hypot(x, z);
      });
      expect(Math.min(...gaps)).toBeGreaterThan(0);
      expect(Math.min(...gaps)).toBeLessThan(0.35);
    }
  });

  it('puts one or two corbels on a side, however long the stretch over the drop', () => {
    for (const edge of [0.5, 1, 2, 2.5]) {
      const braces = plinthBraces(R, HEIGHT, overhangWhere((x) => x > edge));
      expect(braces.length).toBeGreaterThanOrEqual(1);
      expect(braces.length).toBeLessThanOrEqual(2);
    }
  });

  it('reaches further in where the roof ends closer to the tower', () => {
    const far = plinthBraces(R, HEIGHT, overhangWhere((x) => x > 2));
    const near = plinthBraces(R, HEIGHT, overhangWhere((x) => x > 1));

    expect(near).toHaveLength(2);
    expect(Math.min(...near.map(run))).toBeGreaterThan(Math.max(...far.map(run)));
    for (const brace of near) expect(at(brace, brace.footReach)[0]).toBeLessThanOrEqual(1);
  });

  it('props a roof corner on both sides, every corbel from over the drop into the roof', () => {
    const air = (x: number, z: number) => x > 1.5 || z > 1.5;
    const braces = plinthBraces(R, HEIGHT, overhangWhere(air));

    expect(braces.length).toBeGreaterThanOrEqual(2);
    expect(braces.length).toBeLessThanOrEqual(4);
    for (const brace of braces) {
      const [tx, tz] = at(brace, brace.topReach);
      const [fx, fz] = at(brace, brace.footReach);
      expect(air(tx, tz)).toBe(true);
      expect(air(fx, fz)).toBe(false);
    }
  });

  it('props the whole rim of a plinth on a narrow top with four corbels, their backs inside it', () => {
    // Only the centre and the inner ring stand on something
    const braces = plinthBraces(R, HEIGHT, overhangWhere((x, z) => Math.hypot(x, z) > 2.5));

    expect(braces).toHaveLength(4);
    for (const brace of braces) {
      const [fx, fz] = at(brace, brace.footReach);
      expect(Math.hypot(fx, fz)).toBeLessThan(R / 2);
    }
  });

  it('props a stretch where the plinth barely overhangs the roof too, reaching further into the building (C10)', () => {
    // Only the rim probe straight east is over the drop, the roof ends 0.1 m before it
    const overhang = overhangWhere((x) => x > 3.5);
    expect(overhang).toHaveLength(1);
    const braces = plinthBraces(R, HEIGHT, overhang);

    expect(braces).toHaveLength(1);
    const [brace] = braces;
    expect(run(brace)).toBeCloseTo(BRACE_MIN_RUN_M, 9);
    expect(at(brace, brace.topReach)[0]).toBeGreaterThan(3.12);
    expect(at(brace, brace.footReach)[0]).toBeLessThan(3.12);
  });

  it('keeps every corbel it puts at least BRACE_MIN_RUN_M long', () => {
    for (const edge of [0.5, 1, 2, 2.5, 3]) {
      for (const brace of plinthBraces(R, HEIGHT, overhangWhere((x) => x > edge))) {
        expect(run(brace)).toBeGreaterThanOrEqual(BRACE_MIN_RUN_M);
      }
    }
  });

  it('puts none where the tower itself stands over the drop', () => {
    expect(plinthBraces(R, HEIGHT, overhangWhere((x) => x > -0.5))).toEqual([]);
  });

  describe('C10: every overhang the placement rules allow carries corbels', () => {
    /** The rim probes (counted along the outer ring) nearest to the front face of each corbel */
    const frontedProbes = (radius: number, braces: readonly PlinthBrace[]) => {
      const rim = footprintSampleOffsets(radius).slice(footprintInnerCount(radius));
      return new Set(braces.map((brace) => {
        const [x, z] = at(brace, brace.topReach);
        const distances = rim.map(([px, pz]) => Math.hypot(px - x, pz - z));
        return distances.indexOf(Math.min(...distances));
      }));
    };

    /**
     * Each stretch of rim probes over the drop has a corbel fronting on it or
     * on the rim probe either side of it.
     */
    const everyStretchBraced = (radius: number, height: number, overhang: readonly number[]) => {
      const inner = footprintInnerCount(radius);
      const count = footprintSampleOffsets(radius).length - inner;
      const over = new Set(overhang.map((index) => index - inner));
      const fronted = frontedProbes(radius, plinthBraces(radius, height, overhang));
      if (over.size === count) return fronted.size > 0;
      for (let first = 0; first < count; first++) {
        const before = (first + count - 1) % count;
        if (!over.has(first) || over.has(before)) continue;
        let after = first;
        let braced = fronted.has(before);
        while (over.has(after)) {
          braced = braced || fronted.has(after);
          after = (after + 1) % count;
        }
        if (!braced && !fronted.has(after)) return false;
      }
      return true;
    };

    const radii = [...new Set(Object.values(TOWER_TYPES).map((type) => type.footprintRadius))];

    // Exhaustive: 1.2 s on a desktop, 5.4 s on the Windows runner of release.yml
    it('at a straight edge or a corner, whatever its direction and wherever past the inner ring it runs', () => {
      for (const radius of radii) {
        const offsets = footprintSampleOffsets(radius);
        const inner = footprintInnerCount(radius);
        for (let degrees = 0; degrees < 360; degrees += 15) {
          for (let edge = 0; edge <= radius; edge += 0.1) {
            for (const corner of [false, true]) {
              const past = (x: number, z: number, turn: number) => {
                const angle = ((degrees + turn) * Math.PI) / 180;
                return x * Math.cos(angle) + z * Math.sin(angle) > edge;
              };
              const overhang = offsets.flatMap(([x, z], index) => {
                const over = past(x, z, 0) || (corner && past(x, z, 90));
                return over ? [index] : [];
              });
              if (overhang.length === 0 || overhang.some((index) => index < inner)) continue;
              for (const height of [0.5, 3]) {
                const label = `radius ${radius}, ${degrees} degrees, edge ${edge}, corner ${corner}`;
                expect(everyStretchBraced(radius, height, overhang), label).toBe(true);
              }
            }
          }
        }
      }
    }, 30_000);

    it('under a ragged rim: holes in the mesh, balconies, any stretches of the outer ring', () => {
      let seed = 7;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
      };
      for (const radius of radii) {
        const offsets = footprintSampleOffsets(radius);
        const inner = footprintInnerCount(radius);
        for (let n = 0; n < 300; n++) {
          const share = random();
          const overhang = offsets.flatMap((_, index) => (index >= inner && random() < share ? [index] : []));
          if (overhang.length === 0) continue;
          expect(everyStretchBraced(radius, 0.5, overhang), `radius ${radius}, overhang ${overhang.join(' ')}`).toBe(true);
        }
      }
    });
  });
});
