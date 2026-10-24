/**
 * Rows of a crop on its parcel (vineyards, orchards; docs/OSM_WORLD_PLAN.md,
 * Pflanzen): straight, parallel rows across the whole parcel, the way they
 * are planted. One direction per parcel:
 *
 * - on a slope down the fall line (the plane fitted to the ground inside
 *   the parcel), unless the road that serves the parcel runs nearly along
 *   the contour: then square to that road, which is the fall line as the
 *   rows were laid out against it;
 * - on flat ground square to the road that serves the parcel (the roads
 *   along its edge), without one along the parcel's longest side.
 *
 * Vineyards (VINE_ROWS) run down the fall line as a fixed rule, from a gentle
 * slope on and whatever the road does; a parcel whose ground turns (a
 * hillside round a spur, a collective area over a whole slope) is cut into
 * blocks of BLOCK_CELL squares that fall the same way, each with straight
 * rows of its own and a lane to the next (rowBlocks).
 *
 * Each row is cut by the parcel's rings into runs and ends a little inside
 * the boundary; what may not carry a plant (a road, a path, a ditch, a
 * building, water) breaks a run in two. Pure: the ground, the roads and what
 * is free come in as functions and lines, the same input gives the same rows.
 */
import type { MapPoint } from '../../custom-map/map-document';
import { insideRing } from '../../custom-map/map-surfaces';

/** Ground rising at least this much per metre is a slope the rows run down */
const ROW_SLOPE = 0.08;
/** On a slope the rows stay square to the serving road while that is within this of the fall line (radians, 35 degrees) */
const ROAD_SNAP = (35 * Math.PI) / 180;
/** A road whose centre line lies within this of the parcel's edge serves it, metres */
const ROAD_REACH = 14;
/** Metres a row ends inside the parcel's edge (its end post stands there) */
export const ROW_END_GAP = 0.6;
/** Metres between the checks along a row for what breaks it */
const ROW_CHECK_STEP = 1;
/** Shortest run kept, metres */
export const LEAST_RUN = 3;
/**
 * Vineyards: ground rising at least this much per metre is a slope their rows run down. Water and cold air run off
 * down the rows and a tractor drives up and down, never across, from a few percent on; over a block's 60 m window
 * 3 % is 1.8 m of height, far above the decimetres the elevation tiles are off, so the fall line read is no noise
 */
const VINE_SLOPE = 0.03;
/** Side of the squares a vineyard's ground is read in for its blocks, metres */
const BLOCK_CELL = 40;
/** Squares whose fall lines lie within this of a block's steepest square join it (radians, 12 degrees) */
const BLOCK_JOIN = (12 * Math.PI) / 180;
/** Metres the rows of a block end short of a block that runs another way: half the lane between them */
export const BLOCK_GAP = 1.5;
/** Checks along a row between the coarse looks of a block's `near` (rowRuns), metres at ROW_CHECK_STEP */
const NEAR_EVERY = 8;

/** How a crop's rows choose their way */
export interface RowRule {
  /** Rise per metre from which the rows run down the fall line */
  slope: number;
  /** On a slope the rows stay square to the serving road while that is within this of the fall line, radians; 0: never */
  roadSnap: number;
  /** A parcel whose ground turns is cut into blocks that fall the same way (rowBlocks) */
  blocks: boolean;
}

/** Orchards: one way per parcel, the serving road kept on a slope */
export const CROP_ROWS: RowRule = { slope: ROW_SLOPE, roadSnap: ROAD_SNAP, blocks: false };
/** Vineyards: down the local fall line from VINE_SLOPE on, whatever the road does */
export const VINE_ROWS: RowRule = { slope: VINE_SLOPE, roadSnap: 0, blocks: true };

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Part of a parcel whose rows run one way */
export interface RowBlock extends RowDirection {
  /** Where its rows may stand, the box that holds it and a coarse test round it (rowRuns); absent: the whole parcel */
  area?: { holds: (x: number, y: number) => boolean; box: Box; near: (x: number, y: number) => boolean };
}

/** One parcel: an outer ring and the holes inside it */
export interface Parcel {
  outer: readonly MapPoint[];
  inner: readonly (readonly MapPoint[])[];
}

/** Why the rows run as they do */
export type RowReason = 'slope' | 'road' | 'side';

export interface RowDirection {
  /** Direction of the rows, radians from map +x (east), in [0, pi) */
  angle: number;
  reason: RowReason;
  /** Rise of the fitted ground per metre */
  grade: number;
}

