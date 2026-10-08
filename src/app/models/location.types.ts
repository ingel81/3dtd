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
