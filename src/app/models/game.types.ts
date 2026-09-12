/**
 * Geographic position with optional height
 */
export interface GeoPosition {
  lat: number;
  lon: number;
  height?: number;
}

/**
 * Waypoint of an enemy route, with what the route knows about the segment
 * that starts here (from this waypoint to the next).
 */
export interface RouteWaypoint extends GeoPosition {
  /**
   * Half width of the route corridor on that segment left and right of the
   * direction of travel, metres. Bounds the route cells and how far enemies
   * spread to that side. Unset: the default width, see
   * `utils/route-corridor.ts`.
   */
  corridorLeft?: number;
  corridorRight?: number;
  /**
   * The segment runs over a bridge (OSM `bridge=*`): its route cells stand
   * on the deck, not on the ground below.
   */
  onBridge?: boolean;
  /**
   * The segment runs through a tunnel or a covered passage (OSM `tunnel=*`
   * other than `no`, or `covered=yes`): its cells take their height between
   * the portals, since a column there only sees the ground or roof above,
   * and its width is not measured.
   */
  inTunnel?: boolean;
}

/**
 * Game phase type - single source of truth for all game phase references
 */
export type GamePhase = 'setup' | 'wave' | 'gameover';
