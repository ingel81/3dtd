import { WORM_BEND_RADIUS_M } from '../managers/worm/worm-path';
import type { ColumnAt } from './corridor-walk';
import { StationProbe, corridorConfig } from './route-corridor';

/**
 * Obstacles on a route centre line, and how the route gets past them.
 *
 * The OSM line of a street can run over something the photogrammetry shows
 * standing on the street: a parked car, a hedge, a jetty or a roof corner
 * (playtest 2026-09-15, retest 706 to 708, Erlenbach Schulstraße: centre
 * line cells 0.59 to 1.08 m over the line on three cars). The corridor keeps
 * a cell the line runs through at any width (claimSegmentCells), so enemies
 * climbed over the car and the red line took its roof. User decision
 * 2026-09-15 (E6): the 3D model counts.
 *
 * - An obstacle is anything more than `stepRise` above the street ground
 *   beside it (raisedAcross), or more than `roofRise` above the ground of
 *   the line around it (a jetty, a roof corner, a crown over the line).
 * - With room beside it the route bends round it (a detour): the smallest
 *   offset to either side that leaves the columns within half a cell
 *   diagonal of the path on the street (offsetFor), held along the obstacle
 *   and reached on a cosine ramp gentle enough for the worm's rings
 *   (rampLength).
 * - Without room, something over the lane the mesh fills below (`roofRise`
 *   up) becomes a passage: a short tunnel, like an archway, whose cells take
 *   the street between its portals (PathAndRouteService marks it `inTunnel`).
 *   Anything lower stays: enemies climb over it as the model has it.
 *
 * planDetours finds them on the route as the street network gives it,
 * applyDetourPlan puts them into it. PathAndRouteService plans with the
 * grid's columns after each build and keeps the plan per route, so every
 * build of the same route until the next plan has the same waypoints.
 */

/** Metres between the points of a route centre line planDetours looks at. */
export const DETOUR_SAMPLE_M = 1;

/** Metres between the waypoints of a ramp (applyDetourPlan). */
export const RAMP_STEP_M = 1;

/** Step of the columns across the route, metres: the engine caches columns in 0.5 m buckets (terrain-queries.ts). */
const ACROSS_STEP_M = 0.5;

/**
 * How far either side of the line the edges of a car or a hedge on it are
 * looked for, metres: a van is 2.2 m wide, and the line can run along its
 * edge.
 */
const OBSTACLE_REACH_M = 3;

/**
 * How far past the first column below something on the line the street
 * beside it may lie, metres (streetBeside): the side of a car the
 * photogrammetry slopes down. An embankment below a dam falls for longer.
 */
const SKIRT_M = 1;

/**
 * Metres either way along the line whose points give the ground of the line
 * at a point (their median), for the obstacles `roofRise` up: a jetty or a
 * roof corner covers a metre or two of the line, the median of nine points
 * keeps four raised ones out of it.
 */
const ALONG_REACH_M = 4;

/**
 * How far before and after a point with the street on one side only the
 * line has to come down for the point to be something standing on it,
 * metres (raisedAlong): a parked car is 4.5 m long, two bumper to bumper
 * 9 m, so from any point on them the line comes down within 6 m either way.
 */
const BUMP_REACH_M = 6;

/** Obstacle points at most this far apart along the line are one obstacle, metres. */
const JOIN_M = 2;

/**
 * How far before and after its outermost points an obstacle holds the
 * detour's offset, metres: it may reach up to DETOUR_SAMPLE_M further than
 * the point that shows it, and a cell the path touches has its centre up to
 * half a cell diagonal further along.
 */
const HOLD_MARGIN_M = 2;

/** How far a passage reaches past the outermost points of its obstacle, metres: its cells cover the obstacle's. */
const PASSAGE_MARGIN_M = 1;

/** The shortest ramp, as a multiple of its offset (about 27 degrees at its steepest). */
const MIN_RAMP_RATIO = 2;

/** Shares of the ramp length (rampLength) a ramp tries, longest first, where the longest would pass an obstacle. */
const RAMP_SHARES = [1, 0.75, 0.5];

/** A route as planDetours reads it. */
export interface DetourLine {
  /** Local x, z of the points of the route, as the street network gives it (before any detour). */
  points: readonly { x: number; z: number }[];
  /**
   * Per segment, whether a detour or a passage may lie on it: a street on
   * the ground. Not a bridge, a tunnel, the stretch off a bridge end or the
   * leg to the HQ, whose cells take their height another way or stand in
   * yards and houses.
   */
  open: readonly boolean[];
  /**
   * The half width the clearance rays allow on `side` of segment `i` at `t`
   * (0 to 1 along it), without the walk caps: those of the build before
   * narrow the corridor round the obstacle on the line itself.
   */
  room: (i: number, t: number, side: 'left' | 'right') => number;
}

