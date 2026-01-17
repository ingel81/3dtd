import { NominatimAddress } from '../services/geocoding.service';

/**
 * Location System Types for Tower Defense
 */

/**
 * Basic coordinate interface
 */
export interface LocationCoords {
  lat: number;
  lon: number;
  height?: number;
}

/**
 * Location config with optional name (for debug/editable locations)
 */
export interface LocationConfig {
  lat: number;
  lon: number;
  name?: string; // Full displayName from OSM
  address?: NominatimAddress; // Structured address for smart display
}

/**
 * Full location info with display name
 */
export interface LocationInfo extends LocationCoords {
  name: string; // Display name (city/place)
  displayName: string; // Full Nominatim display name
  address?: NominatimAddress; // Structured address for smart display
}

/**
 * Spawn point configuration
 */
export interface SpawnLocationConfig extends LocationCoords {
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
export interface RandomSpawnCandidate {
  lat: number;
  lon: number;
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
  hq: { lat: number; lon: number };
  spawns: Array<{ lat: number; lon: number }>;
  createdAt: number;
}
