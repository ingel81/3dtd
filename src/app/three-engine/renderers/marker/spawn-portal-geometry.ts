import { BufferGeometry, Float32BufferAttribute } from 'three';
import {
  PORTAL_FRAME_TOP,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
} from '../../../configs/marker-geometry.config';

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

/** Top of the lintel and of the cornice slab on it, above the ground (m). */
const LINTEL_TOP = OPENING_HEIGHT + 3;
const CORNICE_TOP = LINTEL_TOP + 0.7;

/** Blocks on the +x side; the frame mirrors them to -x. */
const SIDE_BLOCKS: readonly Block[] = [
  // Plinth under the pillar in two steps, flush with the opening's edge
  { x0: HALF_OPENING + 1.9, y0: -BURY, z0: 0, w0: 3.8, d0: 5.2, x1: HALF_OPENING + 1.9, y1: 0.8, z1: 0, w1: 3.8, d1: 5 },
  { x0: HALF_OPENING + 1.6, y0: 0.8, z0: 0, w0: 3.2, d0: 4.5, x1: HALF_OPENING + 1.65, y1: 1.9, z1: 0, w1: 3.1, d1: 4.2 },
  // Pillar: the inner face stands plumb on the opening's edge, the outer
  // one leans in; it ends inside the lintel
  { x0: HALF_OPENING + 1.4, y0: -BURY, z0: 0, w0: 2.8, d0: 4, x1: HALF_OPENING + 1, y1: LINTEL_TOP - 0.2, z1: 0, w1: 2, d1: 3.4 },
  // Horn out of the cornice's end: out, up, and curling back in at the tip
  { x0: HALF_OPENING + 2.5, y0: CORNICE_TOP, z0: 0, w0: 1.8, d0: 2.1, x1: HALF_OPENING + 3.4, y1: CORNICE_TOP + 1.9, z1: 0, w1: 1.4, d1: 1.6 },
  { x0: HALF_OPENING + 3.4, y0: CORNICE_TOP + 1.9, z0: 0, w0: 1.4, d0: 1.6, x1: HALF_OPENING + 3.7, y1: CORNICE_TOP + 3.3, z1: 0, w1: 0.8, d1: 0.9 },
  { x0: HALF_OPENING + 3.7, y0: CORNICE_TOP + 3.3, z0: 0, w0: 0.8, d0: 0.9, x1: HALF_OPENING + 3.2, y1: CORNICE_TOP + 4.5, z1: 0, w1: 0, d1: 0 },
  // Jagged spike beside the crown, leaning outward
  { x0: 2.4, y0: CORNICE_TOP, z0: 0, w0: 1.5, d0: 1.8, x1: 3.2, y1: CORNICE_TOP + 2.7, z1: 0, w1: 0, d1: 0 },
];

/** Blocks on the centre line. */
const CENTRE_BLOCKS: readonly Block[] = [
  // Lintel across both pillars, wider at the top, deep enough to cover the
  // spawn behind the surface from above
  { x0: 0, y0: OPENING_HEIGHT, z0: 0, w0: 13.2, d0: 4, x1: 0, y1: LINTEL_TOP, z1: 0, w1: 14, d1: 4.2 },
  // Cornice slab overhanging the lintel
  { x0: 0, y0: LINTEL_TOP, z0: 0, w0: 15.4, d0: 4.8, x1: 0, y1: CORNICE_TOP, z1: 0, w1: 15, d1: 4.6 },
  // Crown: a base on the cornice and a spike on it, the top of the frame
  { x0: 0, y0: CORNICE_TOP, z0: 0, w0: 4.2, d0: 3, x1: 0, y1: CORNICE_TOP + 1.1, z1: 0, w1: 3.2, d1: 2.4 },
  { x0: 0, y0: CORNICE_TOP + 1.1, z0: 0, w0: 3.2, d0: 2.4, x1: 0, y1: PORTAL_FRAME_TOP, z1: 0, w1: 0, d1: 0 },
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

/** Triangles of all frame blocks. */
function framePositions(): number[] {
  const positions: number[] = [];
  for (const block of FRAME_BLOCKS) pushBlock(positions, block);
  return positions;
}

/**
 * Stone frame: stepped plinths, two pillars, lintel and cornice, a crown
 * between two jagged spikes, two horns. Not indexed, so the normals come
 * out flat per face. The placement preview
 * draws it; the portal manager draws the gate (createPortalGateGeometry).
 */
export function createPortalFrameGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(framePositions(), 3));
  geometry.computeVertexNormals();
  return geometry;
}

/** How far the void reaches into the pillars and the lintel (m), so no seam shows. */
const VOID_OVERLAP = 0.3;

/** Bottom of the void below the ground (m), so a slope leaves no gap. */
const VOID_BOTTOM = -0.6;

/**
 * The gate the portal manager draws: the stone frame (aPart 0) and the
 * void in the opening (aPart 1), two quads back to back in the plane
 * z = 0, one facing each way. The void is opaque and writes depth: an
 * enemy on the route start, just behind it (PORTAL_SETBACK), stays hidden
 * with its health bar until it steps out, and the street behind the portal
 * does not show through.
 */
export function createPortalGateGeometry(): BufferGeometry {
  const positions = framePositions();
  const stoneVertices = positions.length / 3;
  const sx = HALF_OPENING + VOID_OVERLAP;
  const sy0 = VOID_BOTTOM;
  const sy1 = OPENING_HEIGHT + VOID_OVERLAP;
  positions.push(
    // Facing +z, the way the enemies walk out
    -sx, sy0, 0, sx, sy0, 0, sx, sy1, 0,
    -sx, sy0, 0, sx, sy1, 0, -sx, sy1, 0,
    // Facing -z
    -sx, sy0, 0, sx, sy1, 0, sx, sy0, 0,
    -sx, sy0, 0, -sx, sy1, 0, sx, sy1, 0,
  );
  const parts = new Float32Array(positions.length / 3).fill(1, stoneVertices);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aPart', new Float32BufferAttribute(parts, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Layout of the portal at scale 1 (m), handed to its shaders: the opening,
 * and the patch of street the portal lights (half width, depth behind and
 * in front of the portal plane).
 */
export const PORTAL_SHADER_LAYOUT = {
  halfOpening: HALF_OPENING,
  openingHeight: OPENING_HEIGHT,
  groundHalfWidth: HALF_OPENING * 1.6,
  groundBack: HALF_OPENING * 0.8,
  groundFront: HALF_OPENING * 2.2,
} as const;

/** Lift of the ground patch over the ground at the route start (m). */
const GROUND_LIFT = 0.25;

/** The patch of street the portal lights, just above the ground, facing up. */
export function createPortalGlowGeometry(): BufferGeometry {
  const L = PORTAL_SHADER_LAYOUT;
  const gx = L.groundHalfWidth;
  const gz0 = -L.groundBack;
  const gz1 = L.groundFront;
  const y = GROUND_LIFT;
  const positions = [
    -gx, y, gz0, gx, y, gz1, gx, y, gz0,
    -gx, y, gz0, -gx, y, gz1, gx, y, gz1,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}
