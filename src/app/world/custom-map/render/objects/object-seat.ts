import type { MapObject } from '../../map-document';
import { groundRing, toModel, type GroundBox } from '../../object-ground';
import { massBox, massOf, massOnRamp, massRadius } from '../../object-mass';
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
  /** A length of row along model x at scale 1 (catalogue `row`): it follows the ground along its length (wallShear) */
  row?: number;
}

const RING: number[] = [];

/**
 * The height the renderer stands an object's origin at, before its own z:
 * a floating one at the water's level (on dry ground at the terrain); a
 * building, wall or prop at the lowest ground under eight points of its
 * ground (object-ground.ts: its rectangle's corners and sides within its
 * footprint disc), so a turned house finds its lowest corner (the models'
 * foundations reach below 0 and fill the gap uphill); a tree 0.15 m per
 * unit of scale under the lowest ground round its trunk, a plant at the
 * lowest ground under its patch (TRUNK_SHARE, PATCH_SHARE: on a bank its
 * downhill side reaches the ground instead of hanging in the air, uphill it
 * grows out of the slope); anything else on the ground under its middle.
 * The editor's check measures from the same height.
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
    const cos = Math.cos(o.rotation);
    const sin = Math.sin(o.rotation);
    for (let k = 0; k < ring.length; k += 2) {
      // Not in the cutting of a car park's ramp before its entrance: the house stands on its ground, its entrance opens down
      if (mass?.openings) {
        const m = toModel(ring[k] - o.x, ring[k + 1] - o.y, cos, sin);
        if (massOnRamp(mass, m.x / s, m.z / s)) continue;
      }
      low = Math.min(low, groundAt(ring[k], ring[k + 1]));
    }
    return low;
  }
  if (f.category === 'tree') return lowestRound(ground, TRUNK_SHARE * f.footprint * s, o, groundAt) - 0.15 * s;
  // A length of row follows the ground along its length (wallShear), across it the ground under its middle
  if (f.category === 'plant' && !f.row) return lowestRound(ground, PATCH_SHARE * f.footprint * s, o, groundAt);
  return ground;
}

/** Share of a tree's footprint its trunk takes at its foot (the catalogue's footprint is the ground it keeps clear, wider than the trunk) */
const TRUNK_SHARE = 0.4;

/** Share of a plant's footprint its patch covers at the ground (grass, reeds, shrubs thin out towards the edge) */
const PATCH_SHARE = 0.7;

/** The lowest of `ground` and the ground at eight points on a circle of radius `r` round the object */
function lowestRound(ground: number, r: number, o: MapObject, groundAt: (x: number, y: number) => number): number {
  let low = ground;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    low = Math.min(low, groundAt(o.x + Math.cos(a) * r, o.y + Math.sin(a) * r));
  }
  return low;
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
 * the other. A length of row (catalogue `row`, a vine row) follows the
 * ground the same way over its length, stretched by the object's
 * `stretch`. Null for anything else, for a wall turned by hand (pitch,
 * roll) and on level ground. The caller keeps sight blockers and what
 * towers stand on level: what the line of sight and the build rules see
 * stays as it was. `shear` is the matrix's (model y per model x): the
 * slope times the stretch.
 */
export function wallShear(
  f: ObjectFooting,
  o: MapObject,
  groundAt: (x: number, y: number) => number,
): { height: number; shear: number } | null {
  if (o.pitch || o.roll) return null;
  // The ground line in model x: its middle (x, z) and half length at scale 1
  let bx: number;
  let bz: number;
  let halfX: number;
  let stretch = 1;
  if (f.row) {
    stretch = o.stretch || 1;
    bx = 0;
    bz = 0;
    halfX = (f.row / 2) * stretch;
  } else if (f.category === 'wall' && f.box) {
    [bx, bz, halfX] = f.box;
  } else return null;
  const s = o.scale || 1;
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  // Model x and z in map space (object-ground.ts toModel, inverted)
  const xx = -cos;
  const xy = -sin;
  const zx = -sin;
  const zy = cos;
  const half = halfX * s;
  const cx = o.x + xx * bx * s + zx * bz * s;
  const cy = o.y + xy * bx * s + zy * bz * s;
  const h0 = groundAt(cx - xx * half, cy - xy * half);
  const h1 = groundAt(cx + xx * half, cy + xy * half);
  const slope = Math.min(MAX_WALL_SHEAR, Math.max(-MAX_WALL_SHEAR, (h1 - h0) / (2 * half)));
  if (Math.abs(slope) < 0.005) return null;
  // The foot's line through the middle of the ends, lowered where the ground in the middle lies below it
  const mid = (h0 + h1) / 2;
  const sink = Math.max(0, mid - groundAt(cx, cy)) + 0.04;
  return { height: mid - slope * bx * s - sink, shear: slope * stretch };
}
