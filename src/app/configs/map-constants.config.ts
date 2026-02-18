/**
 * Map, camera, and spawn-related constants.
 *
 * Centralizes magic numbers for spawn distances, street filtering,
 * camera defaults, and spawn-point colors.
 */

/** Minimum distance (meters) from HQ for random spawn generation */
export const MIN_SPAWN_DISTANCE = 500;

/** Maximum distance (meters) from HQ for random spawn generation */
export const MAX_SPAWN_DISTANCE = 1000;

/** Radius (meters) for filtering street segments near calculated routes */
export const STREET_FILTER_RADIUS = 100;

/** Default camera framing padding (fraction of viewport) */
export const CAMERA_PADDING = 0.1;

/** Default camera tilt angle (degrees from vertical) */
export const CAMERA_ANGLE = 70;

/** Default marker radius for camera framing (world units) */
export const CAMERA_MARKER_RADIUS = 8;

/** Ordered spawn-point colors (hex, up to 4 spawns) */
export const SPAWN_COLORS: readonly number[] = [0xef4444, 0xf97316, 0x00bcd4, 0xff00ff] as const;

/** Min distance (meters) from HQ for manual spawn placement */
export const MIN_MANUAL_SPAWN_DISTANCE = 200;

/** Max distance (meters) from HQ for manual spawn placement */
export const MAX_MANUAL_SPAWN_DISTANCE = 1500;

/** Max distance from a street for HQ/spawn placement (meters) */
export const MAX_PLACEMENT_STREET_DISTANCE = 150;
