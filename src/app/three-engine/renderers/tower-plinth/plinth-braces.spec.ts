import { describe, expect, it } from 'vitest';
import { footprintSampleOffsets } from '../../../utils/tower-footprint';
import { BRACE_MIN_RUN_M, plinthBraces } from './plinth-braces';
import { BRACE_TOP_Y, plinthWallRadius, type PlinthBrace } from './plinth-geometry';

/** Footprint radius (archer, rocket) and plinth height of the tests */
const R = 3.6;
const HEIGHT = 1.5;

/** The probes of the footprint over the drop: where `air` holds */
const overhangWhere = (air: (x: number, z: number) => boolean) =>
  footprintSampleOffsets(R).flatMap(([x, z], index) => (air(x, z) ? [index] : []));

/** Where a brace starts under the rim and where its foot ends, horizontally */
const topOf = (brace: PlinthBrace) => [Math.cos(brace.angle) * brace.topReach, Math.sin(brace.angle) * brace.topReach];
const footOf = (brace: PlinthBrace) => [Math.cos(brace.angle) * brace.footReach, Math.sin(brace.angle) * brace.footReach];
const run = (brace: PlinthBrace) => brace.topReach - brace.footReach;

describe('plinthBraces (E18, braces under a plinth at a roof edge)', () => {
  it('puts none under a plinth that hangs over nothing: on the ground, on a roof away from its edge', () => {
    expect(plinthBraces(R, HEIGHT, [])).toEqual([]);
  });

  it('props the stretch of the rim over a straight roof edge, from over the drop to inside the roof', () => {
    // The roof ends 2 m east of the tower
    const braces = plinthBraces(R, HEIGHT, overhangWhere((x) => x > 2));

    // Three rim probes over the street, 90 degrees of rim: two braces
    expect(braces).toHaveLength(2);
    for (const brace of braces) {
      expect(topOf(brace)[0]).toBeGreaterThan(2);
      expect(footOf(brace)[0]).toBeLessThan(2);
      expect(Math.cos(brace.angle)).toBeGreaterThan(0.9);
    }
    // Symmetric about the x axis, like the edge
    expect(Math.sin(braces[0].angle)).toBeCloseTo(-Math.sin(braces[1].angle), 9);
    expect(braces[0].footReach).toBeCloseTo(braces[1].footReach, 9);
  });

  it('starts each brace just inside the wall under the rim', () => {
    for (const brace of plinthBraces(R, HEIGHT, overhangWhere((x) => x > 2))) {
      const wall = plinthWallRadius(R, HEIGHT, brace.angle, BRACE_TOP_Y);
      expect(brace.topReach).toBeLessThan(wall);
      expect(brace.topReach).toBeGreaterThan(wall - 0.5);
    }
  });

  it('reaches further in where the roof ends closer to the tower', () => {
    const far = plinthBraces(R, HEIGHT, overhangWhere((x) => x > 2));
    const near = plinthBraces(R, HEIGHT, overhangWhere((x) => x > 1));

    // Five rim probes over the street, 150 degrees of rim: four braces
    expect(near).toHaveLength(4);
    expect(Math.min(...near.map(run))).toBeGreaterThan(Math.max(...far.map(run)));
    for (const brace of near) expect(footOf(brace)[0]).toBeLessThanOrEqual(1);
  });

  it('props a roof corner from both sides, every foot inside the corner', () => {
    const air = (x: number, z: number) => x > 1.5 || z > 1.5;
    const braces = plinthBraces(R, HEIGHT, overhangWhere(air));

    expect(braces.length).toBeGreaterThanOrEqual(4);
    for (const brace of braces) {
      const [tx, tz] = topOf(brace);
      const [fx, fz] = footOf(brace);
      expect(air(tx, tz)).toBe(true);
      expect(air(fx, fz)).toBe(false);
    }
  });

  it('props the whole rim of a plinth on a narrow top, the feet inside it', () => {
    // Only the centre and the inner ring stand on something
    const braces = plinthBraces(R, HEIGHT, overhangWhere((x, z) => Math.hypot(x, z) > 2.5));

    expect(braces).toHaveLength(10);
    const step = (2 * Math.PI) / braces.length;
    braces.forEach((brace, i) => {
      expect(brace.angle - braces[0].angle).toBeCloseTo(i * step, 9);
      expect(brace.footReach).toBeLessThan(R / 2);
    });
  });

  it('leaves out a stretch where the plinth barely overhangs the roof', () => {
    // Only the rim probe straight east is over the drop, the roof ends 0.1 m before it
    const overhang = overhangWhere((x) => x > 3.5);
    expect(overhang).toHaveLength(1);
    expect(plinthBraces(R, HEIGHT, overhang)).toEqual([]);
  });

  it('keeps every brace it puts at least BRACE_MIN_RUN_M long', () => {
    for (const edge of [0.5, 1, 2, 2.5, 3]) {
      for (const brace of plinthBraces(R, HEIGHT, overhangWhere((x) => x > edge))) {
        expect(run(brace)).toBeGreaterThanOrEqual(BRACE_MIN_RUN_M);
      }
    }
  });

  it('puts none where the tower itself stands over the drop', () => {
    expect(plinthBraces(R, HEIGHT, overhangWhere((x) => x > -0.5))).toEqual([]);
  });
});
