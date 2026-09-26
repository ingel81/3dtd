/** A point on the DevWorld ground plane, local metres. */
export interface Vec2 {
  x: number;
  z: number;
}

/** The point `t` of the way from `a` to `b`. */
export function lerpVec2(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Straight-line distance from `a` to `b`, m. */
export function distanceVec2(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}
