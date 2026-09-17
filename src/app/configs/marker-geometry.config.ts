/**
 * Geometry of the HQ diamond marker and the spawn portals
 * (MarkerVisualizationService, MarkerInstanceManager, SpawnPortalManager,
 * MarkerLabelManager), and how air units leave a portal (EnemyManager).
 * The intro flight treats both as obstacles and shot
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
// start, z the way the enemies walk out (spawnPortalPose).

/** Opening between the pillars at scale 1 (m), and its height up to the lintel. */
export const PORTAL_OPENING_WIDTH = 8;
export const PORTAL_OPENING_HEIGHT = 11;

/** Tip of the crown above the ground at scale 1 (m): the top of the frame. */
export const PORTAL_FRAME_TOP = 19.5;

/**
 * Horizontal radius around the portal centre that holds the whole frame at
 * scale 1 (m), whichever way the portal faces: the plinths' outer corners.
 */
export const PORTAL_RADIUS = 10;

/**
 * Scale range. A portal's opening spans the corridor at the route start
 * (scale = corridor width / PORTAL_OPENING_WIDTH) within these bounds; the
 * whole frame scales with it, so an avenue gets a taller gate than an alley.
 */
export const PORTAL_MIN_SCALE = 0.75;
export const PORTAL_MAX_SCALE = 1.75;

/** Spawn portals drawn at most (SpawnPortalManager), and so the clip boxes the enemies' shaders hold. */
export const MAX_SPAWN_PORTALS = 8;

/**
 * Depth of the portal's clip space at scale 1 (m), see PORTAL_CLIP. The
 * portal's centre stands on the route start, where the enemies appear, in
 * the middle of that depth; the portal's plane, the void surface in the
 * arch's opening, stands PORTAL_DEPTH / 2 ahead of it. An enemy starts
 * behind the plane, hidden, and steps out through it. Deep enough for the
 * longest ground enemy (the mech, 9.3 m; the measured sizes are in
 * spawn-portal-frame.spec.ts).
 */
export const PORTAL_DEPTH = 10.5;

/**
 * The space behind a spawn portal's plane where the enemies' shaders drop
 * their fragments (three-engine/renderers/portal-clip.ts): a box
 * PORTAL_DEPTH deep behind the plane (times portalDepthScale), `side`
 * wider than the opening on either side, from `below` under the ground at
 * the route start up to `top`. What of an enemy lies in it does not show:
 * at the start the whole enemy with its health bar; walking out, its body
 * appears where it comes through the plane, with a glowing seam
 * (SPAWN_PORTAL_LOOK.seam). Outside the box nothing changes. Visual only:
 * targeting and damage do not know it, towers stand clear of the portal
 * anyway. spawn-portal-frame.spec.ts holds the measured bodies of the
 * ground enemies to it.
 */
export const PORTAL_CLIP = {
  /**
   * Room beside the opening on either side (m, not scaled): the widest
   * ground body, the stone golem (12.6 m), on the outermost lane its type
   * walks (lateralSpread) in the corridor of the smallest portal, with
   * over 0.2 m to spare
   */
  side: 4.5,
  /**
   * Top above the ground at scale 1 (m), times portalDepthScale: above the
   * golem's health bar (15.5 m) and the dragon's coming out of the largest
   * portal (17.7 m)
   */
  top: 20,
  /** Bottom below the ground at the route start (m), where the ground behind the plane falls away */
  below: 3,
} as const;

/**
 * Room left when the player turns a spawn portal with R (m). The outermost
 * enemies walk as far off the route as the corridor at the start lets them
 * (portalLaneOffset); turned, their lanes still cross the portal's plane at
 * least this far inside the pillars. At the route's own heading the room is
 * the corridor's edge margin (1.5 m); half a metre keeps a narrow body's
 * centre clear of the stone and leaves 6 to 10.5 degrees to turn either way
 * on a straight street with a corridor up to 14 m wide, none on a wider one.
 */
export const PORTAL_TURN_CLEARANCE = 0.5;

/**
 * Scale of the portal's depth for a portal of `scale`: the opening follows
 * the corridor, the clip space keeps at least its depth at scale 1, as an
 * enemy is as long in an alley as on an avenue. The arch and the plane's
 * distance from the centre take it too.
 */
export function portalDepthScale(scale: number): number {
  return Math.max(1, scale);
}

/**
 * How an air unit of a wave comes out of its spawn portal
 * (utils/air-portal-exit.ts, EnemyManager): from path[0] behind the plane,
 * its body centred in the opening (PORTAL_OPENING_HEIGHT * scale / 2 above
 * the ground), level through the plane and on, then up to its
 * cruise altitude. Both are distances along the route, so the climb is the
 * same at every frame rate and timescale. Debug spawns and split children
 * start at their altitude.
 */
export const AIR_PORTAL_EXIT = {
  /**
   * Level flight past the portal's plane (m). The dragon, the longest air
   * body, reaches 7.8 m behind its origin: at 8 m its tail is out of the
   * gate before the climb lifts it. 0.9 to 1.3 s at the air units' 6 to
   * 9 m/s.
   */
  holdPastFront: 8,
  /**
   * Route distance of the climb to cruise altitude (m), eased at both ends
   * (smoothstep, steepest at 1.5 times the mean slope). The rise is 2 to
   * 25 m by type, portal and altitude spread: at most about 35° for the
   * bat, 40° for the hornet, 50° for a dragon at the top of its spread.
   * 3.3 to 5 s at their speeds.
   */
  climbDistance: 30,
} as const;

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
