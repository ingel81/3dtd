/**
 * A river's levels and points from its course, on any ground: the surface
 * that only ever falls and stands below the lower of its banks, and where
 * the ribbon keeps its points. The river brush (editor/ops/landscape/river.ts)
 * carves with them; the OSM import lays its rivers with them.
 */
import type { MapPoint } from '../world/custom-map/map-document';
import { nearestOnPolyline } from './path-graph';
import { resample } from './lines';

/** Metres the surface falls at least per metre of course */
const MIN_FALL = 0.004;
/** Metres the surface stays under the ground along the centre line */
const UNDER = 0.5;
/** Metres between the points of a river */
const POINT_STEP = 8;
/** Metres the ribbon between two points may stand off the carved surface before a point goes in between */
const POINT_FIT = 0.3;

/** Catmull-Rom through the drawn points (thinned to one every `spacing` metres), sampled every `step` */
export function catmullRomLine(drawn: readonly MapPoint[], spacing: number, step: number): MapPoint[] {
  const ctrl = resample(drawn, spacing);
  if (ctrl.length < 3) return resample(ctrl, step);
  const pts = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const out: MapPoint[] = [];
  for (let k = 1; k < pts.length - 2; k++) {
    const [p0, p1, p2, p3] = [pts[k - 1], pts[k], pts[k + 1], pts[k + 2]];
    const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let s = 0; s < n; s++) {
      const t = s / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ ...pts[pts.length - 2] });
  return out;
}

/**
 * Metres a river's surface stays below the lower of its banks: the drop
 * from the land to the water that makes it a channel, more for a wider one
 */
export function freeboard(width: number): number {
  return Math.min(1.5, Math.max(0.4, 0.3 + 0.05 * width));
}

/**
 * The surface along a course from its banks: at each point `freeboard`
 * below the lower of the two banks (the land at either side, `out` metres
 * past the water's edge) and UNDER below the ground in the middle (`centre`,
 * the ground before any bed; else the land straight across from bank to
 * bank); never rising downstream and falling at least MIN_FALL per metre.
 * How far the lower bank pulls the surface down is averaged along the
 * course over about the band's width: where the course bends on a slope,
 * the bank samples swing up and down the slope, and the surface should not
 * step with them. `half` is the half width at each point of the line.
 */
export function bankLevels(
  land: (x: number, y: number) => number,
  line: readonly MapPoint[],
  half: (k: number) => number,
  out: number,
  centre?: (x: number, y: number) => number,
): number[] {
  const n = line.length;
  const along: number[] = [];
  const middle: number[] = [];
  const pull: number[] = [];
  for (let k = 0; k < n; k++) {
    const p = line[k];
    const a = line[Math.max(0, k - 1)];
    const b = line[Math.min(n - 1, k + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const h = half(k);
    const d = h + out;
    const left = land(p.x + nx * d, p.y + ny * d);
    const right = land(p.x - nx * d, p.y - ny * d);
    const c = (centre ? centre(p.x, p.y) : (left + right) / 2) - UNDER;
    along.push(k ? along[k - 1] + Math.hypot(p.x - line[k - 1].x, p.y - line[k - 1].y) : 0);
    middle.push(c);
    pull.push(Math.min(0, Math.min(left, right) - freeboard(h * 2) - c));
  }
  const surface: number[] = [];
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let k = 0; k < n; k++) {
    // The window of samples within the band's half width plus `out` either way
    const reach = half(k) + out;
    while (hi < n && along[hi] <= along[k] + reach) sum += pull[hi++];
    while (along[lo] < along[k] - reach) sum -= pull[lo++];
    const level = middle[k] + sum / (hi - lo);
    surface.push(k ? Math.min(surface[k - 1] - MIN_FALL * (along[k] - along[k - 1]), level) : level);
  }
  return surface;
}

/**
 * Where a river keeps its points along its course (`line` with `along` and
 * `surface` per vertex): one every POINT_STEP, and a vertex between two
 * wherever the surface stands more than POINT_FIT off the straight run from
 * one to the next. The renderer runs the height straight between points:
 * over a waterfall 8 m apart, a point on the face and one past the foot
 * made a sloped sheet hanging over the pool below; the lip and the foot
 * keep the ribbon on the carved surface.
 */
export function riverPoints(line: readonly MapPoint[], along: readonly number[], surface: readonly number[]): { p: MapPoint; s: number }[] {
  const at = (s: number) => {
    let k = 1;
    while (k < along.length - 1 && along[k] < s) k++;
    const f = Math.min(1, Math.max(0, (s - along[k - 1]) / Math.max(1e-6, along[k] - along[k - 1])));
    return surface[k - 1] + (surface[k] - surface[k - 1]) * f;
  };
  const kept = resample(line, POINT_STEP).map((p) => ({ p, s: nearestOnPolyline(line, p)?.along ?? 0 }));
  const out: { p: MapPoint; s: number }[] = [];
  const refine = (a: { p: MapPoint; s: number }, b: { p: MapPoint; s: number }) => {
    const ha = at(a.s);
    const hb = at(b.s);
    let worst = POINT_FIT;
    let pick = -1;
    for (let k = 0; k < along.length; k++) {
      if (along[k] <= a.s + 0.5 || along[k] >= b.s - 0.5) continue;
      const off = Math.abs(surface[k] - (ha + ((hb - ha) * (along[k] - a.s)) / (b.s - a.s)));
      if (off > worst) {
        worst = off;
        pick = k;
      }
    }
    if (pick < 0) return;
    const mid = { p: line[pick], s: along[pick] };
    refine(a, mid);
    out.push(mid);
    refine(mid, b);
  };
  kept.forEach((q, k) => {
    if (k) refine(kept[k - 1], q);
    out.push(q);
  });
  return out;
}
