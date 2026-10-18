import type { MapPoint } from '../world/custom-map/map-document';

/**
 * Rows along a hillside (vineyards, tea gardens, fields on terraces): pieces
 * of `length` metres laid end to end along the contour lines of the ground,
 * `gap` metres apart across the slope. The contours are traced (marching
 * squares) on a smoothed copy of the ground, so steps and bumps do not break
 * them: on terraces the rows run parallel to the terrace edges, on a plain
 * slope they follow it round spurs and hollows. Pieces on ground steeper
 * than `maxSlope` degrees (a terrace's riser, a cliff) or outside the region
 * are left out. Pure: the ground comes as functions of height and slope.
 */

export interface RowPiece {
  /** Middle of the piece */
  x: number;
  y: number;
  /** Unit direction it runs along the contour (map x east, y north) */
  dx: number;
  dy: number;
}

export interface ContourRowOptions {
  /** Metres between two rows across the slope */
  gap: number;
  /** Metres of one piece along its row */
  length: number;
  /** Steepest ground a piece stands on, degrees (default 26) */
  maxSlope?: number;
  /** Metres the ground is smoothed over before the contours are traced (default 10) */
  smooth?: number;
  /** Lattice spacing of the trace, metres (default 2) */
  cell?: number;
}

/**
 * The pieces of the rows inside the region: a centre and radius, or an
 * outline. `slopeAt` is the steepness of the real ground in degrees
 */
export function contourRows(
  heightAt: (x: number, y: number) => number,
  slopeAt: (x: number, y: number) => number,
  region: { center: MapPoint; radius: number } | readonly MapPoint[],
  o: ContourRowOptions,
): RowPiece[] {
  const inside = insideOf(region);
  const box = boundsOf(region);
  const cell = o.cell ?? 2;
  const smooth = o.smooth ?? 10;
  const maxSlope = o.maxSlope ?? 26;
  // The lattice over the region and a margin, the ground smoothed by two box blurs
  const pad = smooth;
  const x0 = box.minX - pad;
  const y0 = box.minY - pad;
  const cols = Math.ceil((box.maxX - box.minX + 2 * pad) / cell) + 1;
  const rows = Math.ceil((box.maxY - box.minY + 2 * pad) / cell) + 1;
  let field: Float64Array = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) field[j * cols + i] = heightAt(x0 + i * cell, y0 + j * cell);
  const r = Math.max(1, Math.round(smooth / cell / 2));
  for (let pass = 0; pass < 2; pass++) field = blur(field, cols, rows, r);
  // How steep the smoothed ground is inside the region (median): the rise between two rows `gap` apart
  const grades: number[] = [];
  for (let j = 1; j < rows - 1; j++) {
    for (let i = 1; i < cols - 1; i++) {
      if (!inside({ x: x0 + i * cell, y: y0 + j * cell })) continue;
      const gx = (field[j * cols + i + 1] - field[j * cols + i - 1]) / (2 * cell);
      const gy = (field[(j + 1) * cols + i] - field[(j - 1) * cols + i]) / (2 * cell);
      grades.push(Math.hypot(gx, gy));
    }
  }
  if (!grades.length) return [];
  grades.sort((a, b) => a - b);
  const grade = grades[grades.length >> 1];
  // Flat ground has no contour to follow
  if (grade < 0.01) return [];
  const rise = o.gap * grade;
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of field) [lo, hi] = [Math.min(lo, h), Math.max(hi, h)];
  const out: RowPiece[] = [];
  for (let level = Math.floor(lo / rise) * rise + rise / 2; level < hi; level += rise) {
    for (const line of traceLevel(field, cols, rows, level)) {
      const pts = line.map(([i, j]) => ({ x: x0 + i * cell, y: y0 + j * cell }));
      for (const piece of alongLine(pts, o.length)) {
        if (!inside(piece) || slopeAt(piece.x, piece.y) > maxSlope) continue;
        out.push(piece);
      }
    }
  }
  return out;
}

/** A separable box blur of radius `r` lattice cells, edges clamped */
function blur(src: Float64Array, cols: number, rows: number, r: number): Float64Array {
  const tmp = new Float64Array(src.length);
  const out = new Float64Array(src.length);
  const n = 2 * r + 1;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[j * cols + Math.min(cols - 1, Math.max(0, i + k))];
      tmp[j * cols + i] = s / n;
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[Math.min(rows - 1, Math.max(0, j + k)) * cols + i];
      out[j * cols + i] = s / n;
    }
  }
  return out;
}

