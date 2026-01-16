/**
 * Tower Placement Configuration
 *
 * Centralized placement constraints to avoid duplication.
 * Previously duplicated in:
 * - tower.manager.ts
 * - tower-placement.service.ts
 */

export const PLACEMENT_CONFIG = {
  /** Minimum distance from street in meters */
  MIN_DISTANCE_TO_STREET: 10,

  /** Maximum distance from street in meters */
  MAX_DISTANCE_TO_STREET: 50,

  /** Minimum distance from base/HQ in meters */
  MIN_DISTANCE_TO_BASE: 30,

  /** Minimum distance from spawn points in meters */
  MIN_DISTANCE_TO_SPAWN: 30,

  /** Minimum distance between towers in meters */
  MIN_DISTANCE_TO_OTHER_TOWER: 8,
} as const;

/** Type for accessing placement config values */
export type PlacementConfig = typeof PLACEMENT_CONFIG;
