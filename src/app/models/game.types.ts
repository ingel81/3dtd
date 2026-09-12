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
   * Half width of the route corridor on that segment, metres. Bounds the
   * route cells and how far enemies spread. Unset: the default width, see
   * `utils/route-corridor.ts`.
   */
  corridorHalfWidth?: number;
  /**
   * The segment runs over a bridge (OSM `bridge=*`): its route cells stand
   * on the deck, not on the ground below.
   */
  onBridge?: boolean;
}

/**
 * Game phase type - single source of truth for all game phase references
 */
export type GamePhase = 'setup' | 'wave' | 'gameover';