/** The lines where the field crosses `level` (marching squares), chained into polylines of lattice coordinates */
function traceLevel(f: Float64Array, cols: number, rows: number, level: number): [number, number][][] {
  // Each crossing sits on a lattice edge: keyed by the edge, so neighbouring cells share it
  const segments: [string, string][] = [];
  const points = new Map<string, [number, number]>();
  const cross = (i0: number, j0: number, i1: number, j1: number): string => {
    const key = i0 === i1 ? `v${i0},${Math.min(j0, j1)}` : `h${Math.min(i0, i1)},${j0}`;
    if (!points.has(key)) {
      const a = f[j0 * cols + i0] - level;
      const b = f[j1 * cols + i1] - level;
      const t = a / (a - b);
      points.set(key, [i0 + (i1 - i0) * t, j0 + (j1 - j0) * t]);
    }
    return key;
  };
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const c = [f[j * cols + i], f[j * cols + i + 1], f[(j + 1) * cols + i + 1], f[(j + 1) * cols + i]].map((h) => h >= level);
      // Corners counter-clockwise from (i, j); the edges between them that the level crosses
      const corner = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]] as const;
      const crossed: string[] = [];
      for (let e = 0; e < 4; e++) {
        const a = corner[e];
        const b = corner[(e + 1) % 4];
        if (c[e] !== c[(e + 1) % 4]) crossed.push(cross(a[0], a[1], b[0], b[1]));
      }
      if (crossed.length === 2) segments.push([crossed[0], crossed[1]]);
      else if (crossed.length === 4) {
        // A saddle: pair the crossings by the cell's middle
        const mid = (f[j * cols + i] + f[j * cols + i + 1] + f[(j + 1) * cols + i + 1] + f[(j + 1) * cols + i]) / 4 >= level;
        if (mid === c[0]) segments.push([crossed[0], crossed[3]], [crossed[1], crossed[2]]);
        else segments.push([crossed[0], crossed[1]], [crossed[2], crossed[3]]);
      }
    }
  }
  // Chain: every crossing joins at most two segments
  const links = new Map<string, string[]>();
  for (const [a, b] of segments) {
    links.set(a, [...(links.get(a) ?? []), b]);
    links.set(b, [...(links.get(b) ?? []), a]);
  }
  const seen = new Set<string>();
  const lines: [number, number][][] = [];
  const walk = (start: string): void => {
    const keys = [start];
    seen.add(start);
    let at = start;
    for (;;) {
      const next = (links.get(at) ?? []).find((k) => !seen.has(k));
      if (!next) break;
      seen.add(next);
      keys.push(next);
      at = next;
    }
    if (keys.length >= 2) lines.push(keys.map((k) => points.get(k)!));
  };
  // Open lines from their ends first, then the closed loops left
  for (const [k, l] of links) if (l.length === 1 && !seen.has(k)) walk(k);
  for (const k of links.keys()) if (!seen.has(k)) walk(k);
  return lines;
}

/** Pieces of `length` end to end along a polyline: each its middle and direction */
function alongLine(pts: readonly MapPoint[], length: number): RowPiece[] {
  const out: RowPiece[] = [];
  const cum = [0];
  for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  const total = cum[cum.length - 1];
  const at = (d: number): MapPoint => {
    let k = 1;
    while (k < cum.length - 1 && cum[k] < d) k++;
    const t = (d - cum[k - 1]) / Math.max(1e-9, cum[k] - cum[k - 1]);
    return { x: pts[k - 1].x + (pts[k].x - pts[k - 1].x) * t, y: pts[k - 1].y + (pts[k].y - pts[k - 1].y) * t };
  };
  const n = Math.floor(total / length);
  // Centred on the line: the rest split between both ends
  const start = (total - n * length) / 2;
  for (let k = 0; k < n; k++) {
    const a = at(start + k * length);
    const b = at(start + (k + 1) * length);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, dx: (b.x - a.x) / len, dy: (b.y - a.y) / len });
  }
  return out;
}

function insideOf(region: { center: MapPoint; radius: number } | readonly MapPoint[]): (p: MapPoint) => boolean {
  if ('center' in region) return (p) => Math.hypot(p.x - region.center.x, p.y - region.center.y) <= region.radius;
  const poly = region;
  return (p) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
}

function boundsOf(region: { center: MapPoint; radius: number } | readonly MapPoint[]): { minX: number; minY: number; maxX: number; maxY: number } {
  if ('center' in region) return { minX: region.center.x - region.radius, minY: region.center.y - region.radius, maxX: region.center.x + region.radius, maxY: region.center.y + region.radius };
  const xs = region.map((p) => p.x);
  const ys = region.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
