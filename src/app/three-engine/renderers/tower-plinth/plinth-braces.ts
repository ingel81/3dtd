import { footprintInnerCount, footprintSampleOffsets } from '../../../utils/tower-footprint';
import { BRACE_TOP_Y, BRACE_WIDTH_M, PLINTH_RIM_M, plinthWallRadius, type PlinthBrace } from './plinth-geometry';

/** Corbels along an overhanging stretch of the rim about this far apart (m). */
const BRACE_SPACING_M = 3;
/** At most this many corbels on one side of the plinth, a stretch of up to half the rim. */
const BRACES_PER_SIDE = 2;
/** A corbel's front face this far (m) inside the wall, which hides the joint. */
const BRACE_RIM_INSET_M = 0.2;
/** Its back this far (m) inside the edge of the roof as the probes know it, in the building. */
const BRACE_FOOT_INSET_M = 0.3;
/** Its steps project at least this far (m) beyond where the roof ends. */
const BRACE_MIN_PROJECTION_M = 0.45;
/** Step (m) of the walk along a corbel to where the roof ends. */
const EDGE_WALK_M = 0.05;
/**
 * Shortest corbel (m, from its back to its front face). Shorter, and the
 * plinth barely overhangs the roof there.
 */
export const BRACE_MIN_RUN_M = 1.04;

type Point = readonly [number, number];

/**
 * The stone corbels under a plinth that hangs over a drop at the footprint
 * probes `overhang` (indices into footprintSampleOffsets(footprintRadius),
 * from TowerFootprint.overhang). None without overhang: on the ground, on a
 * roof away from its edge.
 *
 * Only the probe data, no raycasts. Where probes on the footprint's rim
 * hang over the drop, corbels go along that stretch of the rim about
 * BRACE_SPACING_M apart, at most BRACES_PER_SIDE on each half of the rim it
 * spans. The corbels of one side point the same way, out along its middle,
 * so they meet a straight facade square. One whose line along there misses
 * the roof (at a corner) points straight out from the axis instead.
 *
 * The roof is the convex hull of the probes with ground under the plinth. A
 * corbel's back ends BRACE_FOOT_INSET_M inside it, in the building; its
 * steps project from where the roof ends along its middle, halfway between a
 * probe on the roof and one over the drop as far as the nearest probe tells
 * (edgeReach), to its front face just inside the wall. None where the
 * tower's axis is not over that roof, and none shorter than BRACE_MIN_RUN_M.
 */
export function plinthBraces(footprintRadius: number, height: number, overhang: readonly number[]): PlinthBrace[] {
  if (overhang.length === 0) return [];
  const offsets = footprintSampleOffsets(footprintRadius);
  const innerCount = footprintInnerCount(footprintRadius);
  const over = new Set(overhang);
  const roof = convexHull(offsets.filter((_, index) => !over.has(index)));
  if (roof.length < 3 || !containsOrigin(roof)) return [];
  const onRoof = (x: number, z: number) => !over.has(nearestProbe(offsets, x, z));
  const rim = footprintRadius + PLINTH_RIM_M;

  // The outer ring runs counter-clockwise around the rim from angle 0
  const ringCount = offsets.length - innerCount;
  const ringStep = (2 * Math.PI) / ringCount;
  const braces: PlinthBrace[] = [];
  for (const run of overhangRuns(ringCount, (k) => over.has(innerCount + k))) {
    const [x, z] = offsets[innerCount + run.first];
    const runStart = Math.atan2(z, x) - ringStep / 2;
    const runSpan = run.length * ringStep;
    // One side of the plinth at a time: up to half the rim
    const sides = Math.ceil(runSpan / Math.PI - 1e-9);
    const span = runSpan / sides;
    for (let side = 0; side < sides; side++) {
      const start = runStart + side * span;
      const facing = start + span / 2;
      const count = Math.min(BRACES_PER_SIDE, Math.max(1, Math.round((span * rim) / BRACE_SPACING_M)));
      for (let j = 0; j < count; j++) {
        const around = start + ((j + 0.5) * span) / count;
        let angle = facing;
        let offset = rim * Math.sin(around - facing);
        let roofSpan = roofAlong(roof, angle, offset);
        if (!roofSpan) {
          angle = around;
          offset = 0;
          roofSpan = roofAlong(roof, angle, offset);
        }
        const brace = roofSpan && corbel(footprintRadius, height, angle, offset, roofSpan[1], onRoof);
        if (brace) braces.push(brace);
      }
    }
  }
  return braces;
}

