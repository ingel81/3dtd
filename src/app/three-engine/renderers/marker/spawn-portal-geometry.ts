import { BufferGeometry, Float32BufferAttribute } from 'three';
import { PORTAL_OPENING_HEIGHT, PORTAL_OPENING_WIDTH } from '../../../configs/marker-geometry.config';

/**
 * Geometry of the spawn portal at scale 1, in portal space: x across the
 * street, y up from the ground, z the way the enemies walk out. The
 * opening spans x = ±HALF_OPENING from the ground to OPENING_HEIGHT in the
 * plane z = 0. The frame top and radius are in marker-geometry.config.ts
 * (PORTAL_FRAME_TOP, PORTAL_RADIUS), a spec holds them to this geometry.
 */

const HALF_OPENING = PORTAL_OPENING_WIDTH / 2;
const OPENING_HEIGHT = PORTAL_OPENING_HEIGHT;

/** Pillars and plinths reach this far below the ground (m), so a slope leaves no gap. */
const BURY = 2;

/**
 * A block from a bottom rectangle to a top rectangle, both level and
 * centred at (x, z); a spike when the top has no size.
 */
interface Block {
  x0: number; y0: number; z0: number; w0: number; d0: number;
  x1: number; y1: number; z1: number; w1: number; d1: number;
}

/** Blocks on the +x side; the frame mirrors them to -x. */
const SIDE_BLOCKS: readonly Block[] = [
  // Plinth under the pillar
  { x0: HALF_OPENING + 1.5, y0: -BURY, z0: 0, w0: 3.2, d0: 4.2, x1: HALF_OPENING + 1.5, y1: 1.4, z1: 0, w1: 2.8, d1: 3.8 },
  // Pillar: the inner face stands plumb on the opening's edge, the outer one leans in
  { x0: HALF_OPENING + 1.15, y0: -BURY, z0: 0, w0: 2.3, d0: 3.2, x1: HALF_OPENING + 0.8, y1: OPENING_HEIGHT + 2.4, z1: 0, w1: 1.6, d1: 2.6 },
  // Spire out of the lintel, leaning outward like a claw
  { x0: HALF_OPENING + 1.2, y0: OPENING_HEIGHT + 2.2, z0: 0, w0: 1.3, d0: 1.5, x1: HALF_OPENING + 2.6, y1: 15, z1: 0, w1: 0, d1: 0 },
];

/** Blocks on the centre line. */
const CENTRE_BLOCKS: readonly Block[] = [
  // Lintel across both pillars, wider at the top
  { x0: 0, y0: OPENING_HEIGHT, z0: 0, w0: 11.8, d0: 2.9, x1: 0, y1: OPENING_HEIGHT + 2.6, z1: 0, w1: 12.8, d1: 3.3 },
  // Crown: a base on the lintel and a spike on it
  { x0: 0, y0: OPENING_HEIGHT + 2.6, z0: 0, w0: 3.6, d0: 2.6, x1: 0, y1: OPENING_HEIGHT + 3.6, z1: 0, w1: 2.6, d1: 2 },
  { x0: 0, y0: OPENING_HEIGHT + 3.6, z0: 0, w0: 2.6, d0: 2, x1: 0, y1: 15.5, z1: 0, w1: 0, d1: 0 },
];

const FRAME_BLOCKS: readonly Block[] = [
  ...SIDE_BLOCKS,
  ...SIDE_BLOCKS.map((b) => ({ ...b, x0: -b.x0, x1: -b.x1 })),
  ...CENTRE_BLOCKS,
];

type Corner = readonly [number, number, number];

/** Push a triangle unless it has no area (the top of a spike). */
function pushTriangle(out: number[], a: Corner, b: Corner, c: Corner): void {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  if (cx * cx + cy * cy + cz * cz < 1e-12) return;
  out.push(...a, ...b, ...c);
}

/** Six faces of a block, wound counter-clockwise seen from outside. */
function pushBlock(out: number[], b: Block): void {
  // Corners: 0 = (-x, -z), 1 = (+x, -z), 2 = (+x, +z), 3 = (-x, +z)
  const corner = (x: number, y: number, z: number, w: number, d: number, i: number): Corner => [
    x + (i === 1 || i === 2 ? w / 2 : -w / 2),
    y,
    z + (i >= 2 ? d / 2 : -d / 2),
  ];
  const [b0, b1, b2, b3] = [0, 1, 2, 3].map((i) => corner(b.x0, b.y0, b.z0, b.w0, b.d0, i));
  const [t0, t1, t2, t3] = [0, 1, 2, 3].map((i) => corner(b.x1, b.y1, b.z1, b.w1, b.d1, i));
  pushTriangle(out, b0, b1, b2); pushTriangle(out, b0, b2, b3); // bottom
  pushTriangle(out, t0, t2, t1); pushTriangle(out, t0, t3, t2); // top
  pushTriangle(out, b3, b2, t2); pushTriangle(out, b3, t2, t3); // +z
  pushTriangle(out, b1, b0, t0); pushTriangle(out, b1, t0, t1); // -z
  pushTriangle(out, b2, b1, t1); pushTriangle(out, b2, t1, t2); // +x
  pushTriangle(out, b0, b3, t3); pushTriangle(out, b0, t3, t0); // -x
}

/**
 * Stone frame: plinths, two pillars, lintel, crown and two spires. Not
 * indexed, so the normals come out flat per face.
 */
export function createPortalFrameGeometry(): BufferGeometry {
  const positions: number[] = [];
  for (const block of FRAME_BLOCKS) pushBlock(positions, block);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Layout of the energy geometry at scale 1 (m), handed to its shader: the
 * opening, and the patch of street the portal lights (half width, depth
 * behind and in front of the portal plane).
 */
export const PORTAL_ENERGY_LAYOUT = {
  halfOpening: HALF_OPENING,
  openingHeight: OPENING_HEIGHT,
  groundHalfWidth: HALF_OPENING * 1.6,
  groundBack: HALF_OPENING * 0.8,
  groundFront: HALF_OPENING * 2.2,
} as const;

/** Lift of the ground patch over the ground at the route start (m). */
const GROUND_LIFT = 0.25;

/**
 * Energy of the portal: the surface in the opening (aPart 0), reaching
 * into the pillars and below the ground so no seam shows, and the patch of
 * street it lights (aPart 1), just above the ground.
 */
export function createPortalEnergyGeometry(): BufferGeometry {
  const L = PORTAL_ENERGY_LAYOUT;
  const sx = L.halfOpening + 0.3;
  const sy0 = -0.6;
  const sy1 = L.openingHeight + 0.3;
  const gx = L.groundHalfWidth;
  const gz0 = -L.groundBack;
  const gz1 = L.groundFront;
  const y = GROUND_LIFT;
  const positions = [
    // Surface, facing +z
    -sx, sy0, 0, sx, sy0, 0, sx, sy1, 0,
    -sx, sy0, 0, sx, sy1, 0, -sx, sy1, 0,
    // Ground patch, facing up
    -gx, y, gz0, gx, y, gz1, gx, y, gz0,
    -gx, y, gz0, -gx, y, gz1, gx, y, gz1,
  ];
  const parts = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aPart', new Float32BufferAttribute(parts, 1));
  return geometry;
}
