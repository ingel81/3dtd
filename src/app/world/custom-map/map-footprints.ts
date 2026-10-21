/**
 * The building footprints an OSM world keeps from its import
 * (CustomMapDocument.footprints, TODO E290): written by the import, read by
 * the developer layer that lays them over the buildings (CustomMapStreets,
 * BuildingOverlay). Layout of `rings`: per ring its point count, its
 * storeys, then its points as x, y in decimetres.
 */
import type { MapFootprints, MapPoint } from './map-document';

/** One footprint read back: its outer ring (not closed, metres) and its storeys, 0 where OSM says none */
export interface MapFootprint {
  points: MapPoint[];
  levels: number;
}

/** Decimetres per metre: the points' unit */
const UNIT = 10;
const INT16_MAX = 32767;

/**
 * The footprints as one array. A ring keeps its points (a closing point
 * equal to the first goes); one of fewer than three, of more points than
 * Int16 counts or reaching past ±3.2 km is left out
 */
export function packFootprints(rings: readonly { points: readonly MapPoint[]; levels: number | null }[]): MapFootprints {
  const kept: { points: readonly MapPoint[]; n: number; levels: number }[] = [];
  let size = 0;
  for (const r of rings) {
    const p = r.points;
    let n = p.length;
    if (n > 1 && p[0].x === p[n - 1].x && p[0].y === p[n - 1].y) n--;
    if (n < 3 || n > INT16_MAX) continue;
    let inside = true;
    for (let k = 0; k < n && inside; k++) inside = Math.abs(p[k].x * UNIT) <= INT16_MAX && Math.abs(p[k].y * UNIT) <= INT16_MAX;
    if (!inside) continue;
    kept.push({ points: p, n, levels: Math.max(0, Math.min(INT16_MAX, Math.round(r.levels ?? 0))) });
    size += 2 + 2 * n;
  }
  const out = new Int16Array(size);
  let at = 0;
  for (const { points, n, levels } of kept) {
    out[at++] = n;
    out[at++] = levels;
    for (let k = 0; k < n; k++) {
      out[at++] = Math.round(points[k].x * UNIT);
      out[at++] = Math.round(points[k].y * UNIT);
    }
  }
  return { rings: out };
}

/** Whether the array holds whole rings one after the other (a file's may be cut or made by hand) */
export function footprintsWellFormed(rings: Int16Array): boolean {
  let at = 0;
  while (at < rings.length) {
    const n = rings[at];
    if (n < 3 || at + 2 + 2 * n > rings.length) return false;
    at += 2 + 2 * n;
  }
  return true;
}

/** Number of footprints in the array */
export function footprintCount(fp: MapFootprints): number {
  const r = fp.rings;
  let count = 0;
  for (let at = 0; at < r.length; at += 2 + 2 * r[at]) count++;
  return count;
}

/** The footprints back as rings in metres */
export function readFootprints(fp: MapFootprints): MapFootprint[] {
  const r = fp.rings;
  const out: MapFootprint[] = [];
  let at = 0;
  while (at + 2 <= r.length) {
    const n = r[at];
    const levels = r[at + 1];
    at += 2;
    const points: MapPoint[] = new Array(n);
    for (let k = 0; k < n; k++, at += 2) points[k] = { x: r[at] / UNIT, y: r[at + 1] / UNIT };
    out.push({ points, levels });
  }
  return out;
}

/**
 * The footprints whose outline comes within `radius` metres of a route (the
 * tiles' Overpass `around` filter, on the map's own data): the route pieces
 * go on a grid, each footprint tests only the pieces of the cells under its
 * box
 */
export function footprintsNearRoutes(footprints: readonly MapFootprint[], routes: readonly (readonly MapPoint[])[], radius: number): MapFootprint[] {
  const cell = Math.max(2 * radius, 20);
  const ax: number[] = [], ay: number[] = [], bx: number[] = [], by: number[] = [];
  const cells = new Map<number, number[]>();
  const key = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);
  for (const route of routes) {
    for (let k = 1; k < route.length; k++) {
      const a = route[k - 1], b = route[k];
      const s = ax.length;
      ax.push(a.x); ay.push(a.y); bx.push(b.x); by.push(b.y);
      const i0 = Math.floor((Math.min(a.x, b.x) - radius) / cell), i1 = Math.floor((Math.max(a.x, b.x) + radius) / cell);
      const j0 = Math.floor((Math.min(a.y, b.y) - radius) / cell), j1 = Math.floor((Math.max(a.y, b.y) + radius) / cell);
      for (let i = i0; i <= i1; i++) {
        for (let j = j0; j <= j1; j++) {
          const at = key(i, j);
          const list = cells.get(at);
          if (list) list.push(s);
          else cells.set(at, [s]);
        }
      }
    }
  }
  if (!ax.length) return [];
  // The footprint that tested a piece last: a piece under several of its cells is tested once
  const seen = new Int32Array(ax.length).fill(-1);
  const r2 = radius * radius;
  const out: MapFootprint[] = [];
  footprints.forEach((fp, f) => {
    const p = fp.points;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p) {
      if (q.x < x0) x0 = q.x;
      if (q.x > x1) x1 = q.x;
      if (q.y < y0) y0 = q.y;
      if (q.y > y1) y1 = q.y;
    }
    for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) {
      for (let j = Math.floor(y0 / cell); j <= Math.floor(y1 / cell); j++) {
        for (const s of cells.get(key(i, j)) ?? []) {
          if (seen[s] === f) continue;
          seen[s] = f;
          for (let k = 0; k < p.length; k++) {
            const c = p[k], d = p[(k + 1) % p.length];
            if (segmentDistance2(ax[s], ay[s], bx[s], by[s], c.x, c.y, d.x, d.y) <= r2) {
              out.push(fp);
              return;
            }
          }
        }
      }
    }
  });
  return out;
}

/** Squared distance between the segments ab and cd: 0 where they cross, else the nearest end to the other */
function segmentDistance2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const d1 = side(ax, ay, bx, by, cx, cy), d2 = side(ax, ay, bx, by, dx, dy);
  const d3 = side(cx, cy, dx, dy, ax, ay), d4 = side(cx, cy, dx, dy, bx, by);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(pointDistance2(cx, cy, ax, ay, bx, by), pointDistance2(dx, dy, ax, ay, bx, by), pointDistance2(ax, ay, cx, cy, dx, dy), pointDistance2(bx, by, cx, cy, dx, dy));
}

/** Which side of the line pq the point r lies on (the sign), twice the triangle's area */
function side(px: number, py: number, qx: number, qy: number, rx: number, ry: number): number {
  return (qx - px) * (ry - py) - (qy - py) * (rx - px);
}

/** Squared distance from p to the segment ab */
function pointDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ux = bx - ax, uy = by - ay;
  const len2 = ux * ux + uy * uy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * ux + (py - ay) * uy) / len2)) : 0;
  const ex = ax + t * ux - px, ey = ay + t * uy - py;
  return ex * ex + ey * ey;
}