/**
 * A stretch of a route offset sideways, metres along the route: from
 * `offsetFrom` at `from` to `offsetTo` at `to` on a half cosine, the same
 * offset all along where the two are equal. Right of the direction of
 * travel positive.
 */
export interface DetourPiece {
  from: number;
  to: number;
  offsetFrom: number;
  offsetTo: number;
}

/** A stretch of a route run as a passage, metres along it: see the file comment. */
export interface DetourPassage {
  from: number;
  to: number;
}

/** What planDetours found on a route. Pieces and passages in order along it, none overlapping. */
export interface DetourPlan {
  pieces: DetourPiece[];
  passages: DetourPassage[];
}

/** One point of the centre line planDetours looks at. */
interface LinePoint {
  /** Metres along the route. */
  s: number;
  /** Segment and share of it. */
  i: number;
  t: number;
  x: number;
  z: number;
  /** Unit vector right of the direction of travel. */
  rx: number;
  rz: number;
  /** Lowest hit of the column there from a tile up to `maxTileError`, null without. */
  y: number | null;
  /** Run of open segments the point lies in, -1 on a segment that is not open. */
  run: number;
}

/** What stands on the line at a point, and the street ground a detour there compares with. */
interface Judged {
  kind: 'clear' | 'step' | 'roof';
  ground: number | null;
  /** Rise of the street per metre to the right, from the ground either side of a step. */
  slope: number;
}

/** An obstacle with room beside it: the offset held from `from` to `to`, metres along the route. */
interface Hold {
  from: number;
  to: number;
  offset: number;
  roof: boolean;
  /** Where the stretch of the line it lies in begins and ends (open segments, no passage). */
  runFrom: number;
  runTo: number;
  slope: number;
  /** Outermost points of the obstacle, for a passage in its place. */
  first: number;
  last: number;
}

const ascending = (a: number, b: number) => a - b;

/** Share of the way from one offset to the next at `u` (0 to 1) of a piece: a half cosine. */
const blend = (u: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, u)))) / 2;

/**
 * Length of a ramp between two offsets `delta` apart, metres: a half cosine
 * whose tightest bend has the radius the worm rounds a corner with
 * (WORM_BEND_RADIUS_M). Its rings are rigid and gape on the outside of a
 * sharper bend; the ooze band turns with the segments. 15.7 m for 2.5 m.
 */
export function rampLength(delta: number): number {
  return Math.PI * Math.sqrt((Math.abs(delta) * WORM_BEND_RADIUS_M) / 2);
}

/** The offset of the route `s` metres along it under `plan`, 0 outside its pieces. */
export function offsetAt(plan: DetourPlan, s: number): number {
  for (const piece of plan.pieces) {
    if (s < piece.from || s > piece.to) continue;
    if (piece.offsetFrom === piece.offsetTo) return piece.offsetFrom;
    return piece.offsetFrom + (piece.offsetTo - piece.offsetFrom) * blend((s - piece.from) / (piece.to - piece.from));
  }
  return 0;
}

/**
 * The obstacles on the centre line of `line` and how the route gets past
 * each: a detour or a passage (see the file comment), or nothing where
 * enemies climb over it. `column` is the grid's column probe; columns from
 * tiles coarser than `maxTileError` do not count, like unknown ground.
 */
