import { BufferGeometry, Float32BufferAttribute } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PORTAL_DEPTH, PORTAL_OPENING_HEIGHT, PORTAL_OPENING_WIDTH } from '../../../configs/marker-geometry.config';

/**
 * Geometry of the spawn portal at scale 1, in portal space: x across the
 * street, y up from the ground, z the way the enemies walk out, the origin
 * on the route start. The opening spans x = ±HALF_OPENING from the ground
 * to OPENING_HEIGHT; it is a volume PORTAL_DEPTH deep, closed by a surface
 * at z = ±HALF_DEPTH, by the pillars on the sides and the lintel above.
 * The stone frame round it is an asset (spawn-portal-frame.ts, built by
 * tools/blender/spawn_portal.py); its top and radius are in
 * marker-geometry.config.ts, spawn-portal-frame.spec.ts holds the asset to
 * them and to the volume.
 */

const HALF_OPENING = PORTAL_OPENING_WIDTH / 2;
const OPENING_HEIGHT = PORTAL_OPENING_HEIGHT;
const HALF_DEPTH = PORTAL_DEPTH / 2;

/** How far the void reaches into the pillars and the lintel (m), so no seam shows. */
const VOID_OVERLAP = 0.3;

/** Bottom of the void below the ground (m), so a slope leaves no gap. */
const VOID_BOTTOM = -0.6;

/** The attributes the gate shader reads from the frame. */
const FRAME_ATTRIBUTES = ['position', 'normal', 'uv', 'tangent'] as const;

/**
 * The void: a quad in front of the volume at z = +HALF_DEPTH facing the
 * way the enemies walk out, one behind it at z = -HALF_DEPTH facing back,
 * with the attributes of the frame, indexed like it.
 */
function createVoidGeometry(): BufferGeometry {
  const sx = HALF_OPENING + VOID_OVERLAP;
  const y0 = VOID_BOTTOM;
  const y1 = OPENING_HEIGHT + VOID_OVERLAP;
  const sz = HALF_DEPTH;
  const positions = [
    // In front, facing +z
    -sx, y0, sz, sx, y0, sz, sx, y1, sz,
    -sx, y0, sz, sx, y1, sz, -sx, y1, sz,
    // Behind, facing -z
    -sx, y0, -sz, sx, y1, -sz, sx, y0, -sz,
    -sx, y0, -sz, -sx, y1, -sz, sx, y1, -sz,
  ];
  const vertices = positions.length / 3;
  const normals: number[] = [];
  const tangents: number[] = [];
  for (let i = 0; i < vertices; i++) {
    const front = i < vertices / 2;
    normals.push(0, 0, front ? 1 : -1);
    tangents.push(front ? 1 : -1, 0, 0, 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(vertices * 2), 2));
  geometry.setAttribute('tangent', new Float32BufferAttribute(tangents, 4));
  geometry.setAttribute('aPart', new Float32BufferAttribute(new Float32Array(vertices).fill(1), 1));
  geometry.setIndex([...Array(vertices).keys()]);
  return geometry;
}

/**
 * The gate the portal manager draws: the stone frame (aPart 0) and the
 * void (aPart 1), see createVoidGeometry. Both void surfaces are opaque
 * and write depth: an enemy on the route start stands between them with
 * its health bar, hidden from every side, until it steps out through the
 * front, and the street behind the portal does not show through. Without
 * a frame (its asset still loading or failed) the gate is the void alone;
 * the frame's geometry is copied, not changed.
 */
export function createPortalGateGeometry(frame: BufferGeometry | null): BufferGeometry {
  const voidGeometry = createVoidGeometry();
  if (!frame) return voidGeometry;
  const stone = new BufferGeometry();
  for (const name of FRAME_ATTRIBUTES) stone.setAttribute(name, frame.getAttribute(name));
  stone.setIndex(frame.getIndex());
  stone.setAttribute('aPart', new Float32BufferAttribute(new Float32Array(frame.getAttribute('position').count), 1));
  const gate = mergeGeometries([stone, voidGeometry]);
  voidGeometry.dispose();
  if (!gate) throw new Error('[SpawnPortal] The frame does not fit the void: their attributes differ');
  return gate;
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
