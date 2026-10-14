import { Vector3, type Camera, type Object3D } from 'three';

/** Radius (m) the sun's shadow box keeps at least and reaches at most around its centre (its top step, 2^8.75) */
export const SHADOW_BOX_MIN = 70;
export const SHADOW_BOX_MAX = 430;

/** Points along the screen's border (NDC): where the visible ground ends */
const BORDER = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];
/** The box reaches this many times the camera's distance from the focus, at most */
const REACH = 2.5;
const points = BORDER.map(() => new Vector3());
const eye = new Vector3();
const dir = new Vector3();

/**
 * Fits the sun's shadow box to the ground the camera sees: each point of the
 * screen's border is followed down to the plane at the focus's height, no
 * further from the focus than 2.5 times the camera's distance and
 * SHADOW_BOX_MAX (a look over the horizon ends there), and the box takes the
 * circle round them and the focus (its
 * centre at most 0.6 of the largest box from the focus). Sized by
 * the camera's distance alone, the box left the far corners of an oblique
 * view without trees' shadows, and every zoom notch took a band more.
 *
 * `focus` and the returned centre (into `center`) are in `frame`'s space
 * (the map group's); returns the radius, a tenth more than the circle's for
 * ground below the plane and the box's lag when it moves, within
 * SHADOW_BOX_MIN and SHADOW_BOX_MAX.
 */
export function fitShadowBox(camera: Camera, frame: Object3D, focus: Vector3, center: Vector3): number {
  camera.getWorldPosition(eye);
  frame.worldToLocal(eye);
  // A camera below the focus (looking up a slope) still finds a plane under it
  const plane = Math.min(focus.y, eye.y - 2);
  // How far from the focus the box reaches: beyond REACH times the camera's distance the trees are small and
  // in the haze, and a box out to the horizon would blur the shadows up close (one map for all)
  const limit = Math.min(SHADOW_BOX_MAX, eye.distanceTo(focus) * REACH);
  let minX = focus.x;
  let maxX = focus.x;
  let minZ = focus.z;
  let maxZ = focus.z;
  for (let k = 0; k < BORDER.length; k++) {
    const p = points[k];
    p.set(BORDER[k][0], BORDER[k][1], 0.5).unproject(camera);
    frame.worldToLocal(p);
    dir.subVectors(p, eye).normalize();
    if (dir.y < -1e-4) {
      p.copy(eye).addScaledVector(dir, (plane - eye.y) / dir.y);
    } else {
      // Over the horizon: as far as the box reaches, in the look's direction
      const flat = Math.hypot(dir.x, dir.z) || 1;
      p.set(eye.x + (dir.x / flat) * limit * 2, plane, eye.z + (dir.z / flat) * limit * 2);
    }
    const dx = p.x - focus.x;
    const dz = p.z - focus.z;
    const far = Math.hypot(dx, dz);
    if (far > limit) {
      p.x = focus.x + (dx / far) * limit;
      p.z = focus.z + (dz / far) * limit;
    }
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  center.set((minX + maxX) / 2, focus.y, (minZ + maxZ) / 2);
  // A wide view past the cap: the box keeps the near ground, it stays no further than 0.6 of it from the focus
  const off = Math.hypot(center.x - focus.x, center.z - focus.z);
  if (off > SHADOW_BOX_MAX * 0.6) center.lerpVectors(focus, center, (SHADOW_BOX_MAX * 0.6) / off).setY(focus.y);
  let radius = Math.hypot(focus.x - center.x, focus.z - center.z);
  for (const p of points) radius = Math.max(radius, Math.hypot(p.x - center.x, p.z - center.z));
  return Math.min(SHADOW_BOX_MAX, Math.max(SHADOW_BOX_MIN, radius * 1.1));
}
