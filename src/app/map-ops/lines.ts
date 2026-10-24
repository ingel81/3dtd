/**
 * Lines drawn with the mouse, made usable: Chaikin smoothing against the
 * jitter of the hand, even resampling, and Douglas-Peucker simplification
 * for road curve points and closed rings.
 */
import type { MapPoint } from '../world/custom-map/map-document';
import { pointAt, pointSegmentDistance, polylineLength } from './path-graph';

export function chaikin(line: readonly MapPoint[], rounds = 2): MapPoint[] {
  let pts = line.map((p) => ({ x: p.x, y: p.y }));
  for (let r = 0; r < rounds && pts.length > 2; r++) {
    const out: MapPoint[] = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/** Points every `step` metres along the line, ends included */
export function resample(line: readonly MapPoint[], step: number): MapPoint[] {
  const length = polylineLength(line);
  if (length <= 0) return line.length ? [{ ...line[0] }] : [];
  const n = Math.max(1, Math.round(length / step));
  return Array.from({ length: n + 1 }, (_, k) => pointAt(line, (length * k) / n));
}

/** Douglas-Peucker: drop points closer than `tolerance` to the line between their neighbours */
export function simplify(line: readonly MapPoint[], tolerance: number): MapPoint[] {
  if (line.length <= 2) return line.map((p) => ({ ...p }));
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = line[a];
    const pb = line[b];
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    let worst = -1;
    let at = -1;
    for (let k = a + 1; k < b; k++) {
      const p = line[k];
      const d = Math.abs((pb.x - pa.x) * (pa.y - p.y) - (pa.x - p.x) * (pb.y - pa.y)) / len;
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (worst > tolerance && at > 0) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return line.filter((_, k) => keep[k]).map((p) => ({ ...p }));
}

/** Where two segments cross, as the share along the first, or null */
export function segmentCross(a: MapPoint, b: MapPoint, c: MapPoint, d: MapPoint): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

/**
 * A closed ring (the first point not repeated) with the points nearer than
 * `tolerance` to the line of their neighbours left out, as Douglas-Peucker
 * does, from its two points farthest apart; null when fewer than three
 * points or no area are left
 */
export function simplifyRing(ring: readonly MapPoint[], tolerance: number): MapPoint[] | null {
  const pts = ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y ? ring.slice(0, -1) : [...ring];
  if (pts.length < 3) return null;
  // Split at the point farthest from the first, simplify both halves
  let far = 0;
  let best = -1;
  for (let k = 1; k < pts.length; k++) {
    const d = (pts[k].x - pts[0].x) ** 2 + (pts[k].y - pts[0].y) ** 2;
    if (d > best) {
      best = d;
      far = k;
    }
  }
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[far] = 1;
  const stack: [number, number][] = [[0, far], [far, pts.length]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = pts[i];
    const b = pts[j % pts.length];
    let worst = -1;
    let at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = pointSegmentDistance(pts[k], a, b);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([i, at], [at, j]);
    }
  }
  const out = pts.filter((_, k) => keep[k]);
  if (out.length < 3) return null;
  let s = 0;
  for (let i = 0, j = out.length - 1; i < out.length; j = i++) s += out[j].x * out[i].y - out[i].x * out[j].y;
  return Math.abs(s) > 1 ? out : null;
}
