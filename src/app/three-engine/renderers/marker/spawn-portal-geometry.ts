import { BufferGeometry, Float32BufferAttribute } from 'three';
import {
  PORTAL_DEPTH,
  PORTAL_FRAME_TOP,
  PORTAL_OPENING_HEIGHT,
  PORTAL_OPENING_WIDTH,
} from '../../../configs/marker-geometry.config';

/**
 * Geometry of the spawn portal at scale 1, in portal space: x across the
 * street, y up from the ground, z the way the enemies walk out, the origin
 * on the route start. The opening spans x = ±HALF_OPENING from the ground
 * to OPENING_HEIGHT; it is a volume PORTAL_DEPTH deep, closed by a surface
 * at z = ±HALF_DEPTH, by the pillars on the sides and the lintel above.
 * The frame top and radius are in marker-geometry.config.ts
 * (PORTAL_FRAME_TOP, PORTAL_RADIUS), a spec holds them to this geometry.
 */

const HALF_OPENING = PORTAL_OPENING_WIDTH / 2;
const OPENING_HEIGHT = PORTAL_OPENING_HEIGHT;
const HALF_DEPTH = PORTAL_DEPTH / 2;

/** Stone in front of each surface (m): pillars and lintel reach this far past the volume. */
const WALL = 0.3;

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

/** Tops of the upper plinth step, the lintel and the cornice slab above the ground (m). */
export const PORTAL_PLINTH_TOP = 1.9;
export const PORTAL_LINTEL_TOP = OPENING_HEIGHT + 3;
export const PORTAL_CORNICE_TOP = PORTAL_LINTEL_TOP + 0.7;

/**
 * The plinths' inner faces stand this far back from the opening's edge
 * (m): flush with the pillar's inner face they would share its plane and
 * flicker against it.
 */
const PLINTH_SETBACK = 0.05;

/** Blocks on the +x side; the frame mirrors them to -x. */
const SIDE_BLOCKS: readonly Block[] = [
  // Plinth under the pillar in two steps, just back from the opening's edge
  {
    x0: HALF_OPENING + PLINTH_SETBACK + 1.875, y0: -BURY, z0: 0, w0: 3.75, d0: PORTAL_DEPTH + 1.8,
    x1: HALF_OPENING + PLINTH_SETBACK + 1.875, y1: 0.8, z1: 0, w1: 3.75, d1: PORTAL_DEPTH + 1.6,
  },
  {
    x0: HALF_OPENING + PLINTH_SETBACK + 1.6, y0: 0.8, z0: 0, w0: 3.2, d0: PORTAL_DEPTH + 1.1,
    x1: HALF_OPENING + PLINTH_SETBACK + 1.65, y1: PORTAL_PLINTH_TOP, z1: 0, w1: 3.1, d1: PORTAL_DEPTH + 0.8,
  },
  // Pillar: the side wall of the volume. The inner face stands plumb on the
  // opening's edge, the outer one leans in; it ends inside the lintel
  {
    x0: HALF_OPENING + 1.4, y0: -BURY, z0: 0, w0: 2.8, d0: PORTAL_DEPTH + 2 * WALL + 0.2,
    x1: HALF_OPENING + 1, y1: PORTAL_LINTEL_TOP - 0.2, z1: 0, w1: 2, d1: PORTAL_DEPTH + 2 * WALL,
  },
  // Horn out of the cornice's end: out, up, and curling back in at the tip
  { x0: HALF_OPENING + 2.5, y0: PORTAL_CORNICE_TOP, z0: 0, w0: 1.8, d0: 2.1, x1: HALF_OPENING + 3.4, y1: PORTAL_CORNICE_TOP + 1.9, z1: 0, w1: 1.4, d1: 1.6 },
  { x0: HALF_OPENING + 3.4, y0: PORTAL_CORNICE_TOP + 1.9, z0: 0, w0: 1.4, d0: 1.6, x1: HALF_OPENING + 3.7, y1: PORTAL_CORNICE_TOP + 3.3, z1: 0, w1: 0.8, d1: 0.9 },
  { x0: HALF_OPENING + 3.7, y0: PORTAL_CORNICE_TOP + 3.3, z0: 0, w0: 0.8, d0: 0.9, x1: HALF_OPENING + 3.2, y1: PORTAL_CORNICE_TOP + 4.5, z1: 0, w1: 0, d1: 0 },
  // Jagged spike beside the crown, leaning outward
  { x0: 2.4, y0: PORTAL_CORNICE_TOP, z0: 0, w0: 1.5, d0: 1.8, x1: 3.2, y1: PORTAL_CORNICE_TOP + 2.7, z1: 0, w1: 0, d1: 0 },
];

