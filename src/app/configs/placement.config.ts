/**
 * Tower Placement Configuration
 *
 * Centralized placement constraints to avoid duplication.
 * Previously duplicated in:
 * - tower.manager.ts
 * - tower-placement.service.ts
 */

export const PLACEMENT_CONFIG = {
  /** Minimum distance from active enemy route in meters */
  MIN_DISTANCE_TO_ROUTE: 10,

  /** Minimum distance from base/HQ in meters */
  MIN_DISTANCE_TO_BASE: 30,

  /** Minimum distance from spawn points in meters */
  MIN_DISTANCE_TO_SPAWN: 60,

  /** Minimum distance between towers in meters */
  MIN_DISTANCE_TO_OTHER_TOWER: 8,
} as const;

/**
 * How high a tower stands on uneven ground (resolveTowerFootprint): its
 * height, the stone plinth under it and the braces where it overhangs. The
 * rules above decide whether a tower may stand somewhere; of these, MAX_RISE
 * and MAX_DROP also rule out a spot whose centre or inner ring stands in a
 * wall or over a drop (FootprintRefusal).
 */
export const PLINTH_CONFIG = {
  /**
   * Height difference (m) under the footprint from which the tower stands on
   * its highest point with a plinth below. Less than that and it stays on the
   * surface under the cursor, as before the plinth existed. 0.2 m keeps
   * photogrammetry noise on paved ground (a few cm) and kerbs (10-15 cm)
   * below it; the tower models sit up to 0.36 m deep in the ground anyway
   * (median 0.1 m, min Y + heightOffset), which hides a step of that size.
   */
  MIN_UNEVENNESS: 0.2,

  /**
   * A surface this far (m) above the one under the cursor is not ground under
   * the tower but something beside it: a facade, a tall crown. It does not
   * lift the tower. Under the outer ring the tower clips into it as before,
   * under the centre or the inner ring the spot is refused. 5 m covers a 45°
   * roof across the widest footprint (5.3 m, Fire) from eave to ridge.
   */
  MAX_RISE: 5,

  /**
   * A surface this far (m) below the one under the cursor is past an edge
   * (a roof edge, a step down to a lower part of the building, a terrace
   * wall), not the foot of a plinth, unless the ground slopes down to it
   * (MAX_SLOPE). The plinth ends above it and hangs over the drop, on braces;
   * under the centre or the inner ring the spot is refused.
   * About a storey: a balcony or a canopy up to that far below the roof
   * still carries the plinth, a lower roof deeper down no longer draws it
   * down the facade.
   */
  MAX_DROP: 3,

  /**
   * Steepest fall (m per m, 56°) between neighbouring probes that still
   * counts as ground sloping down, not as an edge: a hillside, a pitched
   * roof. Down such a slope the plinth reaches further than MAX_DROP. A
   * facade falls steeper between neighbouring probes, up to 2.5 m apart on
   * most towers (3.3 m on Fire), also where the photogrammetry melts its top
   * into a bevel. Between those of the Research Center, up to 6.25 m apart,
   * a step of up to 9 m still passes as slope.
   */
  MAX_SLOPE: 1.5,

  /**
   * Least height (m) of a plinth that hangs over a drop, so its braces have
   * a plinth to sit under: on a flat roof at its edge the plinth is a slab
   * this high with the braces below.
   */
  MIN_BRACED_HEIGHT: 0.5,

  /**
   * The cursor surface this far (m) above the ground is on a roof, a deck or
   * a bridge. There every probe up to MAX_RISE may lift the tower: a ridge,
   * the higher part of a stepped roof, also a dormer. Below it the cursor is
   * on the ground and MAX_STEP applies. The ground is that of the cursor's
   * own column, or, where the photogrammetry has none under a roof, the
   * ground on two opposite sides of the footprint (ROOF_PROBE_REACH).
   * 2.5 m, the value of the route grid's roof check (`roofRise`): a car is
   * lower, a storey higher.
   */
  ROOF_ABOVE_GROUND: 2.5,

  /**
   * How far (m) beyond the footprint the ground around it is probed, in
   * eight directions, when only the roof rule would lift the tower and the
   * cursor's column shows no ground below it. From anywhere on its roof the
   * probes leave a building up to radius + 8 m deep on both sides (11.6 m
   * for a 3.6 m footprint), from the middle of the roof one up to twice
   * that. A slope falls on one side only and does not count as a roof.
   */
  ROOF_PROBE_REACH: 8,

  /**
   * On the ground: how much higher (m) a probe may lie than the neighbouring
   * probe it is reached from, beyond what the slope under the cursor gives
   * along that step. Covers a kerb, a low step, a gentle bank. A parked car
   * (bonnet about 0.9 m, roof 1.5 m), a hedge, a wall or a crown rise more and
   * do not lift the tower. Neighbouring probes are up to 2.5 m apart on most
   * towers, 3.3 m on Fire and 6.25 m on the Research Center.
   */
  MAX_STEP: 0.5,
} as const;
