import { PLINTH_CONFIG } from '../configs/placement.config';

/** Where a tower stands on the ground under its footprint. */
export interface TowerFootprint {
  /**
   * Height of the tower's foot (local Y): the highest surface under the
   * footprint, on even ground the surface under the cursor.
   */
  footY: number;
  /** Plinth from the lowest surface under the footprint up to footY (m), 0 = none. */
  plinthHeight: number;
  /**
   * Probes the plinth hangs over a drop at, as indices into
   * footprintSampleOffsets (plinthOverhang). Only with a plinth; missing =
   * none. The plinth gets braces there (plinth-braces.ts).
   */
  overhang?: readonly number[];
}

/**
 * What a vertical probe found in its column, as `ColumnSample` has it: the
 * lowest surface (the ground, also under a roof or a deck) and the highest
 * (a roof, a deck, a car, a crown, else the ground).
 */
export interface FootprintColumn {
  groundY: number;
  topY: number;
}

/** Which rule set the foot, see resolveTowerFootprint. */
export type FootprintRule =
  /** The probes lie within MIN_UNEVENNESS: the cursor surface, no plinth */
  | 'even'
  /** The ground rule reaches the highest probe: roof or ground gives the same */
  | 'agree'
  /** On a roof: the cursor's own column shows the ground below */
  | 'roof-column'
  /** On a roof: the ground lies below on two opposite sides of the footprint */
  | 'roof-surroundings'
  /** On the ground: only what the ground climbs to gradually lifts the tower */
  | 'ground';

/** The footprint with the numbers it was decided by (decideTowerFootprint). */
export interface FootprintDecision {
  footprint: TowerFootprint;
  rule: FootprintRule;
  /** The cursor's column (the centre probe), null where it hit nothing */
  centre: FootprintColumn | null;
  /** Lowest and highest counted probe, and the highest the ground rule reaches */
  bottom: number;
  roofTop: number;
  groundTop: number;
  /** The surroundings probes where the decision needed them, else null */
  surroundings: readonly (FootprintColumn | null)[] | null;
}

/** Largest gap (m) between two probes on a ring. */
const RING_SPACING_M = 2;

/**
 * Probes at most this many times the larger of RING_SPACING_M and half the
 * radius apart are neighbours: next on a ring, across to the other ring, the
 * centre and the inner ring.
 */
const NEIGHBOUR_REACH = 1.25;

/** A neighbouring probe and the horizontal step (m) to it. */
interface Neighbour {
  index: number;
  dx: number;
  dz: number;
}

/**
 * Two probes of the inner ring about opposite each other. Unit axis from
 * `down` to `up`, half their distance in m.
 */
interface InnerPair {
  up: number;
  down: number;
  ux: number;
  uz: number;
  halfLength: number;
}

/** The probes of one footprint radius and how they hang together. */
interface FootprintPattern {
  /** (dx, dz) per probe: the centre, the inner ring, the outer ring */
  offsets: readonly (readonly [number, number])[];
  /** The centre and the inner ring: the probes before the outer ring */
  innerCount: number;
  neighbours: readonly (readonly Neighbour[])[];
  pairs: readonly InnerPair[];
}

const patternsByRadius = new Map<number, FootprintPattern>();

/**
 * The probe pattern for `radius`: the centre, a ring at half the radius and
 * one at the radius, probes at most RING_SPACING_M apart (at least 6 and 12).
 * The inner ring is turned by half a step so the two rings do not line up.
 * Cached per radius, shared.
 */