export function planDetours(line: DetourLine, column: ColumnAt, cellSize: number): DetourPlan {
  const { stepRise, stepDrop, maxTileError, wallMargin } = corridorConfig;
  const groundAt = (x: number, z: number): number | null => {
    const sample = column(x, z);
    return sample !== null && sample.tileGeometricError <= maxTileError ? sample.groundY : null;
  };
  const { points: samples, runs } = pointsAlong(line, groundAt);
  const plan: DetourPlan = { pieces: [], passages: [] };
  if (samples.length === 0) return plan;
  const clearance = Math.ceil((cellSize * Math.SQRT1_2) / ACROSS_STEP_M) * ACROSS_STEP_M;
  const indexOf = (s: number) => Math.round(s / DETOUR_SAMPLE_M);
  const along = alongGround(samples);
  const judged = samples.map((_p, k): Judged => judge(samples, k, along[k], groundAt));

  // The street beside the nearest obstacle point along the same run, per point.
  const nearest: (number | null)[] = new Array(samples.length).fill(null);
  const nearestAt: number[] = new Array(samples.length).fill(Infinity);
  for (const order of [1, -1]) {
    let last: { s: number; ground: number; run: number } | null = null;
    for (let k = order > 0 ? 0 : samples.length - 1; k >= 0 && k < samples.length; k += order) {
      const ground = judged[k].ground;
      if (ground !== null) last = { s: samples[k].s, ground, run: samples[k].run };
      if (!last || last.run !== samples[k].run) continue;
      const d = Math.abs(samples[k].s - last.s);
      if (d < nearestAt[k]) {
        nearestAt[k] = d;
        nearest[k] = last.ground;
      }
    }
  }

  /**
   * The street ground at a point for a path beside the line: the obstacle's
   * street there; elsewhere the line's own ground where it lies within
   * `stepRise` of the street beside the nearest obstacle, which keeps the
   * slope along the street, else that street. Playtest 719: between two
   * cars the line lay 0.6 m over the street beside them, and a path there
   * compared the street with that.
   */
  const streetAt = (k: number, fallback: number): number => {
    const beside = judged[k].ground;
    if (beside !== null) return beside;
    const street = nearest[k] ?? fallback;
    const own = samples[k].y ?? along[k];
    return own !== null && Math.abs(own - street) <= stepRise ? own : street;
  };

  /**
   * Whether a path `y` right of the line at point `k` has the street within
   * `clearance` either side of it. A column without any hit (a hole in the
   * mesh, as at Erlenbach in playtest 719) is no obstacle, as long as at
   * least half of them have one.
   */
  const clear = (k: number, y: number, ground: number, slope: number): boolean => {
    const p = samples[k];
    let count = 0;
    let known = 0;
    for (let j = -clearance; j <= clearance + 1e-9; j += ACROSS_STEP_M) {
      const at = y + j;
      const side = at >= 0 ? 'right' : 'left';
      if (Math.abs(at) > line.room(p.i, p.t, side) + wallMargin) return false;
      count++;
      const h = groundAt(p.x + p.rx * at, p.z + p.rz * at);
      if (h === null) continue;
      known++;
      const rise = h - (ground + slope * at);
      if (rise > stepRise || rise < -stepDrop) return false;
    }
    return 2 * known >= count;
  };

  /** Whether the path from `offsetFrom` at `from` to `offsetTo` at `to` keeps clear at every point between. */
  const pieceClear = (from: number, to: number, offsetFrom: number, offsetTo: number, ground: number, slope: number): boolean => {
    for (let k = Math.max(0, Math.ceil(from / DETOUR_SAMPLE_M)); k < samples.length && samples[k].s <= to; k++) {
      const y = offsetFrom + (offsetTo - offsetFrom) * blend((samples[k].s - from) / (to - from));
      if (!clear(k, y, streetAt(k, ground), slope)) return false;
    }
    return true;
  };

  /** The mean street ground over the points from `from` to `to`, 0 without any. */
  const streetGround = (from: number, to: number): number => {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, indexOf(from)); k < samples.length && samples[k].s <= to; k++) {
      const y = judged[k].ground ?? samples[k].y;
      if (y === null) continue;
      sum += y;
      count++;
    }
    return count > 0 ? sum / count : 0;
  };

  /** The smallest offset to either side that is clear at every point from `from` to `to` (pickSide), null where there is none. */
  const offsetFor = (from: number, to: number, ground: number, slope: number): number | null => {
    const ks: number[] = [];
    for (let k = Math.max(0, indexOf(from)); k <= Math.min(samples.length - 1, indexOf(to)); k++) ks.push(k);
    const widest = Math.max(...ks.flatMap((k) => [line.room(samples[k].i, samples[k].t, 'left'), line.room(samples[k].i, samples[k].t, 'right')]));
    return pickSide((y) => ks.every((k) => clear(k, y, streetAt(k, ground), slope)), widest + wallMargin);
  };

  // Obstacle points close together along one run are one obstacle.
  const stretches: { first: number; last: number }[] = [];
  for (let k = 0; k < samples.length; k++) {
    if (judged[k].kind === 'clear' || samples[k].run < 0) continue;
    const last = stretches[stretches.length - 1];
    if (last && samples[k].run === samples[last.last].run && samples[k].s - samples[last.last].s <= JOIN_M) last.last = k;
    else stretches.push({ first: k, last: k });
  }

  const holds: Hold[] = [];
  const passages: DetourPassage[] = [];
  for (const { first, last } of stretches) {
    const run = runs[samples[first].run];
    const from = Math.max(run.from, samples[first].s - HOLD_MARGIN_M);
    const to = Math.min(run.to, samples[last].s + HOLD_MARGIN_M);
    const kinds = judged.slice(first, last + 1);
    const roof = kinds.some((j) => j.kind === 'roof');
    const steps = kinds.filter((j) => j.kind === 'step');
    const slope = steps.length > 0 ? steps.reduce((sum, j) => sum + j.slope, 0) / steps.length : 0;
    const offset = offsetFor(from, to, streetGround(from, to), slope);
    if (offset !== null) holds.push({ from, to, offset, roof, runFrom: run.from, runTo: run.to, slope, first: samples[first].s, last: samples[last].s });
    else if (roof) passages.push(passageOver(samples[first].s, samples[last].s, run));
  }

  // A passage ends the stretch a detour may use.
  const bounded = holds.map((hold) => {
    let { runFrom, runTo } = hold;
    for (const passage of passages) {
      if (passage.to <= hold.from) runFrom = Math.max(runFrom, passage.to);
      if (passage.from >= hold.to) runTo = Math.min(runTo, passage.from);
    }
    return { ...hold, runFrom, runTo };
  });

  const merged = mergeHolds(bounded, (from, to, offset, ground, slope) => pieceClear(from, to, offset, offset, ground, slope), streetGround);
  const laid = layOut(merged, pieceClear, streetGround);
  plan.pieces = laid.pieces;
  // An obstacle over the lane whose ramps found no clear way becomes a passage, where it meets no detour.
  for (const hold of laid.dropped) {
    if (!hold.roof) continue;
    const passage = passageOver(hold.first, hold.last, { from: hold.runFrom, to: hold.runTo });
    if (plan.pieces.some((piece) => piece.from < passage.to && piece.to > passage.from)) continue;
    passages.push(passage);
  }
  plan.passages = passages.sort((a, b) => a.from - b.from);
  return plan;
}

