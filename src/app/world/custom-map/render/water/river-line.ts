import type { MapRiverPoint } from '../../map-document';

/**
 * A river's line as the renderer draws it: Catmull-Rom through its points.
 * Without three, so the path mask (path-mask.ts) can paint the banks in the
 * editor's worker too.
 */

/** Metres between two samples of a river's line */
const STEP = 2;

/** Smooth line through the points, a sample about every `step` metres */
export function sampleRiver(points: MapRiverPoint[], step = STEP): MapRiverPoint[] {
  const out: MapRiverPoint[] = [];
  for (let s = 0; s < points.length - 1; s++) {
    const p0 = points[Math.max(0, s - 1)];
    const p1 = points[s];
    const p2 = points[s + 1];
    const p3 = points[Math.min(points.length - 1, s + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({
        x: cr(p0.x, p1.x, p2.x, p3.x),
        y: cr(p0.y, p1.y, p2.y, p3.y),
        // Width and height linear: a spline could overshoot and make the river run uphill
        width: p1.width + (p2.width - p1.width) * t,
        height: p1.height + (p2.height - p1.height) * t,
      });
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
}