function footprintPattern(radius: number): FootprintPattern {
  const cached = patternsByRadius.get(radius);
  if (cached) return cached;

  const offsets: [number, number][] = [[0, 0]];
  const ring = (r: number, count: number, phase: number) => {
    for (let i = 0; i < count; i++) {
      const angle = ((i + phase) / count) * Math.PI * 2;
      offsets.push([Math.cos(angle) * r, Math.sin(angle) * r]);
    }
  };
  ring(radius / 2, Math.max(6, Math.ceil((Math.PI * radius) / RING_SPACING_M)), 0.5);
  const innerCount = offsets.length;
  ring(radius, Math.max(12, Math.ceil((2 * Math.PI * radius) / RING_SPACING_M)), 0);

  const reach = NEIGHBOUR_REACH * Math.max(radius / 2, RING_SPACING_M);
  const neighbours = offsets.map(([ax, az], a) => {
    const list: Neighbour[] = [];
    offsets.forEach(([bx, bz], b) => {
      if (b !== a && Math.hypot(bx - ax, bz - az) <= reach) list.push({ index: b, dx: bx - ax, dz: bz - az });
    });
    return list;
  });

  // Each inner probe with the one most opposite it (exactly opposite on an even ring)
  const pairs: InnerPair[] = [];
  for (let up = 1; up < innerCount; up++) {
    let down = up;
    let lowestDot = Infinity;
    for (let k = 1; k < innerCount; k++) {
      const dot = offsets[up][0] * offsets[k][0] + offsets[up][1] * offsets[k][1];
      if (dot < lowestDot) {
        lowestDot = dot;
        down = k;
      }
    }
    const dx = offsets[up][0] - offsets[down][0];
    const dz = offsets[up][1] - offsets[down][1];
    const length = Math.hypot(dx, dz);
    pairs.push({ up, down, ux: dx / length, uz: dz / length, halfLength: length / 2 });
  }

  const pattern = { offsets, innerCount, neighbours, pairs };
  patternsByRadius.set(radius, pattern);
  return pattern;
}

/**
 * Horizontal offsets (dx, dz) at which the ground under a footprint of
 * `radius` is probed, see footprintPattern. The list is shared.
 */
export function footprintSampleOffsets(radius: number): readonly (readonly [number, number])[] {
  return footprintPattern(radius).offsets;
}

/** How many probes of footprintSampleOffsets(radius) come before the outer ring: the centre and the inner ring. */
export function footprintInnerCount(radius: number): number {
  return footprintPattern(radius).innerCount;
}

/** Directions of the surroundings probes; entry k lies opposite entry k + half of them. */
const SURROUNDING_DIRECTIONS = 8;

const surroundingsByRadius = new Map<number, readonly (readonly [number, number])[]>();

/**
 * Horizontal offsets (dx, dz) at which the ground around a footprint of
 * `radius` is probed to tell a roof from the ground: eight directions,
 * PLINTH_CONFIG.ROOF_PROBE_REACH beyond the footprint, entry k opposite
 * entry k + 4. The list is shared.
 */
export function footprintSurroundingOffsets(radius: number): readonly (readonly [number, number])[] {
  let offsets = surroundingsByRadius.get(radius);
  if (!offsets) {
    const distance = radius + PLINTH_CONFIG.ROOF_PROBE_REACH;
    offsets = Array.from({ length: SURROUNDING_DIRECTIONS }, (_, k) => {
      const angle = (k / SURROUNDING_DIRECTIONS) * Math.PI * 2;
      return [Math.cos(angle) * distance, Math.sin(angle) * distance] as const;
    });
    surroundingsByRadius.set(radius, offsets);
  }
  return offsets;
}

/**
 * True while every column that hit something tops out less than
 * PLINTH_CONFIG.MIN_UNEVENNESS from the cursor surface and from each other:
 * level ground as far as these probes see.
 */
export function levelWithCursor(surfaceY: number, columns: readonly (FootprintColumn | null)[]): boolean {
  let top = surfaceY;
  let bottom = surfaceY;
  for (const column of columns) {
    if (column === null) continue;
    if (column.topY > top) top = column.topY;
    if (column.topY < bottom) bottom = column.topY;
  }
  return top - bottom < PLINTH_CONFIG.MIN_UNEVENNESS;
}

