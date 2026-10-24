/**
 * A placed model's wall box (Placement) in the map's plane: its axes and
 * origin, its corners, a point in its own axes and the distance to it.
 */
import type { MapPoint } from '../../custom-map/map-document';
import type { Placement } from './building-types';

/** The unit vector a quarter turn clockwise (to the right) of `f` */
export function rightOf(f: MapPoint): MapPoint {
  return { x: f.y, y: -f.x };
}

/**
 * A placement's own axes in the map: the front, and the model's +x (the
 * renderer turns local +z to the front and local +x a quarter turn left of
 * it, map-coords.ts mirrors x: so model +x is the front turned left, and
 * model -x, a corner house's west side, the front turned right)
 */
export function placementAxes(pl: Placement): { f: MapPoint; x: MapPoint } {
  const f = pl.front;
  return { f, x: { x: -f.y, y: f.x } };
}

/** The model's origin: the box middle less the model's own offset of its walls */
export function origin(pl: Placement): MapPoint {
  const at = pl.model.at;
  if (!at) return pl.p;
  const { f, x } = placementAxes(pl);
  return { x: pl.p.x - (at[0] * x.x + at[1] * f.x) * pl.scale, y: pl.p.y - (at[0] * x.y + at[1] * f.y) * pl.scale };
}

/** The four corners of a placement's wall box, `grow` m larger on each side */
export function boxCorners(pl: Placement, grow = 0): MapPoint[] {
  const { f } = placementAxes(pl);
  const r = rightOf(f);
  const hw = pl.hw + grow;
  const hd = pl.hd + grow;
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([a, b]) => ({ x: pl.p.x + r.x * hw * a + f.x * hd * b, y: pl.p.y + r.y * hw * a + f.y * hd * b }));
}

/** Point `q` in a placement's box axes: across (along its width) and along its face normal */
export function toBox(pl: Placement, q: MapPoint): { s: number; t: number } {
  const f = pl.front;
  const r = rightOf(f);
  const dx = q.x - pl.p.x;
  const dy = q.y - pl.p.y;
  return { s: dx * r.x + dy * r.y, t: dx * f.x + dy * f.y };
}

/** Distance from point `q` to a placement's wall box (0 inside) */
export function boxDistance(pl: Placement, q: MapPoint): number {
  const { s, t } = toBox(pl, q);
  return Math.hypot(Math.max(0, Math.abs(s) - pl.hw), Math.max(0, Math.abs(t) - pl.hd));
}
