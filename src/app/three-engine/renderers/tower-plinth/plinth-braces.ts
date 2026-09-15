import { footprintInnerCount, footprintSampleOffsets } from '../../../utils/tower-footprint';
import { BRACE_TOP_CUT_M, BRACE_TOP_Y, PLINTH_RIM_M, plinthWallRadius, type PlinthBrace } from './plinth-geometry';

/** Braces along an overhanging stretch of the rim about this far apart (m). */
const BRACE_SPACING_M = 2.5;
/** A brace's outer top edge this far (m) inside the wall, which hides the joint. */
const BRACE_RIM_INSET_M = 0.2;
/**
 * Its foot this far (m) inside the edge of the roof as the probes know it,
 * so it ends in the building and not in front of its facade.
 */
const BRACE_FOOT_INSET_M = 0.3;
/**
 * Shortest brace (m, horizontal from the foot to the outer top edge): the
 * top cut plus 0.4 m. Shorter, and the plinth barely overhangs the roof there.
 */
export const BRACE_MIN_RUN_M = BRACE_TOP_CUT_M + 0.4;

type Point = readonly [number, number];

/**
 * The braces under a plinth that hangs over a drop at the footprint probes
 * `overhang` (indices into footprintSampleOffsets(footprintRadius), from
 * TowerFootprint.overhang). None without overhang: on the ground, on a roof
 * away from its edge.
 *
 * Only the probe data, no raycasts: where probes on the footprint's rim hang
 * over the drop, braces go along that stretch of the rim about
 * BRACE_SPACING_M apart, each pointing straight out from the axis like the
 * corbels under a round turret. A brace reaches from just inside the wall
 * under the rim down and inwards to the edge of the roof: the convex hull of
 * the probes with ground under the plinth, which is roof as far as the
 * probes know. Its foot ends BRACE_FOOT_INSET_M inside that hull; the real
 * edge lies between the hull and the first probe over the drop, so the
 * brace enters the facade before its foot. None where the tower's axis is
 * not over that roof, and none where the plinth overhangs the hull by less
 * than BRACE_MIN_RUN_M.
 */
export function plinthBraces(footprintRadius: number, height: number, overhang: readonly number[]): PlinthBrace[] {
  if (overhang.length === 0) return [];
  const offsets = footprintSampleOffsets(footprintRadius);
  const innerCount = footprintInnerCount(footprintRadius);
  const over = new Set(overhang);
  const roof = convexHull(offsets.filter((_, index) => !over.has(index)));
  if (roof.length < 3 || !containsOrigin(roof)) return [];

  // The outer ring runs counter-clockwise around the rim from angle 0
  const ringCount = offsets.length - innerCount;
  const step = (2 * Math.PI) / ringCount;
  const braces: PlinthBrace[] = [];
  for (const run of overhangRuns(ringCount, (k) => over.has(innerCount + k))) {
    const [x, z] = offsets[innerCount + run.first];
    const start = Math.atan2(z, x) - step / 2;
    const span = run.length * step;
    const count = Math.max(1, Math.round((span * (footprintRadius + PLINTH_RIM_M)) / BRACE_SPACING_M));
    for (let j = 0; j < count; j++) {
      const angle = start + ((j + 0.5) * span) / count;
      const topReach = plinthWallRadius(footprintRadius, height, angle, BRACE_TOP_Y) - BRACE_RIM_INSET_M;
      const footReach = Math.max(0, exitDistance(roof, Math.cos(angle), Math.sin(angle)) - BRACE_FOOT_INSET_M);
      if (topReach - footReach >= BRACE_MIN_RUN_M) braces.push({ angle, topReach, footReach });
    }
  }
  return braces;
}

/**
 * Stretches of consecutive probes around a ring of `count` where `over`
 * holds: the first probe of each and how many. The whole ring is one
 * stretch from probe 0.
 */
function overhangRuns(count: number, over: (k: number) => boolean): { first: number; length: number }[] {
  let clear = -1;
  for (let k = 0; k < count && clear < 0; k++) {
    if (!over(k)) clear = k;
  }
  if (clear < 0) return [{ first: 0, length: count }];

  // Once around from a probe that is not over the drop, back to it
  const runs: { first: number; length: number }[] = [];
  let first = -1;
  for (let j = 1; j <= count; j++) {
    const k = (clear + j) % count;
    if (over(k)) {
      if (first < 0) first = k;
    } else if (first >= 0) {
      runs.push({ first, length: (k - first + count) % count });
      first = -1;
    }
  }
  return runs;
}

/** Twice the signed area of (o, a, b): positive when b lies left of o→a. */
function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Convex hull of `points` (x, z), counter-clockwise, without points along an edge (monotone chain). */
function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return sorted;
  const half = (list: readonly Point[]): Point[] => {
    const chain: Point[] = [];
    for (const p of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 1e-12) chain.pop();
      chain.push(p);
    }
    chain.pop();
    return chain;
  };
  return half(sorted).concat(half([...sorted].reverse()));
}

/** True when the origin lies inside the counter-clockwise hull or on its edge. */
function containsOrigin(hull: readonly Point[]): boolean {
  const origin: Point = [0, 0];
  return hull.every((a, i) => cross(a, hull[(i + 1) % hull.length], origin) >= -1e-9);
}

/**
 * How far (m) from the origin, inside the hull, the ray in direction
 * (ux, uz) leaves it; 0 where it leaves at once.
 */
function exitDistance(hull: readonly Point[], ux: number, uz: number): number {
  let exit = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i];
    const [bx, bz] = hull[(i + 1) % hull.length];
    const ex = bx - ax;
    const ez = bz - az;
    const denom = ux * ez - uz * ex;
    if (Math.abs(denom) < 1e-12) continue;
    // Ray t·u meets the edge a + s·e
    const t = (ax * ez - az * ex) / denom;
    const s = (ax * uz - az * ux) / denom;
    if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9 && t < exit) exit = t;
  }
  return exit === Infinity ? 0 : exit;
}
