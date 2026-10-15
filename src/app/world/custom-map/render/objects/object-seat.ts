import type { MapObject } from '../../map-document';
import { groundRing, type GroundBox } from '../../object-ground';
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
    const ring = groundRing(f.footprint, f.box, o, RING);
    for (let k = 0; k < ring.length; k += 2) low = Math.min(low, groundAt(ring[k], ring[k + 1]));
    return low;
  }
  return f.category === 'tree' ? ground - 0.15 * s : ground;
}
