import {
  AIR_PORTAL_EXIT,
  PORTAL_DEPTH,
  PORTAL_OPENING_HEIGHT,
  portalDepthScale,
} from '../configs/marker-geometry.config';

/**
 * An air unit's way out of its spawn portal (EnemyManager): from path[0],
 * behind the portal's plane, level through the opening and on past the
 * plane, then up to its cruise altitude. Heights are
 * Enemy.heightOffset values (m above `transform.terrainHeight`), distances
 * metres along the route from path[0].
 */
export interface AirPortalExit {
  /** Height offset in the opening and on the level stretch after it. */
  from: number;
  /** Cruise height offset: the type's heightOffset. */
  to: number;
  /** Route distance where the climb starts, and where it reaches `to`. */
  climbStart: number;
  climbEnd: number;
}

/**
 * The way out of a portal of `scale` for a body that reaches from
 * `bodyMinY` to `bodyMaxY` above its model origin (m, at the enemy's scale).
 *
 * In the opening the body's middle is on the opening's middle,
 * PORTAL_OPENING_HEIGHT * scale / 2 above the ground, so a body no taller
 * than the opening fits it. A taller one stands on the ground instead of
 * reaching below it, and sticks out at the lintel.
 *
 * `heightVariation` is the enemy's altitude spread, which EnemyManager
 * keeps in its terrainHeight. It is taken out here: every unit of a type
 * comes through the same height and spreads out on the climb.
 *
 * The plane stands PORTAL_DEPTH / 2 (times the depth scale) ahead of
 * path[0]; the climb starts AIR_PORTAL_EXIT.holdPastFront beyond it.
 */
export function airPortalExit(
  scale: number,
  bodyMinY: number,
  bodyMaxY: number,
  heightVariation: number,
  cruiseOffset: number,
): AirPortalExit {
  const opening = PORTAL_OPENING_HEIGHT * scale;
  const altitude = Math.max(opening / 2 - (bodyMinY + bodyMaxY) / 2, -bodyMinY);
  const climbStart = (PORTAL_DEPTH / 2) * portalDepthScale(scale) + AIR_PORTAL_EXIT.holdPastFront;
  return {
    from: altitude - heightVariation,
    to: cruiseOffset,
    climbStart,
    climbEnd: climbStart + AIR_PORTAL_EXIT.climbDistance,
  };
}

/**
 * Height offset `distance` metres along the route: `from` up to the climb,
 * then eased (smoothstep, so neither the height nor the climb rate jumps at
 * either end) to exactly `to` at climbEnd and beyond. A function of the
 * distance flown only, so it comes out the same at every frame rate and
 * timescale.
 */
export function airPortalExitOffset(exit: AirPortalExit, distance: number): number {
  if (distance <= exit.climbStart) return exit.from;
  if (distance >= exit.climbEnd) return exit.to;
  const t = (distance - exit.climbStart) / (exit.climbEnd - exit.climbStart);
  return exit.from + (exit.to - exit.from) * t * t * (3 - 2 * t);
}
