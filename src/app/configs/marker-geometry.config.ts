/**
 * Geometry of the HQ diamond marker and the spawn portals
 * (MarkerVisualizationService, MarkerInstanceManager, SpawnPortalManager,
 * MarkerLabelManager). The intro flight treats both as obstacles and shot
 * subjects, the overview frame keeps them in the picture; both read the
 * extents from here.
 */

// ── HQ diamond ──

/** Height of the HQ diamond centre above the ground (m). */
export const MARKER_FLOAT_HEIGHT = 30;

/** Octahedron radius of the opaque core at scale 1 (m), stretched in Y by MARKER_Y_STRETCH. */
export const MARKER_CORE_RADIUS = 8;
export const MARKER_Y_STRETCH = 1.8;

/**
 * Horizontal extent of the diamond at scale 1 (m): the outer ring of the
 * placement preview. The instanced marker's ring is smaller (14 m plus tube).
 */
export const MARKER_RING_RADIUS = 16;

export const HQ_MARKER_SCALE = 1.2;

/** Name label: centre above the diamond centre and quad height (m); the width follows the text. */
export const MARKER_LABEL_OFFSET = 20;
export const MARKER_LABEL_SIZE = 5;

/** Upper edge of the HQ label above the diamond centre (m). */
export const MARKER_LABEL_TOP = MARKER_LABEL_OFFSET + MARKER_LABEL_SIZE / 2;

// ── Spawn portal ──
// Portal space: x across the street, y up from the ground at the route
// start, z along the first route segment (the way the enemies walk out).

/** Opening between the pillars at scale 1 (m), and its height up to the lintel. */
export const PORTAL_OPENING_WIDTH = 8;
export const PORTAL_OPENING_HEIGHT = 10;

/** Tip of the crown above the ground at scale 1 (m): the top of the frame. */
export const PORTAL_FRAME_TOP = 15.5;

/**
 * Horizontal radius around the portal centre that holds the whole frame at
 * scale 1 (m), whichever way the portal faces: the plinths' outer corners.
 */
export const PORTAL_RADIUS = 7.5;

/**
 * Scale range. A portal's opening spans the corridor at the route start
 * (scale = corridor width / PORTAL_OPENING_WIDTH) within these bounds; the
 * whole frame scales with it, so an avenue gets a taller gate than an alley.
 */
export const PORTAL_MIN_SCALE = 0.75;
export const PORTAL_MAX_SCALE = 1.75;

/**
 * Portal plane ahead of the route start (m): the enemies appear behind the
 * surface and step out through it.
 */
export const PORTAL_SETBACK = 2;

/** Gap between the frame top and the spawn label's centre (m). */
export const PORTAL_LABEL_GAP = 4;

/** Height of a spawn label's centre above the ground, for a portal of `scale`. */
export function portalLabelHeight(scale: number): number {
  return PORTAL_FRAME_TOP * scale + PORTAL_LABEL_GAP;
}

/**
 * Extents of the largest portal, for callers that do not know a spawn's
 * corridor (intro flight, overview frame): horizontal radius around the
 * portal centre, frame top and label top above the ground (m).
 */
export const PORTAL_MAX_RADIUS = PORTAL_RADIUS * PORTAL_MAX_SCALE;
export const PORTAL_MAX_TOP = PORTAL_FRAME_TOP * PORTAL_MAX_SCALE;
export const PORTAL_LABEL_TOP = portalLabelHeight(PORTAL_MAX_SCALE) + MARKER_LABEL_SIZE / 2;