/** Blocks on the centre line. */
const CENTRE_BLOCKS: readonly Block[] = [
  // Lintel across both pillars, wider at the top: the volume's roof
  {
    x0: 0, y0: OPENING_HEIGHT, z0: 0, w0: 13.2, d0: PORTAL_DEPTH + 2 * WALL,
    x1: 0, y1: PORTAL_LINTEL_TOP, z1: 0, w1: 14, d1: PORTAL_DEPTH + 2 * WALL + 0.2,
  },
  // Cornice slab overhanging the lintel
  {
    x0: 0, y0: PORTAL_LINTEL_TOP, z0: 0, w0: 15.4, d0: PORTAL_DEPTH + 1.4,
    x1: 0, y1: PORTAL_CORNICE_TOP, z1: 0, w1: 15, d1: PORTAL_DEPTH + 1.2,
  },
  // Crown: a base on the cornice and a spike on it, the top of the frame
  { x0: 0, y0: PORTAL_CORNICE_TOP, z0: 0, w0: 4.2, d0: 3, x1: 0, y1: PORTAL_CORNICE_TOP + 1.1, z1: 0, w1: 3.2, d1: 2.4 },
  { x0: 0, y0: PORTAL_CORNICE_TOP + 1.1, z0: 0, w0: 3.2, d0: 2.4, x1: 0, y1: PORTAL_FRAME_TOP, z1: 0, w1: 0, d1: 0 },
];

const FRAME_BLOCKS: readonly Block[] = [
  ...SIDE_BLOCKS,
  ...SIDE_BLOCKS.map((b) => ({ ...b, x0: -b.x0, x1: -b.x1 })),
  ...CENTRE_BLOCKS,
];

/**
 * Vertex data of the frame. Besides its position every vertex knows where
 * it lies on its face, for the worn edges in the gate shader: `face` holds
 * (across the face from its centre line, along x, or along z on the ±x
 * sides; up the face from its lower edge, along z on tops and bottoms; the
 * face's height), `width` the face's width at its lower and upper edge, all
 * in metres. Both are affine over a face, so they interpolate exactly.
 */
interface FrameBuffers {
  positions: number[];
  face: number[];
  width: number[];
}

type Corner = readonly [number, number, number];

/** Twice the area of a triangle, squared. */
function areaSq(a: Corner, b: Corner, c: Corner): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  return cx * cx + cy * cy + cz * cz;
}

/**
 * Push a planar face with corners p0 to p3, counter-clockwise seen from
 * outside: p0 to p1 is its lower edge, p3 to p2 its upper edge, both along
 * the axis `across` (0 = x, 2 = z). A triangle without area (the top of a
 * spike) is left out.
 */
function pushFace(out: FrameBuffers, p0: Corner, p1: Corner, p2: Corner, p3: Corner, across: 0 | 2): void {
  const mid = (a: Corner, b: Corner): Corner => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const lower = mid(p0, p1);
  const upper = mid(p2, p3);
  const height = Math.hypot(upper[0] - lower[0], upper[1] - lower[1], upper[2] - lower[2]);
  const w0 = Math.abs(p1[across] - p0[across]);
  const w1 = Math.abs(p2[across] - p3[across]);
  const corners = [
    { at: p0, place: [p0[across] - lower[across], 0, height] },
    { at: p1, place: [p1[across] - lower[across], 0, height] },
    { at: p2, place: [p2[across] - upper[across], height, height] },
    { at: p3, place: [p3[across] - upper[across], height, height] },
  ];
  for (const triangle of [[0, 1, 2], [0, 2, 3]]) {
    const [a, b, c] = triangle.map((i) => corners[i]);
    if (areaSq(a.at, b.at, c.at) < 1e-12) continue;
    for (const corner of [a, b, c]) {
      out.positions.push(...corner.at);
      out.face.push(...corner.place);
      out.width.push(w0, w1);
    }
  }
}

