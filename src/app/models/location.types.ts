import { NominatimAddress } from '../services/location/geocoding.service';
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
 * A spawn as the location keeps it (LocationManagementService.spawns, the
 * URL, favorites): where it stands and, if the player turned its portal
 * with R while placing it, which way the portal faces, as a compass bearing
 * (degrees clockwise from north). Without one the portal faces along its
 * route. Every build of the route holds the bearing in the range the
 * enemies still leave the portal through (MarkerVisualizationService
 * .setPortalHeading); the bearing itself stays as the player gave it.
 */
export interface SavedSpawn extends GeoPosition {
  portalBearing?: number;
}

/**
 * Spawn point configuration
 */
export interface SpawnLocationConfig extends SavedSpawn {
  id: string;
  name?: string;
  isRandom?: boolean;
}

/**
 * Tabs of the location dialog: a place (search, recent and showcase places,
 * a new spawn for the current place), the world map of defended places, and
 * joining a coop game
 */
export type LocationDialogMode = 'place' | 'world' | 'coop';

/**
 * Data passed to location dialog
 */
export interface LocationDialogData {
  currentLocation: LocationInfo | null;
  currentSpawn: SpawnLocationConfig | null;
  isGameInProgress: boolean;
  /** Tab the dialog opens on, 'place' when not given */
  initialMode?: LocationDialogMode;
}

/**
 * Result from location dialog
 */
export interface LocationDialogResult {
  hq: LocationInfo;
  spawn: SpawnLocationConfig;
  confirmed: boolean;
  /** Every spawn of the place, where there are several: a coop host's (E30) */
  spawns?: SavedSpawn[];
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
 * Favorite location for quick access. The list keeps the order the player
 * gave it.
 */
export interface FavoriteLocation {
  id: string;
  hq: GeoPosition;
  /** With the portal bearing where the player turned it; spawns saved before 2026-09-14 have none */
  spawns: SavedSpawn[];
  createdAt: number;
  /**
   * Name the player gave it, suggested from the header when saved. Without
   * one (favorites saved before names existed, or a name cleared) the name
   * is resolved via the geocoding cache.
   */
  name?: string;
}