/** A passage over the obstacle points `first` to `last`, PASSAGE_MARGIN_M either side, within `run`. */
function passageOver(first: number, last: number, run: { from: number; to: number }): DetourPassage {
  return { from: Math.max(run.from, first - PASSAGE_MARGIN_M), to: Math.min(run.to, last + PASSAGE_MARGIN_M) };
}

/**
 * The smallest offset `valid` takes on either side, in ACROSS_STEP_M steps
 * out to `widest`: the one nearer the line, and where both are as near, the
 * side with more valid offsets beyond it (more room), then the right.
 */
function pickSide(valid: (y: number) => boolean, widest: number): number | null {
  const first = (sign: number): { y: number; spare: number } | null => {
    for (let y = ACROSS_STEP_M; y <= widest + 1e-9; y += ACROSS_STEP_M) {
      if (!valid(sign * y)) continue;
      let spare = 0;
      for (let more = y + ACROSS_STEP_M; more <= widest + 1e-9 && valid(sign * more); more += ACROSS_STEP_M) spare++;
      return { y: sign * y, spare };
    }
    return null;
  };
  const right = first(1);
  const left = first(-1);
  if (!right || !left) return right?.y ?? left?.y ?? null;
  if (Math.abs(right.y) !== Math.abs(left.y)) return Math.abs(right.y) < Math.abs(left.y) ? right.y : left.y;
  return left.spare > right.spare ? left.y : right.y;
}

/**
 * Holds on the same side whose ramps would meet (closer than the ramp out of
 * one and the ramp into the next) become one, at the larger of the two
 * offsets, where that is clear all along: a row of parked cars with gaps.
 */
function mergeHolds(
  holds: Hold[],
  clearAt: (from: number, to: number, offset: number, ground: number, slope: number) => boolean,
  streetGround: (from: number, to: number) => number,
): Hold[] {
  const result: Hold[] = [];
  for (const hold of holds) {
    const last = result[result.length - 1];
    const close = last && last.runFrom === hold.runFrom && hold.from - last.to < rampLength(last.offset) + rampLength(hold.offset);
    if (close && Math.sign(last.offset) === Math.sign(hold.offset)) {
      const offset = Math.abs(last.offset) >= Math.abs(hold.offset) ? last.offset : hold.offset;
      const slope = (last.slope + hold.slope) / 2;
      if (clearAt(last.from, hold.to, offset, streetGround(last.from, hold.to), slope)) {
        result[result.length - 1] = { ...last, to: hold.to, offset, roof: last.roof || hold.roof, slope, last: hold.last };
        continue;
      }
    }
    result.push(hold);
  }
  return result;
}

