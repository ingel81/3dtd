import type { RouteBody, RouteBodyContact } from './route-body';

/**
 * A cone from its apex along a unit axis, local coordinates: the fire
 * tower's flame (TowerCombatService.getEnemiesInCone).
 */
export interface Cone {
  x: number;
  y: number;
  z: number;
  /** Unit vector along the axis */
  dirX: number;
  dirY: number;
  dirZ: number;
  /** Metres from the apex */
  length: number;
  /** Cosine of the half opening angle */
  cosHalfAngle: number;
}

/** Slack on the length for the size of what the cone hits, m */
export const CONE_LENGTH_MARGIN_M = 2;

/** Whether local (x, y, z) lies in `cone`, up to its length plus CONE_LENGTH_MARGIN_M. */
export function coneContains(cone: Cone, x: number, y: number, z: number): boolean {
  const vx = x - cone.x;
  const vy = y - cone.y;
  const vz = z - cone.z;
  const dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (dist > cone.length + CONE_LENGTH_MARGIN_M) return false;
  // The apex itself has no direction and counts as outside
  const dot = dist > 0 ? (vx * cone.dirX + vy * cone.dirY + vz * cone.dirZ) / dist : 0;
  return dot >= cone.cosHalfAngle;
}

/** Where along the axis bodyPointInCone looks for the body, as shares of the length */
const AXIS_SAMPLES = [1, 0.5];

/**
 * A point of `body` in `cone` when its axis points past the body, at
 * another target: the body points nearest the cone's end and its middle,
 * each `aimHeight` above its ground (`groundAt`, `fallbackGroundY` where
 * that has none). The first one inside goes into `out`; returns its ground
 * (local y), null when neither is inside. At most two RouteBody.nearest
 * walks, O(stations of the body) each.
 */
export function bodyPointInCone(
  body: RouteBody,
  cone: Cone,
  groundAt: (x: number, z: number) => number | null,
  fallbackGroundY: number,
  aimHeight: number,
  out: RouteBodyContact,
): number | null {
  const st = body.stations;
  for (const share of AXIS_SAMPLES) {
    const along = cone.length * share;
    body.nearest(cone.x + cone.dirX * along, cone.z + cone.dirZ * along, out);
    const k = out.station;
    const x = st.x[k] + st.rightX[k] * out.offset;
    const z = st.z[k] + st.rightZ[k] * out.offset;
    const groundY = groundAt(x, z) ?? fallbackGroundY;
    if (coneContains(cone, x, groundY + aimHeight, z)) return groundY;
  }
  return null;
}
