import { NominatimAddress } from '../services/geocoding.service';
import { GeoPosition } from './game.types';

/**
 * Location System Types for Tower Defense
 *
 * Note: All coordinate types use GeoPosition (lat/lon/height?) as base
 */

/**
 * Location config with optional name (for debug/editable locations)
 */
export interface LocationConfig extends GeoPosition {
  name?: string; // Full displayName from OSM
  address?: NominatimAddress; // Structured address for smart display
}

/**
 * Full location info with display name
 */
export interface LocationInfo extends GeoPosition {
  name: string; // Display name (city/place)
  displayName: string; // Full Nominatim display name
  address?: NominatimAddress; // Structured address for smart display
}

/**
 * Spawn point configuration
 */
export interface SpawnLocationConfig extends GeoPosition {
  id: string;
  name?: string;
  isRandom?: boolean;
}

/**
 * Data passed to location dialog
 */
export interface LocationDialogData {
  currentLocation: LocationInfo | null;
  currentSpawn: SpawnLocationConfig | null;
  isGameInProgress: boolean;
}

/**
 * Result from location dialog
 */
export interface LocationDialogResult {
  hq: LocationInfo;
  spawn: SpawnLocationConfig;
  confirmed: boolean;
}

/**
 * Random spawn candidate from street network
 */
export interface RandomSpawnCandidate extends GeoPosition {
  distance: number;
  streetName?: string;
  nodeId?: number;
}

/**
 * Favorite location for quick access
 * Only stores coordinates - names are resolved via geocoding cache
 */
export interface FavoriteLocation {
  id: string;
  hq: GeoPosition;
  spawns: GeoPosition[];
  createdAt: number;
}
