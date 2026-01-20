/**
 * StreetNetworkProvider Interface
 *
 * Abstracts street network operations for both real OSM data and DevWorld fake streets.
 * Used for enemy pathfinding, spawn point selection, and route visualization.
 */

export interface StreetNode {
  id: number;
  lat: number;
  lon: number;
}

export interface Street {
  id: number;
  name: string;
  type: string; // residential, primary, secondary, etc.
  nodes: StreetNode[];
}

export interface StreetNetwork {
  streets: Street[];
  nodes: Map<number, StreetNode>;
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

export interface NearestStreetPoint {
  street: Street;
  nodeIndex: number;
  distance: number;
}

export interface SpawnCandidate {
  lat: number;
  lon: number;
  distance: number;
  direction: string;
  streetName: string;
}

export interface StreetNetworkProvider {
  /**
   * Load/initialize the street network for a given area.
   * For real OSM: fetches from Overpass API
   * For DevWorld: returns hardcoded street graph
   */
  loadStreets(centerLat: number, centerLon: number, radiusMeters?: number): Promise<StreetNetwork>;

  /**
   * Find the nearest point on any street to given coordinates.
   * Used for snapping positions to streets.
   */
  findNearestStreetPoint(
    network: StreetNetwork,
    lat: number,
    lon: number
  ): NearestStreetPoint | null;

  /**
   * Find path from start to end along streets using A*.
   * Returns array of nodes representing the path.
   */
  findPath(
    network: StreetNetwork,
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ): StreetNode[];

  /**
   * Get spawn candidates at a certain distance from center.
   * Used for enemy wave spawning.
   */
  getSpawnCandidates(
    network: StreetNetwork,
    centerLat: number,
    centerLon: number,
    minDistance: number,
    maxDistance: number,
    count?: number
  ): SpawnCandidate[];

  /**
   * Calculate distance between two geographic points.
   */
  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number;

  /**
   * Clear any cached data.
   */
  clearCache(): void;
}