/** A straight run of a row between its two end posts */
export interface RowRun {
  a: MapPoint;
  b: MapPoint;
  length: number;
}

/** The parcels of an area: each outer ring with the inner rings that lie in it */
export function parcelsOf(outer: readonly (readonly MapPoint[])[], inner: readonly (readonly MapPoint[])[]): Parcel[] {
  return outer
    .filter((r) => r.length >= 3)
    .map((ring) => ({ outer: ring, inner: inner.filter((h) => h.length >= 3 && insideRing(h[0], ring)) }));
}

/**
 * The road lines near a parcel, looked up by a coarse grid of their
 * segments: built once for all parcels of a map
 */
export class RoadIndex {
  private readonly cells = new Map<number, number[]>();
  /** Segments as x0, y0, x1, y1 */
  private readonly segs: number[] = [];

  constructor(lines: readonly (readonly MapPoint[])[], private readonly cell = 32) {
    for (const line of lines) {
      for (let k = 1; k < line.length; k++) {
        const a = line[k - 1];
        const b = line[k];
        const id = this.segs.length / 4;
        this.segs.push(a.x, a.y, b.x, b.y);
        const i0 = Math.floor(Math.min(a.x, b.x) / cell);
        const i1 = Math.floor(Math.max(a.x, b.x) / cell);
        const j0 = Math.floor(Math.min(a.y, b.y) / cell);
        const j1 = Math.floor(Math.max(a.y, b.y) / cell);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const key = this.key(i, j);
            const list = this.cells.get(key);
            if (list) list.push(id);
            else this.cells.set(key, [id]);
          }
        }
      }
    }
  }

  private key(i: number, j: number): number {
    return (j + 4096) * 8192 + (i + 4096);
  }

  /** The direction (radians, mod pi) of the nearest road segment within `reach` of a point, null without one */
  nearestDirection(x: number, y: number, reach: number): number | null {
    const c = this.cell;
    let best = reach * reach;
    let angle: number | null = null;
    for (let j = Math.floor((y - reach) / c); j <= Math.floor((y + reach) / c); j++) {
      for (let i = Math.floor((x - reach) / c); i <= Math.floor((x + reach) / c); i++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const id of list) {
          const s = this.segs;
          const ax = s[id * 4];
          const ay = s[id * 4 + 1];
          const dx = s[id * 4 + 2] - ax;
          const dy = s[id * 4 + 3] - ay;
          const len2 = dx * dx + dy * dy;
          if (len2 < 1e-6) continue;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
          const ex = ax + dx * t - x;
          const ey = ay + dy * t - y;
          const d2 = ex * ex + ey * ey;
          if (d2 < best) {
            best = d2;
            angle = Math.atan2(dy, dx);
          }
        }
      }
    }
    return angle;
  }
}

/** An angle folded into [0, pi): a row has no way round */
function foldAngle(a: number): number {
  const m = a % Math.PI;
  return m < 0 ? m + Math.PI : m;
}

/** Smallest turn between two row directions (mod pi), radians in [0, pi/2] */
export function angleBetween(a: number, b: number): number {
  const d = Math.abs(foldAngle(a) - foldAngle(b));
  return Math.min(d, Math.PI - d);
}

/**
 * The dominant direction of weighted line directions (mod pi): the heaviest
 * of 36 bins of 5 degrees with its neighbours, and the weighted mean of the
 * directions in those three bins (on doubled angles, so 179 and 1 degree
 * agree). Null without weight
 */
function dominant(angles: readonly number[], weights: readonly number[]): number | null {
  const BINS = 36;
  const bins = new Float64Array(BINS);
  let total = 0;
  for (let k = 0; k < angles.length; k++) {
    bins[Math.min(BINS - 1, Math.floor((foldAngle(angles[k]) / Math.PI) * BINS))] += weights[k];
    total += weights[k];
  }
  if (total <= 0) return null;
  let best = 0;
  let bestWeight = -1;
  for (let b = 0; b < BINS; b++) {
    const w = bins[(b + BINS - 1) % BINS] + bins[b] + bins[(b + 1) % BINS];
    if (w > bestWeight) {
      bestWeight = w;
      best = b;
    }
  }
  let cx = 0;
  let cy = 0;
  for (let k = 0; k < angles.length; k++) {
    const b = Math.min(BINS - 1, Math.floor((foldAngle(angles[k]) / Math.PI) * BINS));
    const off = Math.min((b - best + BINS) % BINS, (best - b + BINS) % BINS);
    if (off > 1) continue;
    cx += Math.cos(2 * angles[k]) * weights[k];
    cy += Math.sin(2 * angles[k]) * weights[k];
  }
  return foldAngle(Math.atan2(cy, cx) / 2);
}

