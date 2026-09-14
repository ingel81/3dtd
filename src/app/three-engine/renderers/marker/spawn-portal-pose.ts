import {
  PORTAL_DEPTH,
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_WIDTH,
  portalDepthScale,
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

/** Distance from a portal's centre to its front surface, for a portal of `scale` (m). */
export function portalFrontDistance(scale: number): number {
  return (PORTAL_DEPTH / 2) * portalDepthScale(scale);
}

/**
 * Where the polyline `points` first gets `radius` from its start, on the
 * segment that crosses that circle. A route shorter than that gives its
 * farthest point from the start.
 *
 * @returns null if every point lies on the start
 */
export function routeExitPoint(
  points: readonly { x: number; z: number }[],
  radius: number,
): { x: number; z: number } | null {
  const start = points[0];
  let farthest: { x: number; z: number } | null = null;
  let farthestSq = 1e-6;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const bx = b.x - start.x;
    const bz = b.z - start.z;
    const bSq = bx * bx + bz * bz;
    if (bSq >= radius * radius) {
      // a lies inside the circle, b on or outside it: the one root of
      // |a + t (b - a) - start| = radius in [0, 1]
      const ax = a.x - start.x;
      const az = a.z - start.z;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const qa = dx * dx + dz * dz;
      const qb = 2 * (ax * dx + az * dz);
      const qc = ax * ax + az * az - radius * radius;
      const t = (-qb + Math.sqrt(qb * qb - 4 * qa * qc)) / (2 * qa);
      return { x: a.x + dx * t, z: a.z + dz * t };
    }
    if (bSq > farthestSq) {
      farthest = b;
      farthestSq = bSq;
    }
  }
  return farthest;
}

/**
 * Pose of a spawn portal from the start of its route: centred on the first
 * waypoint, on the ground, where the enemies appear. They start inside the
 * portal's volume (PORTAL_DEPTH) and step out through its front surface.
 * The opening is as wide as the corridor there.
 *
 * It faces where the route leaves its volume: the point where the route
 * first gets as far from the start as the front surface
 * (portalFrontDistance), so the route runs out through the middle of the
 * opening. A route that opens on a bend (on a roundabout, a stub of a metre
 * before a corner) runs sideways inside the portal; facing along its first
 * segment, or at a waypoint beyond the bend, put the enemies through a
 * pillar.
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
  const scale = portalScaleForWidth(corridorWidth);
  const exit = routeExitPoint(points, portalFrontDistance(scale));
  if (!exit) return null;

  const start = points[0];
  return {
    x: start.x,
    y: groundY,
    z: start.z,
    heading: Math.atan2(exit.x - start.x, exit.z - start.z),
    scale,
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