/**
 * The tower's foot and plinth from the surface under the cursor
 * (`surfaceY`) and the column of each probe of footprintSampleOffsets(radius),
 * in that order (null where a probe hit nothing).
 *
 * On uneven ground the tower stands on the highest point and the plinth
 * reaches down to the lowest, so no part of the tower sinks into the ground.
 * Each probe counts with the top of its column. Probes more than
 * PLINTH_CONFIG.MAX_RISE above or MAX_DROP below the cursor surface are left
 * out: a facade beside the tower, the drop past an edge. Below
 * MIN_UNEVENNESS the tower keeps the cursor surface and gets no plinth.
 *
 * What may lift the tower depends on where the cursor is:
 * - On a roof, a deck or a bridge: every probe, so the tower stands on the
 *   ridge of a pitched roof or the higher part of a stepped one. That is
 *   where the cursor surface lies more than ROOF_ABOVE_GROUND over the
 *   ground of its own column, or, where the photogrammetry shows no ground
 *   under a roof, over the ground on two opposite sides of the footprint:
 *   the columns `surroundings` gives for footprintSurroundingOffsets(radius),
 *   asked for only when the two rules give different feet. A slope falls on
 *   one side only and stays ground.
 * - On the ground: only probes the ground climbs to gradually, see
 *   groundTop. A car, a hedge, a wall or a crown beside the tower rises
 *   steeply out of the ground and does not lift it; the tower clips into it
 *   as it did before the plinth existed.
 * The lowest probe counts in both cases, the plinth also covers a drop
 * behind a wall. Where it hangs over a drop it does not reach down to, past
 * a roof edge deeper than MAX_DROP, `overhang` names those probes
 * (plinthOverhang).
 */
export function resolveTowerFootprint(
  surfaceY: number,
  radius: number,
  columns: readonly (FootprintColumn | null)[],
  surroundings?: () => readonly (FootprintColumn | null)[],
): TowerFootprint {
  return decideTowerFootprint(surfaceY, radius, columns, surroundings).footprint;
}

/** resolveTowerFootprint, with the rule and the numbers behind it. */
export function decideTowerFootprint(
  surfaceY: number,
  radius: number,
  columns: readonly (FootprintColumn | null)[],
  surroundings?: () => readonly (FootprintColumn | null)[],
): FootprintDecision {
  const heights = columns.map((column) => {
    if (column === null) return null;
    const y = column.topY;
    return y > surfaceY + PLINTH_CONFIG.MAX_RISE || y < surfaceY - PLINTH_CONFIG.MAX_DROP ? null : y;
  });

  let bottom = surfaceY;
  let roofTop = surfaceY;
  for (const y of heights) {
    if (y === null) continue;
    if (y < bottom) bottom = y;
    if (y > roofTop) roofTop = y;
  }
  const groundTopY = groundTop(surfaceY, heights, footprintPattern(radius));
  const centre = columns[0] ?? null;

  const decided = (
    rule: FootprintRule,
    top: number,
    probed: readonly (FootprintColumn | null)[] | null = null,
  ): FootprintDecision => ({
    footprint: top - bottom < PLINTH_CONFIG.MIN_UNEVENNESS
      ? { footY: surfaceY, plinthHeight: 0 }
      : plinthFootprint(top, bottom, columns),
    rule,
    centre,
    bottom,
    roofTop,
    groundTop: groundTopY,
    surroundings: probed,
  });

  if (roofTop - bottom < PLINTH_CONFIG.MIN_UNEVENNESS) return decided('even', surfaceY);
  if (groundTopY === roofTop) return decided('agree', roofTop);
  if (groundFarBelow(surfaceY, centre)) return decided('roof-column', roofTop);
  const around = surroundings?.() ?? null;
  if (around !== null && groundFarBelowOnBothSides(surfaceY, around)) {
    return decided('roof-surroundings', roofTop, around);
  }
  return decided('ground', groundTopY, around);
}

/** The foot at `footY` on a plinth down to `bottom`, with the probes it overhangs. */
function plinthFootprint(footY: number, bottom: number, columns: readonly (FootprintColumn | null)[]): TowerFootprint {
  const overhang = plinthOverhang(bottom, columns);
  const footprint = { footY, plinthHeight: footY - bottom };
  return overhang.length > 0 ? { ...footprint, overhang } : footprint;
}

/**
 * The probes a plinth down to `bottom` hangs over a drop at: their column
 * tops out below it or hits nothing. The plinth reaches down to every probe
 * resolveTowerFootprint counts, so these are the ones MAX_DROP left out, the
 * drop past a roof edge, and those without a surface. Indices into `columns`.
 */
export function plinthOverhang(bottom: number, columns: readonly (FootprintColumn | null)[]): number[] {
  const overhang: number[] = [];
  columns.forEach((column, index) => {
    if (column === null || column.topY < bottom) overhang.push(index);
  });
  return overhang;
}