/** The direction of a ring's longest side: its edges by length, nearly straight runs of nodes counting as one side */
export function longestSide(ring: readonly MapPoint[]): number {
  const angles: number[] = [];
  const weights: number[] = [];
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    angles.push(Math.atan2(b.y - a.y, b.x - a.x));
    weights.push(len);
  }
  return dominant(angles, weights) ?? 0;
}

/** The plane fitted to the ground inside a parcel: its fall (downhill) direction and rise per metre, from a lattice of up to ~400 samples */
export function fallLine(p: Parcel, heightAt: (x: number, y: number) => number): { angle: number; grade: number } | null {
  const box = boundsOf(p.outer);
  const step = Math.max(2, Math.sqrt(((box.maxX - box.minX) * (box.maxY - box.minY)) / 400));
  const xs: number[] = [];
  const ys: number[] = [];
  const hs: number[] = [];
  for (let y = box.minY + step / 2; y < box.maxY; y += step) {
    for (let x = box.minX + step / 2; x < box.maxX; x += step) {
      const q = { x, y };
      if (!insideRing(q, p.outer) || p.inner.some((h) => insideRing(q, h))) continue;
      xs.push(x);
      ys.push(y);
      hs.push(heightAt(x, y));
    }
  }
  return planeOf(xs, ys, hs);
}

/** The plane through heights at points by least squares: its fall (downhill) direction and rise per metre, null for too few or a line */
function planeOf(xs: readonly number[], ys: readonly number[], hs: readonly number[]): { angle: number; grade: number } | null {
  const n = xs.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  let sh = 0;
  for (let k = 0; k < n; k++) {
    sx += xs[k];
    sy += ys[k];
    sh += hs[k];
  }
  const mx = sx / n;
  const my = sy / n;
  const mh = sh / n;
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let xh = 0;
  let yh = 0;
  for (let k = 0; k < n; k++) {
    const dx = xs[k] - mx;
    const dy = ys[k] - my;
    const dh = hs[k] - mh;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
    xh += dx * dh;
    yh += dy * dh;
  }
  const det = xx * yy - xy * xy;
  if (Math.abs(det) < 1e-9) return null;
  const gx = (xh * yy - yh * xy) / det;
  const gy = (yh * xx - xh * xy) / det;
  return { angle: Math.atan2(-gy, -gx), grade: Math.hypot(gx, gy) };
}

/** The direction of the roads that serve a parcel: of its edge, sampled every 2 m, the parts within ROAD_REACH of a road vote with that road's direction */
function servingRoad(p: Parcel, roads: RoadIndex | null): number | null {
  if (!roads) return null;
  const angles: number[] = [];
  const weights: number[] = [];
  const ring = p.outer;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.round(len / 2));
    for (let s = 0; s < steps; s++) {
      const t = (s + 0.5) / steps;
      const d = roads.nearestDirection(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, ROAD_REACH);
      if (d === null) continue;
      angles.push(d);
      weights.push(len / steps);
    }
  }
  return dominant(angles, weights);
}

/** Which way the rows of a parcel run (see the file's comment), as one block */
export function rowDirection(p: Parcel, heightAt: (x: number, y: number) => number, roads: RoadIndex | null, rule: RowRule = CROP_ROWS): RowDirection {
  const fall = fallLine(p, heightAt);
  const road = servingRoad(p, roads);
  const square = road === null ? null : foldAngle(road + Math.PI / 2);
  const grade = fall?.grade ?? 0;
  if (fall && grade >= rule.slope) {
    if (square !== null && rule.roadSnap > 0 && angleBetween(square, fall.angle) <= rule.roadSnap) return { angle: square, reason: 'road', grade };
    return { angle: foldAngle(fall.angle), reason: 'slope', grade };
  }
  if (square !== null) return { angle: square, reason: 'road', grade };
  return { angle: longestSide(p.outer), reason: 'side', grade };
}

