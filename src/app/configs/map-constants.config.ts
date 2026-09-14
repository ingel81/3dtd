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

/**
 * Gap between the padded framing box and the image edge, per side, as a
 * fraction of the image width or height. Applies in the binding direction;
 * the other one keeps more room (see fitGroundBox).
 */
export const CAMERA_EDGE_MARGIN = 0.03;

/** Ordered spawn-point colors (hex, up to 4 spawns) */
export const SPAWN_COLORS: readonly number[] = [0xef4444, 0xf97316, 0x00bcd4, 0xff00ff] as const;

/** Min distance (meters) from HQ for manual spawn placement */
export const MIN_MANUAL_SPAWN_DISTANCE = 200;

/** Max distance (meters) from HQ for manual spawn placement */
export const MAX_MANUAL_SPAWN_DISTANCE = 1500;

/** Max distance from a street for HQ placement inside the loaded streets (meters) */
export const MAX_HQ_STREET_DISTANCE = 150;

/**
 * Max distance from a street of the loaded network for manual spawn
 * placement (meters). The route starts on the street nearest to the click,
 * so the portal lands on the street the player points at: road, sidewalk and
 * the offset between OSM centre line and tiles fit, a courtyard or a block
 * interior does not. The hero's move ring allows the same 30 m.
 */
export const MAX_SPAWN_STREET_DISTANCE = 30;

/** Max distance (meters) from new HQ before old spawn is discarded during HQ relocation */
export const SPAWN_DISCARD_DISTANCE = 1500;
