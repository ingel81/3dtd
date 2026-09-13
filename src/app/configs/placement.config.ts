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
 * How high a tower stands on uneven ground (resolveTowerFootprint). The rules
 * above decide whether a tower may stand somewhere; these only decide its
 * height there and whether a stone plinth goes under it.
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
   * the tower but something beside it: a facade, a tree crown, an eave. It
   * does not lift the tower, which then clips into it as before. 5 m covers a
   * 45° roof across the widest footprint (5.3 m, Fire) from eave to ridge.
   */
  MAX_RISE: 5,

  /**
   * A surface this far (m) below the one under the cursor is the drop past an
   * edge (a high roof, a hole in the mesh), not the foot of a plinth.
   */
  MAX_DROP: 30,
} as const;