/**
 * The blocks of a parcel whose rows run one way each. Without `rule.blocks`, or where every BLOCK_CELL square of the
 * parcel falls with the parcel's plane (within BLOCK_JOIN) or every one is flat, the whole parcel (rowDirection).
 * Else each square reads the plane of the ground in a window of 1.5 squares round it; from the steepest square not
 * yet taken a block grows over the neighbours (sides, not corners) that fall within BLOCK_JOIN of it, and runs down
 * their mean fall line. The flat squares (under `rule.slope`) are one block that runs as the flat parcel would. A
 * block's rows end BLOCK_GAP short of another block: a lane, as between the blocks of a real hillside
 */
export function rowBlocks(p: Parcel, heightAt: (x: number, y: number) => number, roads: RoadIndex | null, rule: RowRule = CROP_ROWS): RowBlock[] {
  const whole = rowDirection(p, heightAt, roads, rule);
  if (!rule.blocks) return [whole];
  const squares = squarePlanes(p, heightAt);
  if (!squares || agreesWhole(squares, p, whole, rule)) return [whole];
  return blockAreas(squares, growRegions(squares, p, roads, rule), rule);
}

/** The BLOCK_CELL squares over a parcel's box, each with its ground's plane: the fall's x and y and its grade */
interface SquarePlanes {
  c: number;
  i0: number;
  j0: number;
  nx: number;
  ny: number;
  gx: Float64Array;
  gy: Float64Array;
  grade: Float64Array;
}

/** The squares' blocks: which block each square is in, the blocks and their squares' boxes, the flat block's id (-1: none) */
interface SquareRegions {
  region: Int32Array;
  blocks: RowBlock[];
  boxes: Box[];
  flat: number;
}

/** The plane of each square's window: 7 x 7 heights 10 m apart round its middle; null for a parcel in one square */
function squarePlanes(p: Parcel, heightAt: (x: number, y: number) => number): SquarePlanes | null {
  const c = BLOCK_CELL;
  const box = boundsOf(p.outer);
  const i0 = Math.floor(box.minX / c);
  const j0 = Math.floor(box.minY / c);
  const nx = Math.floor(box.maxX / c) - i0 + 1;
  const ny = Math.floor(box.maxY / c) - j0 + 1;
  if (nx * ny <= 1) return null;
  const n = nx * ny;
  const gx = new Float64Array(n);
  const gy = new Float64Array(n);
  const grade = new Float64Array(n);
  const xs: number[] = [];
  const ys: number[] = [];
  const hs: number[] = [];
  const reach = (1.5 * c) / 2;
  const LATTICE = 7;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const mx = (i0 + i + 0.5) * c;
      const my = (j0 + j + 0.5) * c;
      xs.length = ys.length = hs.length = 0;
      for (let b = 0; b < LATTICE; b++) {
        for (let a = 0; a < LATTICE; a++) {
          const x = mx - reach + (2 * reach * a) / (LATTICE - 1);
          const y = my - reach + (2 * reach * b) / (LATTICE - 1);
          xs.push(x);
          ys.push(y);
          hs.push(heightAt(x, y));
        }
      }
      const plane = planeOf(xs, ys, hs);
      const k = j * nx + i;
      if (!plane) continue;
      gx[k] = Math.cos(plane.angle) * plane.grade;
      gy[k] = Math.sin(plane.angle) * plane.grade;
      grade[k] = plane.grade;
    }
  }
  return { c, i0, j0, nx, ny, gx, gy, grade };
}

/** Whether the squares the parcel covers agree with its own plane (a square counts by its middle or a corner): then it is one block */
function agreesWhole(squares: SquarePlanes, p: Parcel, whole: RowBlock, rule: RowRule): boolean {
  const { c, i0, j0, nx, ny, gx, gy, grade } = squares;
  const covers = (i: number, j: number) => {
    for (const [u, v] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1]]) if (insideRing({ x: (i0 + i + u) * c, y: (j0 + j + v) * c }, p.outer)) return true;
    return false;
  };
  let agree = true;
  for (let j = 0; j < ny && agree; j++) {
    for (let i = 0; i < nx && agree; i++) {
      if (!covers(i, j)) continue;
      const k = j * nx + i;
      const sloped = grade[k] >= rule.slope;
      if (whole.reason === 'slope' ? !sloped || angleBetween(Math.atan2(gy[k], gx[k]), whole.angle) > BLOCK_JOIN : sloped) agree = false;
    }
  }
  return agree;
}

