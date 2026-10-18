import type { MapObject, MapPoint } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';

/**
 * The ropes of the cables placed on a map (catalogue `cable`: the spans of a
 * cable car), for movers hanging from a line (life-movers.ts): a gondola on
 * a route along a cable rides its ropes, out on one and back on the other,
 * at the height they run, instead of a straight line over the ground. A
 * span's ropes run along its front (+z), `gauge` apart, `length` long at
 * scale 1, tilted with its pitch, at the height of its origin.
 */

export interface Rope {
  /** Map points of its ends and their heights (the world's metres) */
  a: MapPoint;
  b: MapPoint;
  ha: number;
  hb: number;
  /** Metres between the two ropes of its span */
  gauge: number;
}

/** The ropes of every cable object, `groundAt` the height its origin stands on */
export function cableRopes(objects: readonly MapObject[], entryOf: (asset: string) => CatalogObject | undefined, groundAt: (x: number, y: number) => number): Rope[] {
  const out: Rope[] = [];
  for (const o of objects) {
    const cable = entryOf(o.asset)?.cable;
    if (!cable) continue;
    const s = o.scale || 1;
    const pitch = o.pitch ?? 0;
    // Front (+z) in map space (scene x is map -x): the turn by rotation, then pitch tips it down by sin(pitch)
    const fx = -Math.sin(o.rotation);
    const fy = Math.cos(o.rotation);
    const half = (cable.length * s) / 2;
    const run = half * Math.cos(pitch);
    const rise = -half * Math.sin(pitch);
    const base = groundAt(o.x, o.y) + o.z;
    for (const side of [-1, 1]) {
      // Left and right of the front: the span's local x, gauge apart
      const off = (side * cable.gauge * s) / 2;
      const cx = o.x - fy * off;
      const cy = o.y + fx * off;
      out.push({ a: { x: cx - fx * run, y: cy - fy * run }, b: { x: cx + fx * run, y: cy + fy * run }, ha: base - rise, hb: base + rise, gauge: cable.gauge * s });
    }
  }
  return out;
}

/** Height of the rope nearest `p` within `reach` metres across it (and over its length), null when none runs there */
export function ropeHeightAt(ropes: readonly Rope[], p: MapPoint, reach: number): number | null {
  let best: number | null = null;
  let bestDist = reach;
  for (const r of ropes) {
    const dx = r.b.x - r.a.x;
    const dy = r.b.y - r.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-6) continue;
    const t = ((p.x - r.a.x) * dx + (p.y - r.a.y) * dy) / len2;
    if (t < -0.02 || t > 1.02) continue;
    const across = Math.abs((p.x - r.a.x) * dy - (p.y - r.a.y) * dx) / Math.sqrt(len2);
    if (across > bestDist) continue;
    bestDist = across;
    best = r.ha + (r.hb - r.ha) * Math.min(1, Math.max(0, t));
  }
  return best;
}

/**
 * Heights for the points of a loop riding the ropes: each point on a rope
 * takes its height; points between ropes (a pylon's sheave, the turn round a
 * station's wheel) the height interpolated between the nearest points on a
 * rope before and after them round the loop. Null when no point of the loop
 * lies on a rope
 */
export function ropeHeights(loop: readonly MapPoint[], ropes: readonly Rope[], reach: number): number[] | null {
  const n = loop.length;
  const on = loop.map((p) => ropeHeightAt(ropes, p, reach));
  if (on.every((h) => h === null)) return null;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    if (on[i] !== null) {
      out[i] = on[i]!;
      continue;
    }
    let back = 1;
    while (on[(i - back + n) % n] === null) back++;
    let ahead = 1;
    while (on[(i + ahead) % n] === null) ahead++;
    const hb = on[(i - back + n) % n]!;
    const ha = on[(i + ahead) % n]!;
    out[i] = hb + ((ha - hb) * back) / (back + ahead);
  }
  return out;
}
