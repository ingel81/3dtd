/**
 * The ground an object takes: the disc of its catalogue footprint (radius at
 * scale 1) and, for buildings and walls, the turned rectangle of its
 * catalogue `box` (tools/map-assets/measure_boxes.mjs). The ground is where
 * both hold: a long building takes its rectangle, not the disc of half its
 * length (a 46 m school: 21 m round, over the street), a round tower its
 * disc, not the corners of its square. Building bans (CustomMapSurface) and
 * the seat of a model (object-seat.ts) read it.
 */
import type { MapObject } from './map-document';

/** Ground rectangle at scale 1: its middle in the model's x and z, its half width (x) and half depth (z) */
export type GroundBox = readonly [number, number, number, number];

/**
 * The model's x and z of a map offset (dx, dy) from its origin, turned by
 * `rotation` (the renderer turns local +z to the map's (-sin, cos) and local
 * +x to (-cos, -sin): scene x is map -x, map-coords.ts)
 */
export function toModel(dx: number, dy: number, cos: number, sin: number): { x: number; z: number } {
  return { x: -dx * cos - dy * sin, z: -dx * sin + dy * cos };
}

/** Distance (m) from map offset (dx, dy) of an object's origin to its ground rectangle, 0 inside */
export function boxDistance(box: GroundBox, scale: number, dx: number, dy: number, cos: number, sin: number): number {
  const m = toModel(dx, dy, cos, sin);
  return Math.hypot(Math.max(0, Math.abs(m.x - box[0] * scale) - box[2] * scale), Math.max(0, Math.abs(m.z - box[1] * scale) - box[3] * scale));
}

/**
 * Eight points on the edge of an object's ground, map coordinates, into
 * `out` (x, y pairs): the corners and side middles of its rectangle pulled
 * into its disc; without a rectangle eight points round the disc
 */
export function groundRing(footprint: number, box: GroundBox | undefined, o: Pick<MapObject, 'x' | 'y' | 'rotation' | 'scale'>, out: number[] = []): number[] {
  const s = o.scale || 1;
  const r = footprint * s;
  out.length = 0;
  if (!box) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      out.push(o.x + Math.cos(a) * r, o.y + Math.sin(a) * r);
    }
    return out;
  }
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  for (let k = 0; k < 8; k++) {
    // Side middles at the even steps, corners at the odd ones
    const a = (k / 8) * Math.PI * 2;
    const ux = Math.abs(Math.cos(a)) < 1e-9 ? 0 : Math.sign(Math.cos(a));
    const uz = Math.abs(Math.sin(a)) < 1e-9 ? 0 : Math.sign(Math.sin(a));
    let x = (box[0] + ux * box[2]) * s;
    let z = (box[1] + uz * box[3]) * s;
    const d = Math.hypot(x, z);
    if (d > r) {
      x *= r / d;
      z *= r / d;
    }
    // Model (x, z) to the map: the inverse of toModel
    out.push(o.x - (x * cos + z * sin), o.y - x * sin + z * cos);
  }
  return out;
}