/**
 * The squares grown into blocks, the steepest first: a sloped block takes its neighbours falling the same way
 * (within BLOCK_JOIN); the flat squares are one block, square to the serving road or along the longest side
 */
function growRegions(squares: SquarePlanes, p: Parcel, roads: RoadIndex | null, rule: RowRule): SquareRegions {
  const { c, i0, j0, nx, ny, gx, gy, grade } = squares;
  const n = nx * ny;
  const region = new Int32Array(n).fill(-1);
  const order = Array.from({ length: n }, (_, k) => k).sort((a, b) => grade[b] - grade[a] || a - b);
  const blocks: RowBlock[] = [];
  const boxes: Box[] = [];
  const grow = (id: number, k: number) => {
    region[k] = id;
    const i = k % nx;
    const j = (k - i) / nx;
    const b = boxes[id];
    b.minX = Math.min(b.minX, (i0 + i) * c);
    b.minY = Math.min(b.minY, (j0 + j) * c);
    b.maxX = Math.max(b.maxX, (i0 + i + 1) * c);
    b.maxY = Math.max(b.maxY, (j0 + j + 1) * c);
  };
  let flat = -1;
  for (const seed of order) {
    if (region[seed] >= 0) continue;
    if (grade[seed] < rule.slope) {
      // The flat squares: one block, square to the serving road or along the longest side as the flat parcel
      if (flat < 0) {
        flat = blocks.length;
        const road = servingRoad(p, roads);
        blocks.push(road === null ? { angle: longestSide(p.outer), reason: 'side', grade: 0 } : { angle: foldAngle(road + Math.PI / 2), reason: 'road', grade: 0 });
        boxes.push({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
      }
      grow(flat, seed);
      continue;
    }
    const id = blocks.length;
    const toward = Math.atan2(gy[seed], gx[seed]);
    boxes.push({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    let sx = 0;
    let sy = 0;
    let count = 0;
    const queue = [seed];
    grow(id, seed);
    while (queue.length) {
      const k = queue.pop()!;
      sx += gx[k];
      sy += gy[k];
      count++;
      const i = k % nx;
      const j = (k - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const m = b * nx + a;
        if (region[m] >= 0 || grade[m] < rule.slope || angleBetween(Math.atan2(gy[m], gx[m]), toward) > BLOCK_JOIN) continue;
        grow(id, m);
        queue.push(m);
      }
    }
    blocks.push({ angle: foldAngle(Math.atan2(sy, sx)), reason: 'slope', grade: Math.hypot(sx, sy) / count });
  }
  return { region, blocks, boxes, flat };
}

/**
 * Each block's area: a point goes to the block, of those of the four squares round it, that runs nearest the fall
 * line there (the squares' planes blended by distance), to the flat one where the blend is flat: the borders between
 * blocks bend with the ground instead of stepping along the squares. A block holds a point in its own part and
 * BLOCK_GAP short of another block's
 */
function blockAreas(squares: SquarePlanes, regions: SquareRegions, rule: RowRule): RowBlock[] {
  const { c, i0, j0, nx, ny, gx, gy } = squares;
  const { region, blocks, boxes, flat } = regions;
  // `whole4`: the four squares round the point were one block and it lies at least BLOCK_GAP inside their middles,
  // so the lane needs no look
  let whole4 = false;
  const lane = BLOCK_GAP / c;
  const twice = new Float64Array(blocks.length * 2);
  blocks.forEach((b, id) => {
    twice[2 * id] = Math.cos(2 * b.angle);
    twice[2 * id + 1] = Math.sin(2 * b.angle);
  });
  const at = (x: number, y: number) => {
    whole4 = false;
    const fx = x / c - i0 - 0.5;
    const fy = y / c - j0 - 0.5;
    const ia = Math.floor(fx);
    const ja = Math.floor(fy);
    if (ia < -1 || ja < -1 || ia >= nx || ja >= ny) return -1;
    const tx = fx - ia;
    const ty = fy - ja;
    const i1 = Math.max(0, ia);
    const i2 = Math.min(nx - 1, ia + 1);
    const j1 = Math.max(0, ja) * nx;
    const j2 = Math.min(ny - 1, ja + 1) * nx;
    const k00 = j1 + i1;
    const k10 = j1 + i2;
    const k01 = j2 + i1;
    const k11 = j2 + i2;
    const r = region[k00];
    if (r === region[k10] && r === region[k01] && r === region[k11]) {
      whole4 = tx >= lane && tx <= 1 - lane && ty >= lane && ty <= 1 - lane;
      return r;
    }
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    const bx = gx[k00] * w00 + gx[k10] * w10 + gx[k01] * w01 + gx[k11] * w11;
    const by = gy[k00] * w00 + gy[k10] * w10 + gy[k01] * w01 + gy[k11] * w11;
    const sloped = bx * bx + by * by >= rule.slope * rule.slope;
    // Nearest way as the largest dot product of the doubled angles (a row has no way round)
    const tx2 = bx * bx - by * by;
    const ty2 = 2 * bx * by;
    let best = -1;
    let bestDot = -Infinity;
    let hasFlat = false;
    for (let q = 0; q < 4; q++) {
      const id = region[q === 0 ? k00 : q === 1 ? k10 : q === 2 ? k01 : k11];
      if (id === flat) {
        hasFlat = true;
        continue;
      }
      const dot = twice[2 * id] * tx2 + twice[2 * id + 1] * ty2;
      if (dot > bestDot || (dot === bestDot && id < best)) {
        bestDot = dot;
        best = id;
      }
    }
    return hasFlat && (!sloped || best < 0) ? flat : best;
  };
  const other = (id: number, x: number, y: number) => {
    const r = at(x, y);
    return r >= 0 && r !== id;
  };
  // In its own part and BLOCK_GAP short of another block's
  const holds = (id: number, x: number, y: number) => {
    if (at(x, y) !== id) return false;
    if (whole4) return true;
    return !other(id, x + BLOCK_GAP, y) && !other(id, x - BLOCK_GAP, y) && !other(id, x, y + BLOCK_GAP) && !other(id, x, y - BLOCK_GAP);
  };
  // A block reaches at most half a square past its own squares (along each axis), so every point within NEAR_EVERY
  // of one of its points lies within half a square and NEAR_EVERY of them: `near`, the rows' coarse look
  const half = c / 2;
  const reachOut = half + NEAR_EVERY * ROW_CHECK_STEP;
  return blocks.map((b, id) => {
    const wide = boxes[id];
    const box = { minX: wide.minX - half, minY: wide.minY - half, maxX: wide.maxX + half, maxY: wide.maxY + half };
    const near = (x: number, y: number) => {
      const i = Math.floor(x / c) - i0;
      const j = Math.floor(y / c) - j0;
      for (let v = Math.max(0, j - 1); v <= Math.min(ny - 1, j + 1); v++) {
        for (let u = Math.max(0, i - 1); u <= Math.min(nx - 1, i + 1); u++) {
          if (region[v * nx + u] !== id) continue;
          const ox = (i0 + u) * c;
          const oy = (j0 + v) * c;
          if (Math.max(ox - x, x - ox - c, oy - y, y - oy - c) <= reachOut) return true;
        }
      }
      return false;
    };
    return { ...b, area: { holds: (x: number, y: number) => holds(id, x, y), box, near } };
  });
}

/**
 * The runs of the rows `across` metres apart in direction `angle`: each row
 * line cut by the parcel's rings (even-odd), pulled in ROW_END_GAP at both
 * ends, and broken where `free` says no (checked every ROW_CHECK_STEP); runs
 * shorter than LEAST_RUN are dropped. Rows sit on lines at whole multiples
 * of `across` from the map's origin, so the same parcel gives the same rows.
 * With a block (rowBlocks) only the rows and the stretches of them inside its
 * box are walked, and only where its coarse look finds it near
 */
export function rowRuns(
  p: Parcel,
  angle: number,
  across: number,
  free: (x: number, y: number) => boolean,
  block?: { box: Box; near: (x: number, y: number) => boolean },
): RowRun[] {
  const box = block?.box;
  const near = block?.near;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const rings = [p.outer, ...p.inner];
  // Along (s) and across (b) the rows
  const s = (q: MapPoint) => q.x * ux + q.y * uy;
  const b = (q: MapPoint) => -q.x * uy + q.y * ux;
  let minB = Infinity;
  let maxB = -Infinity;
  for (const q of p.outer) {
    const v = b(q);
    if (v < minB) minB = v;
    if (v > maxB) maxB = v;
  }
  let lowS = -Infinity;
  let highS = Infinity;
  let lowB = minB + across / 2;
  let highB = maxB - across / 2;
  if (box) {
    const corners = [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.minX, y: box.maxY },
      { x: box.maxX, y: box.maxY },
    ];
    lowS = Math.min(...corners.map(s));
    highS = Math.max(...corners.map(s));
    lowB = Math.max(lowB, Math.min(...corners.map(b)));
    highB = Math.min(highB, Math.max(...corners.map(b)));
  }
  const out: RowRun[] = [];
  const at = (sv: number, bv: number): MapPoint => ({ x: sv * ux - bv * uy, y: sv * uy + bv * ux });
  // The ring edges that reach into the band of rows walked, as s0, b0, s1, b1: a block of a large area crosses
  // few of its edges
  const edges: number[] = [];
  for (const r of rings) {
    for (let k = 0, m = r.length - 1; k < r.length; m = k++) {
      const b0 = b(r[m]);
      const b1 = b(r[k]);
      if (Math.max(b0, b1) < lowB || Math.min(b0, b1) > highB + 1e-9) continue;
      edges.push(s(r[m]), b0, s(r[k]), b1);
    }
  }
  const cuts: number[] = [];
  for (let bv = Math.ceil(lowB / across) * across; bv <= highB + 1e-9; bv += across) {
    cuts.length = 0;
    for (let e = 0; e < edges.length; e += 4) {
      const b0 = edges[e + 1];
      const b1 = edges[e + 3];
      if (b0 > bv === b1 > bv) continue;
      const s0 = edges[e];
      cuts.push(s0 + ((bv - b0) / (b1 - b0)) * (edges[e + 2] - s0));
    }
    cuts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const s0 = Math.max(cuts[k] + ROW_END_GAP, lowS);
      const s1 = Math.min(cuts[k + 1] - ROW_END_GAP, highS);
      if (s1 - s0 < LEAST_RUN) continue;
      // Walk the span: a stretch of free checks is a run, from its first free check to its last
      const steps = Math.max(1, Math.ceil((s1 - s0) / ROW_CHECK_STEP));
      let start = -1;
      let last = -1;
      const close = () => {
        if (start < 0) return;
        const a0 = s0 + ((s1 - s0) * start) / steps;
        const a1 = s0 + ((s1 - s0) * last) / steps;
        if (a1 - a0 >= LEAST_RUN) out.push({ a: at(a0, bv), b: at(a1, bv), length: a1 - a0 });
        start = -1;
      };
      // A block's coarse look every NEAR_EVERY checks: a check with neither look on either side near is not free
      const looks: boolean[] = [];
      if (near) {
        for (let k2 = 0; k2 <= steps + NEAR_EVERY; k2 += NEAR_EVERY) {
          const q = at(s0 + ((s1 - s0) * Math.min(k2, steps)) / steps, bv);
          looks.push(near(q.x, q.y));
        }
      }
      for (let k2 = 0; k2 <= steps; k2++) {
        if (near && !looks[Math.floor(k2 / NEAR_EVERY)] && !looks[Math.floor(k2 / NEAR_EVERY) + 1]) {
          close();
          continue;
        }
        const q = at(s0 + ((s1 - s0) * k2) / steps, bv);
        if (free(q.x, q.y)) {
          if (start < 0) start = k2;
          last = k2;
        } else close();
      }
      close();
    }
  }
  return out;
}

/** A run cut into `along`-metre pieces of equal length (one where it is shorter): their middles and how much each is stretched */
export function runPieces(run: RowRun, along: number): { x: number; y: number; stretch: number }[] {
  const n = Math.max(1, Math.round(run.length / along));
  const piece = run.length / n;
  const dx = (run.b.x - run.a.x) / run.length;
  const dy = (run.b.y - run.a.y) / run.length;
  const out: { x: number; y: number; stretch: number }[] = [];
  for (let k = 0; k < n; k++) {
    const d = (k + 0.5) * piece;
    out.push({ x: run.a.x + dx * d, y: run.a.y + dy * d, stretch: piece / along });
  }
  return out;
}

/** Plants every `along` metres on a run, the spare length split between both ends */
export function runPlants(run: RowRun, along: number): MapPoint[] {
  const n = Math.floor(run.length / along) + 1;
  const start = (run.length - (n - 1) * along) / 2;
  const dx = (run.b.x - run.a.x) / run.length;
  const dy = (run.b.y - run.a.y) / run.length;
  const out: MapPoint[] = [];
  for (let k = 0; k < n; k++) out.push({ x: run.a.x + dx * (start + k * along), y: run.a.y + dy * (start + k * along) });
  return out;
}

function boundsOf(ring: readonly MapPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}
