import {
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_WIDTH,
} from '../../../configs/marker-geometry.config';
import type { RouteWaypoint } from '../../../models/game.types';
import { corridorConfig } from '../../../utils/route-corridor';

/** Where a spawn portal stands, in scene space. */
export interface SpawnPortalPose {
  /** Centre of the portal plane at ground level (m). */
  x: number;
  y: number;
  z: number;
  /** Rotation about +Y that turns the portal's +z onto the way the enemies walk (rad). */
  heading: number;
  /** Size relative to the frame at scale 1, see PORTAL_OPENING_WIDTH. */
  scale: number;
}

/** The heading points at the first route point at least this far from the start (m). */
export const PORTAL_HEADING_RUN = 4;

/** Portal scale for a corridor `width` metres wide at the route start. */
export function portalScaleForWidth(width: number): number {
  return Math.min(PORTAL_MAX_SCALE, Math.max(PORTAL_MIN_SCALE, width / PORTAL_OPENING_WIDTH));
}

/**
 * Width of the route corridor a portal on the route start `start` spans:
 * twice its wider side, as the portal stands centred on the route. Read by
 * the portal's pose and by the air units coming out of it.
 */
export function portalCorridorWidth(start: RouteWaypoint): number {
  return 2 * Math.max(
    start.corridorLeft ?? corridorConfig.defaultHalfWidth,
    start.corridorRight ?? corridorConfig.defaultHalfWidth,
  );
}

/**
 * Pose of a spawn portal from the start of its route: centred on the first
 * waypoint, on the ground, where the enemies appear. They start inside the
 * portal's volume (PORTAL_DEPTH) and step out through its front surface.
 * It faces along the route, the opening as wide as the corridor there.
 *
 * The heading points at the first waypoint PORTAL_HEADING_RUN or more from
 * the start: a route can open with a stub of a metre before its first
 * bend, and the portal should face where the street goes.
 *
 * @param points Route waypoints in scene space, from the start on
 * @param groundY Ground height at the route start (scene Y)
 * @param corridorWidth Width of the route corridor at the start (m)
 * @returns null if no waypoint leaves the start
 */
export function spawnPortalPose(
  points: readonly { x: number; z: number }[],
  groundY: number,
  corridorWidth: number,
): SpawnPortalPose | null {
  if (points.length < 2) return null;
  const start = points[0];
  let dx = 0;
  let dz = 0;
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    dx = points[i].x - start.x;
    dz = points[i].z - start.z;
    length = Math.hypot(dx, dz);
    if (length >= PORTAL_HEADING_RUN) break;
  }
  if (length < 1e-3) return null;

  const fx = dx / length;
  const fz = dz / length;
  return {
    x: start.x,
    y: groundY,
    z: start.z,
    heading: Math.atan2(fx, fz),
    scale: portalScaleForWidth(corridorWidth),
  };
}

/**
 * Pose of a portal whose route is not built yet: on the spawn point,
 * facing the point (towardX, towardZ), the HQ.
 */
export function provisionalPortalPose(
  x: number,
  y: number,
  z: number,
  towardX: number,
  towardZ: number,
): SpawnPortalPose {
  const dx = towardX - x;
  const dz = towardZ - z;
  const heading = dx === 0 && dz === 0 ? 0 : Math.atan2(dx, dz);
  return { x, y, z, heading, scale: 1 };
}
