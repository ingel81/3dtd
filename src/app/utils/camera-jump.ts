/** Point or direction in local coordinates. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Closest a quick jump puts the camera to its target, along the view ray (m). */
export const JUMP_MIN_DISTANCE_M = 80;
/** Farthest, so a camera zoomed far out still lands close enough to see the target (m). */
export const JUMP_MAX_DISTANCE_M = 900;

/**
 * Camera position that shows `target` the way the camera shows the ground
 * now: same orientation, the target where the centre of the view is now. The
 * distance along the view ray is the current one down to the target's height,
 * held within [min, max]. Null when the camera looks at or above the horizon,
 * there is no ground point to keep then.
 *
 * @param direction unit view direction of the camera
 */
export function jumpCameraPosition(
  position: Vec3,
  direction: Vec3,
  target: Vec3,
  min = JUMP_MIN_DISTANCE_M,
  max = JUMP_MAX_DISTANCE_M,
): Vec3 | null {
  if (direction.y > -0.05) return null;
  const along = (target.y - position.y) / direction.y;
  const distance = Math.min(max, Math.max(min, along));
  return {
    x: target.x - direction.x * distance,
    y: target.y - direction.y * distance,
    z: target.z - direction.z * distance,
  };
}

/** Ease in and out, 0..1 to 0..1. */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
