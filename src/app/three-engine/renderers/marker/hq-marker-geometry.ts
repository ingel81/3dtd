import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, PlaneGeometry } from 'three';
import { MARKER_CORE_RADIUS, MARKER_FLOAT_HEIGHT, MARKER_Y_STRETCH } from '../../../configs/marker-geometry.config';

// Geometry of the HQ marker (MarkerInstanceManager). Each part carries a
// per-vertex layer attribute so a crystal with its core, or the ground disc
// with its light pillar, is one geometry and one draw call.

/** Half height of the crystal (m): tip to centre, as the old octahedron. */
export const HQ_CRYSTAL_HALF_HEIGHT = MARKER_CORE_RADIUS * MARKER_Y_STRETCH;

/** Height of the ground disc above the terrain (m). */
export const HQ_GROUND_LIFT = 2;

/** Radius of the ground emblem (m). */
export const HQ_GROUND_RADIUS = 22;

/** Rings round the crystal: radius and tube of the inner one (m), and the outer one's radius as a multiple of it. */
export const HQ_RING_RADIUS = 14;
export const HQ_RING_TUBE = 0.3;
export const HQ_OUTER_RING_SCALE = 1.12;

/** Radius of the light pillar from the ground disc up to the crystal (m). */
const PILLAR_RADIUS = 1.8;

/** Sides of the crystal: a hexagonal bipyramid with a short girdle between the pyramids. */
const CRYSTAL_SIDES = 6;

/** Girdle of the crystal: bottom and top above the centre (m). */
const GIRDLE_BOTTOM = -2.5;
const GIRDLE_TOP = 3.5;

/** Energy core inside the crystal: radius and half height (m). */
const CORE_RADIUS = 3.8;
const CORE_HALF_HEIGHT = 8;

/**
 * Flat-shaded triangle soup from `tris` (three xyz corners each): position,
 * face normal, barycentric corner (aBary, for the edge lines) and `layer`.
 */
function pushTriangles(
  tris: number[][],
  layer: number,
  out: { position: number[]; normal: number[]; bary: number[]; layer: number[] },
): void {
  for (const [ax, ay, az, bx, by, bz, cx, cy, cz] of tris) {
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    out.position.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    out.normal.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    out.bary.push(1, 0, 0, 0, 1, 0, 0, 0, 1);
    out.layer.push(layer, layer, layer);
  }
}

/** Point on a ring of `sides` corners at `radius` and height `y`, corner `i`. */
function corner(i: number, sides: number, radius: number, y: number, twist = 0): number[] {
  const a = (i / sides) * Math.PI * 2 + twist;
  return [Math.cos(a) * radius, y, Math.sin(a) * radius];
}

/**
 * The crystal: the energy core (layer 1) first, then the shell (layer 0),
 * so the transparent shell blends over the core it holds in one draw call.
 * Counter-clockwise outside, for FrontSide. `parts` leaves one of them out
 * (the placement preview draws them in separate materials).
 */
export function createCrystalGeometry(parts: { core?: boolean; shell?: boolean } = {}): BufferGeometry {
  const { core = true, shell = true } = parts;
  const out = { position: [] as number[], normal: [] as number[], bary: [] as number[], layer: [] as number[] };

  // Core: a small octahedron
  const coreTris: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const a = corner(i, 4, CORE_RADIUS, 0);
    const b = corner(i + 1, 4, CORE_RADIUS, 0);
    coreTris.push([0, CORE_HALF_HEIGHT, 0, ...b, ...a]);
    coreTris.push([0, -CORE_HALF_HEIGHT, 0, ...a, ...b]);
  }
  if (core) pushTriangles(coreTris, 1, out);

  // Shell: top pyramid, girdle, bottom pyramid; the girdle's top ring is
  // turned half a side, so the facets zigzag like a cut stone
  const h = HQ_CRYSTAL_HALF_HEIGHT;
  const r = MARKER_CORE_RADIUS;
  const half = Math.PI / CRYSTAL_SIDES;
  const shellTris: number[][] = [];
  for (let i = 0; i < CRYSTAL_SIDES; i++) {
    const t0 = corner(i, CRYSTAL_SIDES, r * 0.94, GIRDLE_TOP, half);
    const t1 = corner(i + 1, CRYSTAL_SIDES, r * 0.94, GIRDLE_TOP, half);
    const b0 = corner(i, CRYSTAL_SIDES, r, GIRDLE_BOTTOM);
    const b1 = corner(i + 1, CRYSTAL_SIDES, r, GIRDLE_BOTTOM);
    shellTris.push([0, h, 0, ...t1, ...t0]);
    shellTris.push([...b0, ...t0, ...b1]);
    shellTris.push([...b1, ...t0, ...t1]);
    shellTris.push([0, -h, 0, ...b0, ...b1]);
  }
  if (shell) pushTriangles(shellTris, 0, out);

  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(out.position, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(out.normal, 3));
  geom.setAttribute('aBary', new Float32BufferAttribute(out.bary, 3));
  geom.setAttribute('aLayer', new Float32BufferAttribute(out.layer, 1));
  return geom;
}

/** Light pillar of `height` (m), open, narrowing upward, from its origin up. */
export function createPillarGeometry(height: number): BufferGeometry {
  const pillar = new CylinderGeometry(PILLAR_RADIUS * 0.6, PILLAR_RADIUS, height, 12, 1, true);
  pillar.translate(0, height / 2, 0);
  return pillar;
}

/**
 * Ground emblem (layer 0) and light pillar (layer 1) in one geometry, origin
 * on the ground disc. The pillar reaches from the disc to the crystal's
 * lower tip at rest; its uv.y runs 0 at the disc to 1 at the tip.
 */
export function createGroundGeometry(): BufferGeometry {
  const disc = new PlaneGeometry(HQ_GROUND_RADIUS * 2, HQ_GROUND_RADIUS * 2);
  disc.rotateX(-Math.PI / 2);

  const pillar = createPillarGeometry(MARKER_FLOAT_HEIGHT - HQ_GROUND_LIFT - HQ_CRYSTAL_HALF_HEIGHT);

  const parts = [disc.toNonIndexed(), pillar.toNonIndexed()];
  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const layer: number[] = [];
  parts.forEach((part, index) => {
    position.push(...(part.getAttribute('position').array as Float32Array));
    normal.push(...(part.getAttribute('normal').array as Float32Array));
    uv.push(...(part.getAttribute('uv').array as Float32Array));
    for (let i = 0; i < part.getAttribute('position').count; i++) layer.push(index);
    part.dispose();
  });
  disc.dispose();
  pillar.dispose();

  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(position, 3));
  geom.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  geom.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geom.setAttribute('aLayer', new Float32BufferAttribute(layer, 1));
  return geom;
}