/**
 * The pieces of the holds with their ramps: a ramp into each and out of it
 * (rampLength, shorter where the full one would pass an obstacle, see
 * RAMP_SHARES), or where two holds lie closer than their ramps, one piece
 * from the offset of the first to that of the second. A hold whose ramp or
 * piece to the next finds no clear way goes, and the others are laid out
 * again without it; `dropped` lists them.
 */
function layOut(
  input: Hold[],
  pieceClear: (from: number, to: number, offsetFrom: number, offsetTo: number, ground: number, slope: number) => boolean,
  streetGround: (from: number, to: number) => number,
): { pieces: DetourPiece[]; dropped: Hold[] } {
  const holds = [...input];
  const dropped: Hold[] = [];
  for (;;) {
    const pieces: DetourPiece[] = [];
    let failed = -1;
    for (let k = 0; k < holds.length && failed < 0; k++) {
      const hold = holds[k];
      const previous = k > 0 && holds[k - 1].runFrom === hold.runFrom ? holds[k - 1] : null;
      const next = k + 1 < holds.length && holds[k + 1].runFrom === hold.runFrom ? holds[k + 1] : null;
      const joined = (a: Hold, b: Hold) => b.from - a.to < rampLength(a.offset) + rampLength(b.offset);
      if (!previous || !joined(previous, hold)) {
        const ramp = rampWithin(hold, 'in', previous ? previous.to : hold.runFrom);
        if (ramp === null) failed = k;
        else pieces.push(ramp);
      }
      if (failed >= 0) break;
      pieces.push({ from: hold.from, to: hold.to, offsetFrom: hold.offset, offsetTo: hold.offset });
      if (next && joined(hold, next)) {
        const gap = next.from - hold.to;
        const ground = streetGround(hold.to, next.from);
        const slope = (hold.slope + next.slope) / 2;
        if (gap < MIN_RAMP_RATIO * Math.abs(next.offset - hold.offset) || !pieceClear(hold.to, next.from, hold.offset, next.offset, ground, slope)) {
          failed = k + 1;
        } else {
          pieces.push({ from: hold.to, to: next.from, offsetFrom: hold.offset, offsetTo: next.offset });
        }
      } else {
        const ramp = rampWithin(hold, 'out', next ? next.from - rampLength(next.offset) : hold.runTo);
        if (ramp === null) failed = k;
        else pieces.push(ramp);
      }
    }
    if (failed < 0) return { pieces, dropped };
    dropped.push(...holds.splice(failed, 1));
  }

  /** The ramp into (`in`) or out of `hold`, no further than `bound`; null where none is clear. */
  function rampWithin(hold: Hold, way: 'in' | 'out', bound: number): DetourPiece | null {
    const available = way === 'in' ? hold.from - bound : bound - hold.to;
    const ideal = rampLength(hold.offset);
    const shortest = MIN_RAMP_RATIO * Math.abs(hold.offset);
    const tried = new Set<number>();
    for (const share of RAMP_SHARES) {
      const length = Math.min(ideal * share, available);
      if (length < shortest || tried.has(length)) continue;
      tried.add(length);
      const piece = way === 'in'
        ? { from: hold.from - length, to: hold.from, offsetFrom: 0, offsetTo: hold.offset }
        : { from: hold.to, to: hold.to + length, offsetFrom: hold.offset, offsetTo: 0 };
      if (pieceClear(piece.from, piece.to, piece.offsetFrom, piece.offsetTo, streetGround(piece.from, piece.to), hold.slope)) return piece;
    }
    return null;
  }
}

/**
 * Points every DETOUR_SAMPLE_M along the route from its start, with the
 * ground under each (`groundAt`, on open segments only), and the runs of
 * open segments, metres along the route.
 */
function pointsAlong(
  line: DetourLine,
  groundAt: (x: number, z: number) => number | null,
): { points: LinePoint[]; runs: { from: number; to: number }[] } {
  const { points, open } = line;
  const found: LinePoint[] = [];
  const runs: { from: number; to: number }[] = [];
  const runOf: number[] = [];
  let start = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
    if (open[i]) {
      const last = runs[runs.length - 1];
      if (last && i > 0 && open[i - 1]) last.to = start + length;
      else runs.push({ from: start, to: start + length });
      runOf.push(runs.length - 1);
    } else {
      runOf.push(-1);
    }
    start += length;
  }
  let s = 0;
  let from = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const end = from + length;
    if (length > 0) {
      const rx = -(b.z - a.z) / length;
      const rz = (b.x - a.x) / length;
      for (; s < end || (i === points.length - 2 && s <= end + 1e-9); s += DETOUR_SAMPLE_M) {
        const t = Math.min(1, (s - from) / length);
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        const run = runOf[i];
        found.push({ s, i, t, x, z, rx, rz, y: run >= 0 ? groundAt(x, z) : null, run });
      }
    }
    from = end;
  }
  return { points: found, runs };
}