/**
 * The corbel along `angle` at `offset` to the side of the axis, whose line
 * leaves the roof at reach `roofExit`; null where it would be shorter than
 * BRACE_MIN_RUN_M or its front would not fit under the wall.
 */
function corbel(
  footprintRadius: number,
  height: number,
  angle: number,
  offset: number,
  roofExit: number,
  onRoof: (x: number, z: number) => boolean,
): PlinthBrace | null {
  // The front face inside the wall at both its corners
  let wallReach = Infinity;
  for (const across of [offset - BRACE_WIDTH_M / 2, offset + BRACE_WIDTH_M / 2]) {
    const guess = Math.sqrt(Math.max(0, (footprintRadius + PLINTH_RIM_M) ** 2 - across ** 2));
    const r = plinthWallRadius(footprintRadius, height, angle + Math.atan2(across, guess), BRACE_TOP_Y);
    if (Math.abs(across) >= r) return null;
    wallReach = Math.min(wallReach, Math.sqrt(r * r - across * across));
  }
  const topReach = wallReach - BRACE_RIM_INSET_M;
  const footReach = roofExit - BRACE_FOOT_INSET_M;
  if (topReach - footReach < BRACE_MIN_RUN_M) return null;

  // From the front inwards to the first point whose nearest probe has ground under the plinth
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  let edgeReach = footReach;
  for (let reach = topReach; reach > footReach; reach -= EDGE_WALK_M) {
    if (onRoof(ux * reach - uz * offset, uz * reach + ux * offset)) {
      edgeReach = reach;
      break;
    }
  }
  edgeReach = Math.min(edgeReach, topReach - BRACE_MIN_PROJECTION_M);
  return { angle, offset, topReach, edgeReach, footReach };
}

/** Index of the probe nearest to (x, z). */
function nearestProbe(offsets: readonly Point[], x: number, z: number): number {
  let nearest = 0;
  let nearestSq = Infinity;
  offsets.forEach(([px, pz], index) => {
    const sq = (px - x) ** 2 + (pz - z) ** 2;
    if (sq < nearestSq) {
      nearestSq = sq;
      nearest = index;
    }
  });
  return nearest;
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
 * Where the line along `angle`, `offset` to the side of the origin (towards
 * angle + π/2), runs inside the counter-clockwise hull: its reach going in
 * and coming out. Null where it crosses less than BRACE_FOOT_INSET_M of it.
 */
function roofAlong(hull: readonly Point[], angle: number, offset: number): [number, number] | null {
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  const ox = -uz * offset;
  const oz = ux * offset;
  let enter = -Infinity;
  let exit = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [ax, az] = hull[i];
    const [bx, bz] = hull[(i + 1) % hull.length];
    // Outward normal of the edge a→b
    const nx = bz - az;
    const nz = ax - bx;
    const along = nx * ux + nz * uz;
    const ahead = nx * (ax - ox) + nz * (az - oz);
    if (Math.abs(along) < 1e-12) {
      if (ahead < 0) return null;
      continue;
    }
    if (along > 0) exit = Math.min(exit, ahead / along);
    else enter = Math.max(enter, ahead / along);
  }
  return exit - enter >= BRACE_FOOT_INSET_M ? [enter, exit] : null;
}
