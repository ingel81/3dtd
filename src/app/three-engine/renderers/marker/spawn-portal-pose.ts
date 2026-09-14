import {
  PORTAL_DEPTH,
  PORTAL_MAX_SCALE,
  PORTAL_MIN_SCALE,
  PORTAL_OPENING_WIDTH,
  PORTAL_TURN_CLEARANCE,
  portalDepthScale,
} from '../../../configs/marker-geometry.config';
import type { RouteWaypoint } from '../../../models/game.types';
import { corridorConfig, lateralLimit } from '../../../utils/route-corridor';

/** Waypoints from the route start read for a portal's heading and its turn range. */
export const PORTAL_POSE_WAYPOINTS = 16;

/** Turn range search: step and the farthest turn either way from the route's heading (rad). */
const TURN_STEP = Math.PI / 360;
const TURN_MAX = Math.PI / 2;
/** Halvings that settle a limit of the turn range between two steps */
const TURN_REFINE = 12;

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
 * How far off the route the outermost enemies walk at the route start
 * `start`, on either side (m): the lateral limit of the wider side, which
 * also sets the opening (portalCorridorWidth).
 */
export function portalLaneOffset(start: RouteWaypoint): number {
  return lateralLimit(portalCorridorWidth(start) / 2);
}

/**
 * Whether the enemies leave a portal turned to `heading` through its
 * opening: the route and the lanes `lane` metres either side of it
 * (portalLaneOffset) each stay between the pillars, less
 * PORTAL_TURN_CLEARANCE, and in front of the back surface until they cross
 * the front surface. A lane is every segment shifted square to itself, as
 * MovementComponent shifts an enemy. A route that never gets as far as the
 * front surface only has to stay inside.
 *
 * @param points Route waypoints in scene space, from the start on
 * @param pose Where the portal stands and its scale; its heading is not read
 */
export function routeLeavesThroughOpening(
  points: readonly { x: number; z: number }[],
  pose: { x: number; z: number; scale: number },
  heading: number,
  lane: number,
): boolean {
  const halfOpening = (PORTAL_OPENING_WIDTH / 2) * pose.scale - PORTAL_TURN_CLEARANCE;
  const front = portalFrontDistance(pose.scale);
  // Portal space: `ahead` along the facing, `across` to its side
  const fx = Math.sin(heading);
  const fz = Math.cos(heading);
  const ahead = (x: number, z: number) => (x - pose.x) * fx + (z - pose.z) * fz;
  const across = (x: number, z: number) => (x - pose.x) * fz - (z - pose.z) * fx;

  const laneLeaves = (offset: number): boolean => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length === 0) continue;
      const ox = ((b.z - a.z) / length) * offset;
      const oz = (-(b.x - a.x) / length) * offset;
      const aAhead = ahead(a.x + ox, a.z + oz);
      const aAcross = across(a.x + ox, a.z + oz);
      const bAhead = ahead(b.x + ox, b.z + oz);
      const bAcross = across(b.x + ox, b.z + oz);
      if (Math.abs(aAcross) > halfOpening || aAhead < -front) return false;
      if (bAhead >= front) {
        const t = aAhead >= front ? 0 : (front - aAhead) / (bAhead - aAhead);
        return Math.abs(aAcross + (bAcross - aAcross) * t) <= halfOpening;
      }
      if (Math.abs(bAcross) > halfOpening || bAhead < -front) return false;
    }
    return true;
  };

  return laneLeaves(0) && (lane <= 0 || (laneLeaves(-lane) && laneLeaves(lane)));
}

/**
 * How far the player may turn a portal standing on `pose` from its route's
 * heading and still have the enemies leave through the opening
 * (routeLeavesThroughOpening): the offsets from `pose.heading` either way
 * (rad), min <= 0 <= max. Both 0 where even the route's heading does not
 * let the outermost lanes through, as on a corridor wider than the widest
 * opening. Searched from the route's heading outwards, so the range is the
 * one around it.
 */
export function portalTurnRange(
  points: readonly { x: number; z: number }[],
  pose: SpawnPortalPose,
  lane: number,
): { min: number; max: number } {
  const leaves = (offset: number) => routeLeavesThroughOpening(points, pose, pose.heading + offset, lane);
  if (!leaves(0)) return { min: 0, max: 0 };

  const limit = (sign: 1 | -1): number => {
    let inside = 0;
    for (let turn = TURN_STEP; turn <= TURN_MAX + 1e-9; turn += TURN_STEP) {
      if (!leaves(sign * turn)) {
        let outside = turn;
        for (let i = 0; i < TURN_REFINE; i++) {
          const mid = (inside + outside) / 2;
          if (leaves(sign * mid)) inside = mid;
          else outside = mid;
        }
        return inside;
      }
      inside = turn;
    }
    return inside;
  };

  // `|| 0`: no turn to the left is 0, not -0
  return { min: -limit(-1) || 0, max: limit(1) };
}

/**
 * The heading closest to `heading` in the portal's turn range
 * (portalTurnRange): a turn through a pillar or the back surface stops
 * where the outermost enemies still get out.
 */
export function clampPortalHeading(
  points: readonly { x: number; z: number }[],
  pose: SpawnPortalPose,
  heading: number,
  lane: number,
): number {
  const range = portalTurnRange(points, pose, lane);
  const offset = Math.atan2(Math.sin(heading - pose.heading), Math.cos(heading - pose.heading));
  return pose.heading + Math.min(range.max, Math.max(range.min, offset));
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
