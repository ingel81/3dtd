import type { MapObject } from '../../map-document';
import { groundRing, type GroundBox } from '../../object-ground';
import { massBox, massOf, massRadius } from '../../object-mass';
import type { ObjectCategory } from '../asset-catalog';

/** What standing an object on the map needs of its catalogue entry (a `CatalogObject` is one) */
export interface ObjectFooting {
  category: ObjectCategory;
  /** Radius on the ground at scale 1 */
  footprint: number;
  /** Height at scale 1 */
  height: number;
  /** Rocks: their underside (half width, half depth, depth below the pivot) */
  base?: readonly [number, number, number];
  /** Buildings and walls: their ground rectangle (object-ground.ts) */
  box?: GroundBox;
  /** Floats on water: its origin is the waterline */
  float?: boolean;
  /** Stands in the air by design (a bridge, a cable span) */
  aloft?: boolean;
  /** Stands on legs over uneven or wet ground: placing it levels nothing */
  stilts?: boolean;
  /** Has a part that turns (catalogue `spin`, a radar dish's head): placing it levels the ground its sweep passes over */
  turns?: boolean;
}

const RING: number[] = [];

/**
 * The height the renderer stands an object's origin at, before its own z:
 * a floating one at the water's level (on dry ground at the terrain); a
 * building, wall or prop at the lowest ground under eight points of its
 * ground (object-ground.ts: its rectangle's corners and sides within its
 * footprint disc), so a turned house finds its lowest corner (the models'
 * foundations reach below 0 and fill the gap uphill); a tree 0.15 m per
 * unit of scale into the ground; anything else on the ground under its
 * middle. The editor's check measures from the same height.
 */
export function seatHeight(
  f: ObjectFooting,
  o: MapObject,
  groundAt: (x: number, y: number) => number,
  waterAt: (x: number, y: number) => number | null,
): number {
  const s = o.scale || 1;
  const ground = groundAt(o.x, o.y);
  if (f.float) return waterAt(o.x, o.y) ?? ground;
  if (f.category === 'building' || f.category === 'wall' || f.category === 'prop') {
    let low = ground;
    // A raised building (object-mass.ts) on its outline's rectangle, not on its catalogue entry's
    const mass = massOf(o);
    const ring = mass ? groundRing(massRadius(mass), massBox(mass), o, RING) : groundRing(f.footprint, f.box, o, RING);
    for (let k = 0; k < ring.length; k += 2) low = Math.min(low, groundAt(ring[k], ring[k + 1]));
    return low;
  }
  return f.category === 'tree' ? ground - 0.15 * s : ground;
}

/** A wall follows the slope at most this steep (rise over run) */
const MAX_WALL_SHEAR = 0.7;

/**
 * How a wall or fence follows the ground along its length (its ground
 * rectangle's long side, model x): the slope between the ground under its
 * two ends, as a shear that keeps its posts upright and runs its rails and
 * foot along the ground, and the height its origin stands at so its foot
 * lies on the ground at both ends (sunk where the ground between them dips).
 * On a slope a level fence stuck into the hill at one end and floated at
 * the other. Null for anything else, for a wall turned by hand (pitch,
 * roll) and on level ground. The caller keeps sight blockers and what
 * towers stand on level: what the line of sight and the build rules see
 * stays as it was.
 */
export function wallShear(
  f: ObjectFooting,
  o: MapObject,
  groundAt: (x: number, y: number) => number,
): { height: number; shear: number } | null {
  if (f.category !== 'wall' || !f.box || o.pitch || o.roll) return null;
  const s = o.scale || 1;
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  // Model x and z in map space (object-ground.ts toModel, inverted)
  const xx = -cos;
  const xy = -sin;
  const zx = -sin;
  const zy = cos;
  const half = f.box[2] * s;
  const cx = o.x + xx * f.box[0] * s + zx * f.box[1] * s;
  const cy = o.y + xy * f.box[0] * s + zy * f.box[1] * s;
  const h0 = groundAt(cx - xx * half, cy - xy * half);
  const h1 = groundAt(cx + xx * half, cy + xy * half);
  const shear = Math.min(MAX_WALL_SHEAR, Math.max(-MAX_WALL_SHEAR, (h1 - h0) / (2 * half)));
  if (Math.abs(shear) < 0.005) return null;
  // The foot's line through the middle of the ends, lowered where the ground in the middle lies below it
  const mid = (h0 + h1) / 2;
  const sink = Math.max(0, mid - groundAt(cx, cy)) + 0.04;
  return { height: mid - shear * f.box[0] * s - sink, shear };
}