/** Per point, the median ground of the open points within ALONG_REACH_M along the line, null without any. */
function alongGround(points: readonly LinePoint[]): (number | null)[] {
  const reach = Math.round(ALONG_REACH_M / DETOUR_SAMPLE_M);
  return points.map((p, k) => {
    if (p.run < 0) return null;
    const heights: number[] = [];
    for (let j = Math.max(0, k - reach); j <= Math.min(points.length - 1, k + reach); j++) {
      const y = points[j].y;
      if (points[j].run === p.run && y !== null) heights.push(y);
    }
    if (heights.length === 0) return null;
    heights.sort(ascending);
    return heights[Math.floor((heights.length - 1) / 2)];
  });
}

/**
 * What stands on the line at point `k`: `roof` more than `roofRise` above
 * the ground of the line around it (`along`), `step` more than `stepRise`
 * above the street beside it, else `clear`.
 *
 * The street beside it (streetBeside) on both sides, at most `stepRise`
 * apart: their mean, and the rise between them per metre to the right. The
 * rule carcells tried as O1 (report 2026-09-15) for cars on the line.
 *
 * Or on one side only, where the other rises or falls away (a garden or a
 * wall behind a row of parked cars the line runs along, or a quay): then the
 * point must be a bump along the line (raisedAlong), and the line must come
 * down to that street nearby (reachesAlong). A street along the top of a
 * retaining wall or across a steep slope is no bump; a quay below a street
 * is no ground the line comes down to. Playtest 719, Erlenbach
 * (Erlenbacher Weg, way 959083801): the line runs along the south edge of a
 * row of cars with raised ground behind them; the street lies on one side
 * only, and the walk out started on the roofs, so the street beside them
 * was a drop and the corridor frayed there.
 */
function judge(
  points: readonly LinePoint[],
  k: number,
  along: number | null,
  groundAt: (x: number, z: number) => number | null,
): Judged {
  const p = points[k];
  const clear: Judged = { kind: 'clear', ground: null, slope: 0 };
  if (p.run < 0 || p.y === null) return clear;
  const y = p.y;
  if (along !== null && y - along > corridorConfig.roofRise) return { kind: 'roof', ground: along, slope: 0 };
  const right = streetBeside(p, y, 1, groundAt);
  const left = streetBeside(p, y, -1, groundAt);
  if (right && left && Math.abs(right.ground - left.ground) <= corridorConfig.stepRise) {
    return { kind: 'step', ground: (right.ground + left.ground) / 2, slope: (right.ground - left.ground) / (right.at + left.at) };
  }
  const sides = [right, left].filter((side) => side !== null && reachesAlong(points, k, side.ground));
  if (sides.length === 0 || !raisedAlong(points, k)) return clear;
  // Both sides street, at levels further apart than a step: the carriageway beside a raised pavement.
  return { kind: 'step', ground: Math.min(...sides.map((side) => side!.ground)), slope: 0 };
}

/**
 * The street on one side of something on the line at `p`, whose top is at
 * `y` (`sign` 1 right, -1 left): out to OBSTACLE_REACH_M, the first column
 * more than `stepRise` below `y` with the ground 1 m further out no more
 * than `stepDrop` below it. Where it still falls there, the side of a car
 * the photogrammetry slopes down (playtest 719: cells 0.6 m over the street
 * beside the cars), the street may lie up to SKIRT_M further out; a dam or a
 * ridge the street runs along falls further. Null where there is none, or a
 * column on the way is unknown.
 */
function streetBeside(
  p: LinePoint,
  y: number,
  sign: number,
  groundAt: (x: number, z: number) => number | null,
): { at: number; ground: number } | null {
  const { stepRise, stepDrop } = corridorConfig;
  let first = Infinity;
  for (let at = ACROSS_STEP_M; at <= Math.min(OBSTACLE_REACH_M, first + SKIRT_M) + 1e-9; at += ACROSS_STEP_M) {
    const h = groundAt(p.x + p.rx * sign * at, p.z + p.rz * sign * at);
    if (h === null) return null;
    if (y - h <= stepRise) continue;
    const behind = groundAt(p.x + p.rx * sign * (at + 1), p.z + p.rz * sign * (at + 1));
    if (behind === null) return null;
    if (h - behind <= stepDrop) return { at, ground: h };
    first = Math.min(first, at);
  }
  return null;
}

