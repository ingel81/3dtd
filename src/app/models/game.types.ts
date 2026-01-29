/**
 * Geographic position with optional height
 */
export interface GeoPosition {
  lat: number;
  lon: number;
  height?: number;
}

/**
 * Game phase type - single source of truth for all game phase references
 */
export type GamePhase = 'setup' | 'wave' | 'gameover';