/** Six faces of a block, wound counter-clockwise seen from outside. */
function pushBlock(out: FrameBuffers, b: Block): void {
  // Corners: 0 = (-x, -z), 1 = (+x, -z), 2 = (+x, +z), 3 = (-x, +z)
  const corner = (x: number, y: number, z: number, w: number, d: number, i: number): Corner => [
    x + (i === 1 || i === 2 ? w / 2 : -w / 2),
    y,
    z + (i >= 2 ? d / 2 : -d / 2),
  ];
  const [b0, b1, b2, b3] = [0, 1, 2, 3].map((i) => corner(b.x0, b.y0, b.z0, b.w0, b.d0, i));
  const [t0, t1, t2, t3] = [0, 1, 2, 3].map((i) => corner(b.x1, b.y1, b.z1, b.w1, b.d1, i));
  pushFace(out, b0, b1, b2, b3, 0); // bottom
  pushFace(out, t1, t0, t3, t2, 0); // top
  pushFace(out, b3, b2, t2, t3, 0); // +z
  pushFace(out, b1, b0, t0, t1, 0); // -z
  pushFace(out, b2, b1, t1, t2, 2); // +x
  pushFace(out, b0, b3, t3, t0, 2); // -x
}

/** Vertex data of all frame blocks. */
function frameBuffers(): FrameBuffers {
  const out: FrameBuffers = { positions: [], face: [], width: [] };
  for (const block of FRAME_BLOCKS) pushBlock(out, block);
  return out;
}

function toGeometry(buffers: FrameBuffers): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('aFace', new Float32BufferAttribute(buffers.face, 3));
  geometry.setAttribute('aWidth', new Float32BufferAttribute(buffers.width, 2));
  return geometry;
}

/**
 * Stone frame: stepped plinths, two pillars, lintel and cornice, a crown
 * between two jagged spikes, two horns. Not indexed, so the normals come
 * out flat per face; aFace and aWidth place each vertex on its face (see
 * FrameBuffers). The placement preview draws it; the portal manager draws
 * the gate (createPortalGateGeometry).
 */
export function createPortalFrameGeometry(): BufferGeometry {
  const geometry = toGeometry(frameBuffers());
  geometry.computeVertexNormals();
  return geometry;
}

/** How far the void reaches into the pillars and the lintel (m), so no seam shows. */
const VOID_OVERLAP = 0.3;

/** Bottom of the void below the ground (m), so a slope leaves no gap. */
const VOID_BOTTOM = -0.6;

/**
 * The gate the portal manager draws: the stone frame (aPart 0) and the
 * void (aPart 1), a surface in front of the volume at z = +HALF_DEPTH
 * facing the way the enemies walk out and one behind it at z = -HALF_DEPTH
 * facing back. Both are opaque and write depth: an enemy on the route
 * start stands between them with its health bar, hidden from every side,
 * until it steps out through the front, and the street behind the portal
 * does not show through.
 */
export function createPortalGateGeometry(): BufferGeometry {
  const buffers = frameBuffers();
  const stoneVertices = buffers.positions.length / 3;
  const sx = HALF_OPENING + VOID_OVERLAP;
  const sy0 = VOID_BOTTOM;
  const sy1 = OPENING_HEIGHT + VOID_OVERLAP;
  const sz = HALF_DEPTH;
  buffers.positions.push(
    // In front, facing +z, the way the enemies walk out
    -sx, sy0, sz, sx, sy0, sz, sx, sy1, sz,
    -sx, sy0, sz, sx, sy1, sz, -sx, sy1, sz,
    // Behind, facing -z
    -sx, sy0, -sz, sx, sy1, -sz, sx, sy0, -sz,
    -sx, sy0, -sz, -sx, sy1, -sz, sx, sy1, -sz,
  );
  const vertices = buffers.positions.length / 3;
  for (let i = stoneVertices; i < vertices; i++) {
    buffers.face.push(0, 0, 0);
    buffers.width.push(0, 0);
  }
  const geometry = toGeometry(buffers);
  geometry.setAttribute('aPart', new Float32BufferAttribute(new Float32Array(vertices).fill(1, stoneVertices), 1));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Layout of the portal at scale 1 (m), handed to its shaders: the opening,
 * half the volume's depth, and the patch of street the portal lights (half
 * width, depth behind the back surface and in front of the front one).
 */
export const PORTAL_SHADER_LAYOUT = {
  halfOpening: HALF_OPENING,
  openingHeight: OPENING_HEIGHT,
  halfDepth: HALF_DEPTH,
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
  const gz0 = -(L.halfDepth + L.groundBack);
  const gz1 = L.halfDepth + L.groundFront;
  const y = GROUND_LIFT;
  const positions = [
    -gx, y, gz0, gx, y, gz1, gx, y, gz0,
    -gx, y, gz0, -gx, y, gz1, gx, y, gz1,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}