/** Whether the line comes down more than `stepRise` below point `k` within BUMP_REACH_M both before and after it. */
function raisedAlong(points: readonly LinePoint[], k: number): boolean {
  const p = points[k];
  const reach = Math.round(BUMP_REACH_M / DETOUR_SAMPLE_M);
  const low = (j: number) => {
    const q = points[j];
    return q !== undefined && q.run === p.run && q.y !== null && q.y <= p.y! - corridorConfig.stepRise;
  };
  let before = false;
  let after = false;
  for (let j = 1; j <= reach && !(before && after); j++) {
    before ||= low(k - j);
    after ||= low(k + j);
  }
  return before && after;
}

/** Whether the line within BUMP_REACH_M of point `k` comes to within `stepRise` of `ground`. */
function reachesAlong(points: readonly LinePoint[], k: number, ground: number): boolean {
  const p = points[k];
  const reach = Math.round(BUMP_REACH_M / DETOUR_SAMPLE_M);
  for (let j = Math.max(0, k - reach); j <= Math.min(points.length - 1, k + reach); j++) {
    const q = points[j];
    if (q.run === p.run && q.y !== null && Math.abs(q.y - ground) <= corridorConfig.stepRise) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Putting a plan into a route
// ---------------------------------------------------------------------------

interface LatLon {
  lat: number;
  lon: number;
}

/**
 * Where a segment of a route with a detour lies on the route as the street
 * network gives it: on its segment `segment`, from `from` to `to` (0 to 1
 * along it), offset sideways by `offsetFrom` at its start and `offsetTo` at
 * its end (metres, right of travel positive). A segment of the street route
 * as it is: 0, 1 and no offset (wholeSegment).
 */
export interface DetourParent {
  segment: number;
  from: number;
  to: number;
  offsetFrom: number;
  offsetTo: number;
}

/** The parent of segment `i` of a route without a detour on it. */
export function wholeSegment(i: number): DetourParent {
  return { segment: i, from: 0, to: 1, offsetFrom: 0, offsetTo: 0 };
}

/** Whether `parent` is a whole segment of the street route, unchanged. */
export function isWholeSegment(parent: DetourParent): boolean {
  return parent.from === 0 && parent.to === 1 && parent.offsetFrom === 0 && parent.offsetTo === 0;
}

/** A route with a plan put into it, see applyDetourPlan. */
export interface DetouredPath<T extends LatLon> {
  points: T[];
  /** Per segment. */
  parent: DetourParent[];
  /** Per segment, whether it lies in a passage. */
  passage: boolean[];
}

/**
 * `path` (geo, `local` its local x, z) with `plan` put into it: cut where a
 * passage or a piece begins and ends and every RAMP_STEP_M along a ramp,
 * each cut moved sideways by the offset there, at a point of `path` along
 * the mitre of its two segments. `shift(p, dx, dz)` moves a point by local
 * metres. Segments outside the pieces and passages stay as they were, the
 * same points, so what was measured on them still applies.
 */
export function applyDetourPlan<T extends LatLon>(
  path: readonly T[],
  local: readonly { x: number; z: number }[],
  plan: DetourPlan,
  interpolate: (a: T, b: T, f: number) => T,
  shift: (p: T, dx: number, dz: number) => T,
): DetouredPath<T> {
  const segments = path.length - 1;
  const lengths: number[] = [];
  const starts: number[] = [];
  let total = 0;
  for (let i = 0; i < segments; i++) {
    starts.push(total);
    lengths.push(Math.hypot(local[i + 1].x - local[i].x, local[i + 1].z - local[i].z));
    total += lengths[i];
  }
  starts.push(total);
  if (segments < 1 || (plan.pieces.length === 0 && plan.passages.length === 0)) {
    return { points: [...path], parent: Array.from({ length: Math.max(0, segments) }, (_, i) => wholeSegment(i)), passage: new Array(Math.max(0, segments)).fill(false) };
  }

  const right = (i: number) => ({ x: -(local[i + 1].z - local[i].z) / (lengths[i] || 1), z: (local[i + 1].x - local[i].x) / (lengths[i] || 1) });
  // Cuts: the points of the path, where pieces and passages begin and end, and every RAMP_STEP_M along a ramp.
  const cuts = new Set<number>(starts);
  const ends: number[] = [];
  for (const { from, to } of [...plan.pieces, ...plan.passages]) ends.push(from, to);
  for (const m of ends) cuts.add(m);
  for (const piece of plan.pieces) {
    if (piece.offsetFrom === piece.offsetTo) continue;
    const steps = Math.max(1, Math.round((piece.to - piece.from) / RAMP_STEP_M));
    for (let k = 1; k < steps; k++) {
      const m = piece.from + ((piece.to - piece.from) * k) / steps;
      // Leave out a ramp point right next to a point of the path or an end.
      if ([...starts, ...ends].some((c) => Math.abs(c - m) < RAMP_STEP_M / 2)) continue;
      cuts.add(m);
    }
  }
  const sorted = [...cuts].filter((m) => m >= 0 && m <= total).sort(ascending);

  const segmentAt = (m: number): number => {
    let i = 0;
    while (i < segments - 1 && m >= starts[i + 1]) i++;
    return i;
  };
  const inPassage = (m: number) => plan.passages.some((p) => p.from <= m && m <= p.to);

  const points: T[] = [];
  const at: { i: number; t: number; offset: number }[] = [];
  for (const m of sorted) {
    const offset = offsetAt(plan, m);
    const joint = starts.findIndex((start) => Math.abs(start - m) < 1e-9);
    if (joint >= 0) {
      if (offset === 0) points.push(path[joint]);
      else {
        // Along the mitre of the segments before and after the point.
        const a = right(Math.max(0, joint - 1));
        const b = right(Math.min(segments - 1, joint));
        const dot = a.x * b.x + a.z * b.z;
        const scale = 1 + dot > 0.2 ? 1 / (1 + dot) : 0.5;
        points.push(shift(path[joint], (a.x + b.x) * scale * offset, (a.z + b.z) * scale * offset));
      }
      at.push({ i: joint, t: 0, offset });
      continue;
    }
    const i = segmentAt(m);
    const t = (m - starts[i]) / lengths[i];
    const onLine = interpolate(path[i], path[i + 1], t);
    const n = right(i);
    points.push(offset === 0 ? onLine : shift(onLine, n.x * offset, n.z * offset));
    at.push({ i, t, offset });
  }

  const parent: DetourParent[] = [];
  const passage: boolean[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const mid = (sorted[k] + sorted[k + 1]) / 2;
    const i = segmentAt(mid);
    const t = (m: number) => Math.min(1, Math.max(0, (m - starts[i]) / lengths[i]));
    parent.push({ segment: i, from: t(sorted[k]), to: t(sorted[k + 1]), offsetFrom: at[k].offset, offsetTo: at[k + 1].offset });
    passage.push(inPassage(mid));
  }
  return { points, parent, passage };
}

/** What a clearance measurement holds for one segment (PathAndRouteService.clearanceBySegment). */
export interface SegmentClearance {
  left: number[];
  right: number[];
  probes: (StationProbe | null)[];
}

/**
 * What the measurement of a segment of the street route (`measured`) gives
 * a piece of it that `parent` describes: stations about as far apart as on
 * the segment, each with the free space of the segment's station there,
 * moved by the offset of the piece at it (a wall on the left lies further
 * from a path moved to the right, one on the right nearer). A ray that hit
 * nothing reports its length, so on the side the path moves to the corridor
 * reaches no further out than the rays saw. Unmeasured stays unmeasured.
 */
export function derivedClearance(measured: SegmentClearance, parent: DetourParent): SegmentClearance {
  const n = measured.left.length;
  if (n === 0) return measured;
  const count = Math.max(1, Math.round((parent.to - parent.from) * n));
  const left: number[] = [];
  const right: number[] = [];
  const probes: (StationProbe | null)[] = [];
  for (let q = 0; q < count; q++) {
    const f = (q + 0.5) / count;
    const k = Math.min(n - 1, Math.floor((parent.from + (parent.to - parent.from) * f) * n));
    const offset = parent.offsetFrom + (parent.offsetTo - parent.offsetFrom) * f;
    const moved = (d: number, sign: number) => Math.max(0, d + sign * offset);
    left.push(Number.isNaN(measured.left[k]) ? NaN : moved(measured.left[k], 1));
    right.push(Number.isNaN(measured.right[k]) ? NaN : moved(measured.right[k], -1));
    const probe = measured.probes[k];
    probes.push(probe && probe.unmeasured === null
      ? { ...probe, left: probe.left.map((d) => moved(d, 1)), right: probe.right.map((d) => moved(d, -1)) }
      : probe);
  }
  return { left, right, probes };
}
