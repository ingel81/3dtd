/**
 * Editing a river after it was drawn: its points move, new ones go in
 * between, others come out, and the width changes along all of it. A
 * point keeps the surface falling: its height lies between its
 * neighbours', so the bed the brush carved still fits.
 */
import type { MapPoint, MapRiver, MapRiverPoint } from '../../world/custom-map/map-document';

export interface RiverPointRef {
  river: number;
  point: number;
}

/** The river point nearest to `p` within `reach` metres (or its own half width, if wider) */
export function nearestRiverPoint(rivers: readonly MapRiver[], p: MapPoint, reach: number): RiverPointRef | null {
  let best: { d: number; ref: RiverPointRef } | null = null;
  rivers.forEach((r, river) =>
    r.points.forEach((q, point) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= Math.max(reach, q.width / 2) && (!best || d < best.d)) best = { d, ref: { river, point } };
    }),
  );
  return (best as { d: number; ref: RiverPointRef } | null)?.ref ?? null;
}

/** Where `p` falls on a river's course within its width: the segment and the share along it */
export function nearestRiverSegment(rivers: readonly MapRiver[], p: MapPoint): { river: number; segment: number; t: number } | null {
  let best: { d: number; river: number; segment: number; t: number } | null = null;
  rivers.forEach((r, river) => {
    for (let k = 1; k < r.points.length; k++) {
      const a = r.points[k - 1];
      const b = r.points[k];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const d = Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
      const half = (a.width + (b.width - a.width) * t) / 2;
      if (d <= half + 2 && (!best || d < best.d)) best = { d, river, segment: k, t };
    }
  });
  const b = best as { river: number; segment: number; t: number } | null;
  return b ? { river: b.river, segment: b.segment, t: b.t } : null;
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Moves a point; its height settles between its neighbours' so the river still falls */
export function movePoint(river: MapRiver, index: number, to: MapPoint): void {
  const p = river.points[index];
  p.x = round(to.x);
  p.y = round(to.y);
  settle(river, index);
}

/** A new point on segment `segment` (between points segment-1 and segment) at share `t`; returns its index */
export function insertPoint(river: MapRiver, segment: number, t: number): number {
  const a = river.points[segment - 1];
  const b = river.points[segment];
  const p: MapRiverPoint = {
    x: round(a.x + (b.x - a.x) * t),
    y: round(a.y + (b.y - a.y) * t),
    width: round(a.width + (b.width - a.width) * t),
    height: round(a.height + (b.height - a.height) * t),
  };
  river.points.splice(segment, 0, p);
  return segment;
}

/** Removes a point; false when the river would have fewer than two */
export function removePoint(river: MapRiver, index: number): boolean {
  if (river.points.length <= 2) return false;
  river.points.splice(index, 1);
  return true;
}

/** Scales every width so the mean is `mean` metres */
export function setMeanWidth(river: MapRiver, mean: number): void {
  const now = river.points.reduce((s, q) => s + q.width, 0) / river.points.length;
  const k = mean / Math.max(0.1, now);
  for (const q of river.points) q.width = round(Math.max(1, q.width * k));
}

export function meanWidth(river: MapRiver): number {
  return river.points.reduce((s, q) => s + q.width, 0) / river.points.length;
}

export function riverLength(river: MapRiver): number {
  let l = 0;
  for (let k = 1; k < river.points.length; k++) l += Math.hypot(river.points[k].x - river.points[k - 1].x, river.points[k].y - river.points[k - 1].y);
  return l;
}

/** The height of point `index` between its neighbours': interpolated by distance, never above the one before or below the one after */
function settle(river: MapRiver, index: number): void {
  const pts = river.points;
  const p = pts[index];
  const prev = pts[index - 1];
  const next = pts[index + 1];
  if (prev && next) {
    const a = Math.hypot(p.x - prev.x, p.y - prev.y);
    const b = Math.hypot(next.x - p.x, next.y - p.y);
    p.height = round(prev.height + ((next.height - prev.height) * a) / Math.max(1e-6, a + b));
  } else if (prev) p.height = Math.min(p.height, prev.height);
  else if (next) p.height = Math.max(p.height, next.height);
}

/**
 * Fewer points where the river runs straight: a point goes when the course
 * without it stays within `tolerance` metres; widths and heights of the
 * points that stay are kept
 */
export function simplifyRiver(river: MapRiver, tolerance: number): void {
  const pts = river.points;
  if (pts.length <= 2) return;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let at = -1;
    for (let k = a + 1; k < b; k++) {
      const d = segmentDistance(pts[k], pts[a], pts[b]);
      if (d > worst) {
        worst = d;
        at = k;
      }
    }
    if (at >= 0 && worst > tolerance) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  river.points = pts.filter((_, k) => keep[k]);
}

function segmentDistance(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y);
}
