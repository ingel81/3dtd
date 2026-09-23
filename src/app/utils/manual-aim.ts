/**
 * Geometry of aiming a manned tower (docs/TOWER_CONTROL.md): the aim is a
 * heading (geoHeading convention: 0 = north, clockwise, east positive) and a
 * pitch (up positive), the shot a ray from the player's eye. Local frame as
 * everywhere: -X = east, +Y = up, +Z = north, metres.
 *
 * Pure functions without allocation; the combat and the camera share them,
 * so what the crosshair shows is what the shot tests.
 */

/** A point or direction in the local frame */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Unit direction of `heading` and `pitch`, written into `out`. */
export function aimDirectionInto(heading: number, pitch: number, out: Vec3): Vec3 {
  const cosP = Math.cos(pitch);
  out.x = -Math.sin(heading) * cosP;
  out.y = Math.sin(pitch);
  out.z = Math.cos(heading) * cosP;
  return out;
}

/** Heading (geoHeading convention) of a local direction; its y is ignored. */
export function headingOfLocal(dx: number, dz: number): number {
  return Math.atan2(-dx, dz);
}

/**
 * How far the eye sits behind the muzzle at `pitch`: `back` looking level
 * or up, sliding to `forwardDown` in front of it (negative back) at
 * `pitchMin`, smoothstepped.
 */
export function eyeBackAt(pitch: number, pitchMin: number, back: number, forwardDown: number): number {
  const t = Math.min(1, Math.max(0, pitch / pitchMin));
  const s = t * t * (3 - 2 * t);
  return back - (back + forwardDown) * s;
}

/**
 * The player's eye in a tower: `eyeUp` over its muzzle, `eyeBack` behind it
 * against the horizontal aim (negative: in front). Written into `out`.
 */
export function eyeInto(muzzle: Vec3, heading: number, eyeUp: number, eyeBack: number, out: Vec3): Vec3 {
  out.x = muzzle.x + Math.sin(heading) * eyeBack;
  out.y = muzzle.y + eyeUp;
  out.z = muzzle.z - Math.cos(heading) * eyeBack;
  return out;
}

/**
 * How far along the ray (`origin`, unit `dir`) it passes within `radius` of
 * `point`: the distance to the point's foot on the ray, or Infinity when it
 * passes wider or the point is behind the eye.
 */
export function rayHitDistance(origin: Vec3, dir: Vec3, point: Vec3, radius: number): number {
  const px = point.x - origin.x;
  const py = point.y - origin.y;
  const pz = point.z - origin.z;
  const along = px * dir.x + py * dir.y + pz * dir.z;
  if (along <= 0) return Infinity;
  const perpSq = px * px + py * py + pz * pz - along * along;
  return perpSq <= radius * radius ? along : Infinity;
}
