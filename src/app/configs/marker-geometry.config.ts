/**
 * Geometry of the HQ and spawn diamond markers (MarkerVisualizationService,
 * MarkerInstanceManager, MarkerLabelManager). The intro flight treats the
 * markers as obstacles and shot subjects, the overview frame keeps them in the
 * picture; both read the extents from here.
 */

/** Height of the diamond centre above the ground (m). */
export const MARKER_FLOAT_HEIGHT = 30;

/** Octahedron radius of the opaque core at scale 1 (m), stretched in Y by MARKER_Y_STRETCH. */
export const MARKER_CORE_RADIUS = 8;
export const MARKER_Y_STRETCH = 1.8;

/**
 * Horizontal extent of a marker at scale 1 (m): the outer ring of the
 * placement preview. The instanced marker's ring is smaller (14 m plus tube).
 */
export const MARKER_RING_RADIUS = 16;

export const HQ_MARKER_SCALE = 1.2;
export const SPAWN_MARKER_SCALE = 0.8;

/** Name label: centre above the diamond centre and quad height (m); the width follows the text. */
export const MARKER_LABEL_OFFSET = 20;
export const MARKER_LABEL_SIZE = 5;

/** Upper edge of the label above the diamond centre (m). */
export const MARKER_LABEL_TOP = MARKER_LABEL_OFFSET + MARKER_LABEL_SIZE / 2;