/** True when two footprints stand the tower the same way: foot, plinth and overhang. */
export function sameFootprint(a: TowerFootprint, b: TowerFootprint): boolean {
  return a.footY === b.footY && a.plinthHeight === b.plinthHeight && sameOverhang(a.overhang, b.overhang);
}

/** True when two overhangs name the same probes, missing the same as none. */
export function sameOverhang(a: readonly number[] = [], b: readonly number[] = []): boolean {
  return a.length === b.length && a.every((index, i) => index === b[i]);
}

/** True where `column` shows ground more than ROOF_ABOVE_GROUND below `surfaceY`. */
function groundFarBelow(surfaceY: number, column: FootprintColumn | null | undefined): boolean {
  return column != null && surfaceY - column.groundY > PLINTH_CONFIG.ROOF_ABOVE_GROUND;
}

/**
 * True where both columns of an opposite pair of surroundings probes show
 * ground far below `surfaceY` (groundFarBelow): the cursor on a building
 * with lower ground on either side of it.
 */
function groundFarBelowOnBothSides(surfaceY: number, around: readonly (FootprintColumn | null)[]): boolean {
  const half = around.length / 2;
  for (let k = 0; k < half; k++) {
    if (groundFarBelow(surfaceY, around[k]) && groundFarBelow(surfaceY, around[k + half])) return true;
  }
  return false;
}

/**
 * Highest probe the ground climbs to from the cursor: walking from the
 * cursor to neighbouring probes, a step may go down any distance but up
 * only PLINTH_CONFIG.MAX_STEP plus what the slope under the cursor
 * (cursorSlope) gives along the step. A probe that only a steeper climb
 * reaches stands on something beside the tower, not on its ground.
 */
function groundTop(surfaceY: number, heights: readonly (number | null)[], pattern: FootprintPattern): number {
  const [gx, gz] = cursorSlope(surfaceY, heights, pattern.pairs);
  const reached = new Array<boolean>(heights.length).fill(false);
  const open: number[] = [];
  let top = surfaceY;

  const step = (fromY: number, to: Neighbour) => {
    const y = heights[to.index];
    if (y === null || y === undefined || reached[to.index]) return;
    if (y - fromY > PLINTH_CONFIG.MAX_STEP + Math.max(0, gx * to.dx + gz * to.dz)) return;
    reached[to.index] = true;
    open.push(to.index);
    if (y > top) top = y;
  };

  // The cursor stands where the centre probe is and has its neighbours
  step(surfaceY, { index: 0, dx: 0, dz: 0 });
  for (const to of pattern.neighbours[0]) step(surfaceY, to);
  while (open.length > 0) {
    const from = open.pop()!;
    for (const to of pattern.neighbours[from]) step(heights[from]!, to);
  }
  return top;
}

/**
 * Slope of the ground under the cursor as a gradient (rise per metre in x
 * and z). A pair of opposite inner probes measures it along its axis where
 * one side lies above the cursor surface and the other below: the smaller of
 * the two, so a car or a wall on one side does not tilt it. A ridge or a
 * hollow (both sides the same way) measures none. Least squares over all
 * pairs, no slope when they do not span both directions.
 */
function cursorSlope(surfaceY: number, heights: readonly (number | null)[], pairs: readonly InnerPair[]): [number, number] {
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let bx = 0;
  let bz = 0;
  for (const pair of pairs) {
    const up = heights[pair.up];
    const down = heights[pair.down];
    if (up === null || up === undefined || down === null || down === undefined) continue;
    const rise = up - surfaceY;
    const fall = surfaceY - down;
    let slope = 0;
    if (rise > 0 && fall > 0) slope = Math.min(rise, fall) / pair.halfLength;
    else if (rise < 0 && fall < 0) slope = -Math.min(-rise, -fall) / pair.halfLength;
    sxx += pair.ux * pair.ux;
    sxz += pair.ux * pair.uz;
    szz += pair.uz * pair.uz;
    bx += pair.ux * slope;
    bz += pair.uz * slope;
  }
  const det = sxx * szz - sxz * sxz;
  if (det < 1e-9) return [0, 0];
  return [(szz * bx - sxz * bz) / det, (sxx * bz - sxz * bx) / det];
}
