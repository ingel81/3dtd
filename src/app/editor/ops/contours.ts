/**
 * Height lines by marching squares over the height grid: for each level
 * (every `step` metres) the segments where the ground crosses it. Output is
 * a flat list of segment ends in map space with their height.
 */
import type { MapTerrain } from '../../world/custom-map/map-document';

/** x, y, h of both ends of each segment, six numbers per segment; `major` marks every fifth level */
export interface Contours {
  minor: Float32Array;
  major: Float32Array;
}

export function contourLines(t: MapTerrain, step: number, maxSegments = 400_000): Contours {
  const g = t.grid;
  const h = g.heights;
  const c = g.columns;
  const minor: number[] = [];
  const major: number[] = [];
  const s = Math.max(0.5, step);
  const x0 = -t.width / 2;
  const y0 = -t.depth / 2;
  const cell = g.cellSize;
  let count = 0;
  for (let j = 0; j < g.rows - 1 && count < maxSegments; j++) {
    for (let i = 0; i < c - 1; i++) {
      const a = h[j * c + i];
      const b = h[j * c + i + 1];
      const d = h[(j + 1) * c + i];
      const e = h[(j + 1) * c + i + 1];
      const lo = Math.min(a, b, d, e);
      const hi = Math.max(a, b, d, e);
      for (let level = Math.ceil(lo / s) * s; level < hi; level += s) {
        // Crossing points on the four cell edges
        const pts: number[] = [];
        const edge = (ha: number, hb: number, xa: number, ya: number, xb: number, yb: number) => {
          if ((ha < level) === (hb < level)) return;
          const f = (level - ha) / (hb - ha);
          pts.push(x0 + (xa + (xb - xa) * f) * cell, y0 + (ya + (yb - ya) * f) * cell);
        };
        edge(a, b, i, j, i + 1, j);
        edge(b, e, i + 1, j, i + 1, j + 1);
        edge(e, d, i + 1, j + 1, i, j + 1);
        edge(d, a, i, j + 1, i, j);
        const out = Math.round(level / s) % 5 === 0 ? major : minor;
        for (let k = 0; k + 3 < pts.length; k += 4) {
          out.push(pts[k], pts[k + 1], level, pts[k + 2], pts[k + 3], level);
          count++;
        }
      }
    }
  }
  return { minor: new Float32Array(minor), major: new Float32Array(major) };
}
