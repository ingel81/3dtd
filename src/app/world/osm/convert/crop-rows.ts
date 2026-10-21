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
 * Each row is cut by the parcel's rings into runs and ends a little inside
 * the boundary; what may not carry a plant (a road, a path, a ditch, a
 * building, water) breaks a run in two. Pure: the ground, the roads and what
 * is free come in as functions and lines, the same input gives the same rows.
 */
import type { MapPoint } from '../../custom-map/map-document';
import { pointInRing } from './raster';

/** Ground rising at least this much per metre is a slope the rows run down */
export const ROW_SLOPE = 0.08;
/** On a slope the rows stay square to the serving road while that is within this of the fall line (radians, 35 degrees) */
export const ROAD_SNAP = (35 * Math.PI) / 180;
/** A road whose centre line lies within this of the parcel's edge serves it, metres */
export const ROAD_REACH = 14;
/** Metres a row ends inside the parcel's edge (its end post stands there) */
export const ROW_END_GAP = 0.6;
/** Metres between the checks along a row for what breaks it */
export const ROW_CHECK_STEP = 1;
/** Shortest run kept, metres */
export const LEAST_RUN = 3;

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
    .map((ring) => ({ outer: ring, inner: inner.filter((h) => h.length >= 3 && pointInRing(h[0], ring)) }));
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
export function foldAngle(a: number): number {
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
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sh = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  const hs: number[] = [];
  for (let y = box.minY + step / 2; y < box.maxY; y += step) {
    for (let x = box.minX + step / 2; x < box.maxX; x += step) {
      const q = { x, y };
      if (!pointInRing(q, p.outer) || p.inner.some((h) => pointInRing(q, h))) continue;
      const h = heightAt(x, y);
      xs.push(x);
      ys.push(y);
      hs.push(h);
      sx += x;
      sy += y;
      sh += h;
      n++;
    }
  }
  if (n < 3) return null;
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
export function servingRoad(p: Parcel, roads: RoadIndex | null): number | null {
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

/** Which way the rows of a parcel run (see the file's comment) */
export function rowDirection(p: Parcel, heightAt: (x: number, y: number) => number, roads: RoadIndex | null): RowDirection {
  const fall = fallLine(p, heightAt);
  const road = servingRoad(p, roads);
  const square = road === null ? null : foldAngle(road + Math.PI / 2);
  const grade = fall?.grade ?? 0;
  if (fall && grade >= ROW_SLOPE) {
    if (square !== null && angleBetween(square, fall.angle) <= ROAD_SNAP) return { angle: square, reason: 'road', grade };
    return { angle: foldAngle(fall.angle), reason: 'slope', grade };
  }
  if (square !== null) return { angle: square, reason: 'road', grade };
  return { angle: longestSide(p.outer), reason: 'side', grade };
}

/**
 * The runs of the rows `across` metres apart in direction `angle`: each row
 * line cut by the parcel's rings (even-odd), pulled in ROW_END_GAP at both
 * ends, and broken where `free` says no (checked every ROW_CHECK_STEP); runs
 * shorter than LEAST_RUN are dropped. Rows sit on lines at whole multiples
 * of `across` from the map's origin, so the same parcel gives the same rows
 */
export function rowRuns(p: Parcel, angle: number, across: number, free: (x: number, y: number) => boolean): RowRun[] {
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
  const out: RowRun[] = [];
  const at = (sv: number, bv: number): MapPoint => ({ x: sv * ux - bv * uy, y: sv * uy + bv * ux });
  const cuts: number[] = [];
  for (let bv = Math.ceil((minB + across / 2) / across) * across; bv <= maxB - across / 2 + 1e-9; bv += across) {
    cuts.length = 0;
    for (const r of rings) {
      for (let k = 0, m = r.length - 1; k < r.length; m = k++) {
        const b0 = b(r[m]);
        const b1 = b(r[k]);
        if (b0 > bv === b1 > bv) continue;
        const s0 = s(r[m]);
        const s1 = s(r[k]);
        cuts.push(s0 + ((bv - b0) / (b1 - b0)) * (s1 - s0));
      }
    }
    cuts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const s0 = cuts[k] + ROW_END_GAP;
      const s1 = cuts[k + 1] - ROW_END_GAP;
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
      for (let k2 = 0; k2 <= steps; k2++) {
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
