import { Injectable } from '@angular/core';
import { RandomSpawnCandidate } from '../models/location.types';

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

/**
 * Street types suitable for enemy spawning (exclude footpaths)
 */
const SPAWNABLE_STREET_TYPES = ['residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'living_street'];

@Injectable({
  providedIn: 'root',
})
export class OsmStreetService {
  // Multiple Overpass API servers for fallback
  private readonly OVERPASS_SERVERS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];

  private readonly CACHE_PREFIX = 'td_streets_';
  private readonly CACHE_VERSION = 1;

  // Cached graph for pathfinding (avoid rebuilding on every findPath call)
  private cachedGraph: Map<number, { node: StreetNode; neighbors: number[] }> | null = null;
  private cachedGraphNetworkId: string | null = null;

  /**
   * Load street network for a given bounding box around coordinates
   * Uses localStorage cache to avoid repeated API calls
   */
  async loadStreets(
    centerLat: number,
    centerLon: number,
    radiusMeters = 500
  ): Promise<StreetNetwork> {
    // Try to load from cache first
    const cacheKey = this.getCacheKey(centerLat, centerLon, radiusMeters);
    const cached = this.loadFromCache(cacheKey);
    if (cached) {
      return cached;
    }

    // Calculate bounding box (approximate)
    const latDelta = radiusMeters / 111320; // 1 degree lat ≈ 111.32 km
    const lonDelta = radiusMeters / (111320 * Math.cos((centerLat * Math.PI) / 180));

    const bounds = {
      minLat: centerLat - latDelta,
      maxLat: centerLat + latDelta,
      minLon: centerLon - lonDelta,
      maxLon: centerLon + lonDelta,
    };

    // Overpass QL query for streets
    // maxsize limits response to 4MB to prevent huge downloads in dense cities
    const query = `
      [out:json][timeout:25][maxsize:4194304];
      (
        way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|pedestrian|footway|path|cycleway|track|steps)$"]
          (${bounds.minLat},${bounds.minLon},${bounds.maxLat},${bounds.maxLon});
      );
      out body;
      >;
      out skel qt;
    `;

    // Try each server until one works
    let lastError: Error | null = null;

    for (const server of this.OVERPASS_SERVERS) {
      try {

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const response = await fetch(server, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`OSM API error: ${response.status}`);
        }

        console.time('[OSM] JSON parse');
        const data = await response.json();
        console.timeEnd('[OSM] JSON parse');

        console.time('[OSM] parseOverpassResponse');
        const network = this.parseOverpassResponse(data, bounds);
        console.timeEnd('[OSM] parseOverpassResponse');

        // Cache the result
        this.saveToCache(cacheKey, network);

        return network;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Continue to next server
      }
    }

    console.error('[OSM] All Overpass servers failed');
    throw lastError || new Error('All Overpass servers failed');
  }

  private getCacheKey(lat: number, lon: number, radius: number): string {
    // Round coordinates to avoid floating point issues
    const roundedLat = Math.round(lat * 10000) / 10000;
    const roundedLon = Math.round(lon * 10000) / 10000;
    return `${this.CACHE_PREFIX}v${this.CACHE_VERSION}_${roundedLat}_${roundedLon}_${radius}`;
  }

  private loadFromCache(key: string): StreetNetwork | null {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;

      const data = JSON.parse(cached);

      // Reconstruct the Map from the cached array
      const nodes = new Map<number, StreetNode>();
      for (const [id, node] of data.nodesArray) {
        nodes.set(id, node);
      }

      return {
        streets: data.streets,
        nodes,
        bounds: data.bounds,
      };
    } catch {
      return null;
    }
  }

  private saveToCache(key: string, network: StreetNetwork): void {
    try {
      // Convert Map to array for JSON serialization
      const data = {
        streets: network.streets,
        nodesArray: Array.from(network.nodes.entries()),
        bounds: network.bounds,
      };

      const jsonData = JSON.stringify(data);

      // Try to save, and if quota exceeded, clear old caches first
      try {
        localStorage.setItem(key, jsonData);
      } catch {
        // Quota exceeded - clear all street caches and try again
        this.clearOldCaches();
        localStorage.setItem(key, jsonData);
      }

    } catch {
      // Silent fail - caching is optional
    }
  }

  /**
   * Clear all street network caches from localStorage
   */
  private clearOldCaches(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  }

  private parseOverpassResponse(
    data: {
      elements: {
        type: string;
        id: number;
        lat?: number;
        lon?: number;
        nodes?: number[];
        tags?: { name?: string; highway?: string };
      }[];
    },
    bounds: StreetNetwork['bounds']
  ): StreetNetwork {
    const nodes = new Map<number, StreetNode>();
    const streets: Street[] = [];

    // First pass: collect all nodes
    for (const element of data.elements) {
      if (element.type === 'node') {
        nodes.set(element.id, {
          id: element.id,
          lat: element.lat!,
          lon: element.lon!,
        });
      }
    }

    // Second pass: build streets from ways
    for (const element of data.elements) {
      if (element.type === 'way' && element.nodes) {
        const streetNodes: StreetNode[] = [];

        for (const nodeId of element.nodes) {
          const node = nodes.get(nodeId);
          if (node) {
            streetNodes.push(node);
          }
        }

        if (streetNodes.length >= 2) {
          streets.push({
            id: element.id,
            name: element.tags?.name || 'Unnamed Street',
            type: element.tags?.highway || 'unknown',
            nodes: streetNodes,
          });
        }
      }
    }

    return { streets, nodes, bounds };
  }

  /**
   * Find the nearest point on any street segment to given coordinates
   * This checks distance to line segments, not just nodes
   */
  findNearestStreetPoint(
    network: StreetNetwork,
    lat: number,
    lon: number
  ): { street: Street; nodeIndex: number; distance: number } | null {
    let nearest: { street: Street; nodeIndex: number; distance: number } | null = null;

    for (const street of network.streets) {
      // Check distance to each segment (line between consecutive nodes)
      for (let i = 0; i < street.nodes.length - 1; i++) {
        const node1 = street.nodes[i];
        const node2 = street.nodes[i + 1];
        const dist = this.distanceToSegment(lat, lon, node1.lat, node1.lon, node2.lat, node2.lon);

        if (!nearest || dist < nearest.distance) {
          nearest = { street, nodeIndex: i, distance: dist };
        }
      }
    }

    return nearest;
  }

  /**
   * Calculate perpendicular distance from a point to a line segment
   */
  private distanceToSegment(
    pLat: number,
    pLon: number,
    aLat: number,
    aLon: number,
    bLat: number,
    bLon: number
  ): number {
    const segmentLength = this.haversineDistance(aLat, aLon, bLat, bLon);
    if (segmentLength === 0) {
      return this.haversineDistance(pLat, pLon, aLat, aLon);
    }

    // Project point onto line segment (using simple approximation for small distances)
    const dxSeg = bLon - aLon;
    const dySeg = bLat - aLat;
    const dxPoint = pLon - aLon;
    const dyPoint = pLat - aLat;

    // Parameter t represents position along segment (0 = at A, 1 = at B)
    let t = (dxPoint * dxSeg + dyPoint * dySeg) / (dxSeg * dxSeg + dySeg * dySeg);
    t = Math.max(0, Math.min(1, t)); // Clamp to segment

    // Closest point on segment
    const closestLon = aLon + t * dxSeg;
    const closestLat = aLat + t * dySeg;

    return this.haversineDistance(pLat, pLon, closestLat, closestLon);
  }

  /**
   * Simple pathfinding: find path from start to end along streets
   * Uses A* algorithm on the street network
   */
  findPath(
    network: StreetNetwork,
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ): StreetNode[] {
    // Find nearest street points to start and end
    const startPoint = this.findNearestStreetPoint(network, startLat, startLon);
    const endPoint = this.findNearestStreetPoint(network, endLat, endLon);

    if (!startPoint || !endPoint) {
      console.warn('Could not find street points for pathfinding');
      return [];
    }

    // Get or build adjacency graph (cached for performance)
    const graph = this.getOrBuildGraph(network);

    // A* pathfinding
    console.time('[OSM] astar');
    const path = this.astar(
      graph,
      startPoint.street.nodes[startPoint.nodeIndex],
      endPoint.street.nodes[endPoint.nodeIndex],
      endLat,
      endLon
    );
    console.timeEnd('[OSM] astar');

    return path;
  }

  /**
   * Get cached graph or build new one if network changed
   */
  private getOrBuildGraph(network: StreetNetwork): Map<number, { node: StreetNode; neighbors: number[] }> {
    // Create unique ID for this network based on bounds
    const networkId = `${network.bounds.minLat}_${network.bounds.maxLat}_${network.bounds.minLon}_${network.bounds.maxLon}_${network.streets.length}`;

    // Return cached graph if same network
    if (this.cachedGraph && this.cachedGraphNetworkId === networkId) {
      return this.cachedGraph;
    }

    // Build and cache new graph
    console.time('[OSM] buildGraph');
    this.cachedGraph = this.buildGraph(network);
    this.cachedGraphNetworkId = networkId;
    console.timeEnd('[OSM] buildGraph');

    return this.cachedGraph;
  }

  /**
   * Clear cached graph (call when switching locations)
   */
  clearGraphCache(): void {
    this.cachedGraph = null;
    this.cachedGraphNetworkId = null;
  }

  /**
   * Filter street network to only include streets near the given routes.
   * This dramatically reduces data for rendering in dense cities.
   *
   * @param network Full street network
   * @param routes Array of route paths (each route is array of {lat, lon})
   * @param corridorWidth Width of corridor around routes in meters (default 100m)
   * @returns Filtered street network with only nearby streets
   */
  filterStreetsNearRoutes(
    network: StreetNetwork,
    routes: { lat: number; lon: number }[][],
    corridorWidth = 100
  ): StreetNetwork {
    console.time('[OSM] filterStreetsNearRoutes');

    // Collect all route points
    const routePoints: { lat: number; lon: number }[] = [];
    for (const route of routes) {
      routePoints.push(...route);
    }

    if (routePoints.length === 0) {
      console.timeEnd('[OSM] filterStreetsNearRoutes');
      return network; // No routes, return full network
    }

    // Filter streets: keep only those with at least one node near any route point
    const filteredStreets: Street[] = [];
    const usedNodeIds = new Set<number>();

    for (const street of network.streets) {
      let streetNearRoute = false;

      // Check if any node of this street is near the route
      for (const node of street.nodes) {
        if (this.isPointNearRoute(node.lat, node.lon, routePoints, corridorWidth)) {
          streetNearRoute = true;
          break;
        }
      }

      if (streetNearRoute) {
        filteredStreets.push(street);
        for (const node of street.nodes) {
          usedNodeIds.add(node.id);
        }
      }
    }

    // Build filtered nodes map
    const filteredNodes = new Map<number, StreetNode>();
    for (const nodeId of usedNodeIds) {
      const node = network.nodes.get(nodeId);
      if (node) {
        filteredNodes.set(nodeId, node);
      }
    }

    console.timeEnd('[OSM] filterStreetsNearRoutes');
    console.log(`[OSM] Filtered: ${network.streets.length} → ${filteredStreets.length} streets, ${network.nodes.size} → ${filteredNodes.size} nodes`);

    return {
      streets: filteredStreets,
      nodes: filteredNodes,
      bounds: network.bounds,
    };
  }

  /**
   * Check if a point is within distance of any route point
   */
  private isPointNearRoute(
    lat: number,
    lon: number,
    routePoints: { lat: number; lon: number }[],
    maxDistance: number
  ): boolean {
    // Quick bounding box check first (rough filter)
    // ~0.001 degrees ≈ 111m at equator
    const roughDelta = maxDistance / 111000 * 1.5; // Add 50% margin

    for (const rp of routePoints) {
      // Quick rejection based on lat/lon difference
      if (Math.abs(lat - rp.lat) > roughDelta || Math.abs(lon - rp.lon) > roughDelta) {
        continue;
      }

      // Precise distance check
      const dist = this.haversineDistance(lat, lon, rp.lat, rp.lon);
      if (dist <= maxDistance) {
        return true;
      }
    }

    return false;
  }

  private buildGraph(network: StreetNetwork): Map<number, { node: StreetNode; neighbors: number[] }> {
    const graph = new Map<number, { node: StreetNode; neighbors: number[] }>();

    // Add all nodes from streets
    for (const street of network.streets) {
      for (let i = 0; i < street.nodes.length; i++) {
        const node = street.nodes[i];

        if (!graph.has(node.id)) {
          graph.set(node.id, { node, neighbors: [] });
        }

        // Connect to previous and next node in street
        if (i > 0) {
          const prevNode = street.nodes[i - 1];
          const entry = graph.get(node.id)!;
          if (!entry.neighbors.includes(prevNode.id)) {
            entry.neighbors.push(prevNode.id);
          }
        }

        if (i < street.nodes.length - 1) {
          const nextNode = street.nodes[i + 1];
          const entry = graph.get(node.id)!;
          if (!entry.neighbors.includes(nextNode.id)) {
            entry.neighbors.push(nextNode.id);
          }
        }
      }
    }

    return graph;
  }

  private astar(
    graph: Map<number, { node: StreetNode; neighbors: number[] }>,
    start: StreetNode,
    end: StreetNode,
    endLat: number,
    endLon: number
  ): StreetNode[] {
    const openSet = new Set<number>([start.id]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>();
    const fScore = new Map<number, number>();

    gScore.set(start.id, 0);
    fScore.set(start.id, this.haversineDistance(start.lat, start.lon, endLat, endLon));

    while (openSet.size > 0) {
      // Find node in openSet with lowest fScore
      let current: number | null = null;
      let lowestF = Infinity;

      for (const nodeId of openSet) {
        const f = fScore.get(nodeId) ?? Infinity;
        if (f < lowestF) {
          lowestF = f;
          current = nodeId;
        }
      }

      if (current === null) break;

      if (current === end.id) {
        // Reconstruct path
        const path: StreetNode[] = [];
        let curr: number | undefined = current;

        while (curr !== undefined) {
          const entry = graph.get(curr);
          if (entry) path.unshift(entry.node);
          curr = cameFrom.get(curr);
        }

        return path;
      }

      openSet.delete(current);
      const currentEntry = graph.get(current);

      if (!currentEntry) continue;

      for (const neighborId of currentEntry.neighbors) {
        const neighborEntry = graph.get(neighborId);
        if (!neighborEntry) continue;

        const tentativeG =
          (gScore.get(current) ?? Infinity) +
          this.haversineDistance(
            currentEntry.node.lat,
            currentEntry.node.lon,
            neighborEntry.node.lat,
            neighborEntry.node.lon
          );

        if (tentativeG < (gScore.get(neighborId) ?? Infinity)) {
          cameFrom.set(neighborId, current);
          gScore.set(neighborId, tentativeG);
          fScore.set(
            neighborId,
            tentativeG + this.haversineDistance(neighborEntry.node.lat, neighborEntry.node.lon, endLat, endLon)
          );

          openSet.add(neighborId);
        }
      }
    }

    // No path found - return empty array (NOT a direct line!)
    console.warn('No path found between nodes');
    return [];
  }

  /**
   * Calculate distance between two coordinates in meters (Haversine formula)
   */
  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Clear cache for specific coordinates or all street caches
   */
  clearCache(centerLat?: number, centerLon?: number, radiusMeters?: number): void {
    if (centerLat !== undefined && centerLon !== undefined && radiusMeters !== undefined) {
      // Clear specific cache
      const cacheKey = this.getCacheKey(centerLat, centerLon, radiusMeters);
      localStorage.removeItem(cacheKey);
    } else {
      // Clear all street caches
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.CACHE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
    }
  }

  /**
   * Find a random street point within a distance range from center
   * Used for generating random spawn points
   *
   * @param network - The loaded street network
   * @param centerLat - Center latitude (HQ position)
   * @param centerLon - Center longitude (HQ position)
   * @param minDistance - Minimum distance from center in meters (default 500m)
   * @param maxDistance - Maximum distance from center in meters (default 1000m)
   * @returns A random spawn candidate or null if none found
   */
  findRandomStreetPoint(
    network: StreetNetwork,
    centerLat: number,
    centerLon: number,
    minDistance = 500,
    maxDistance = 1000
  ): RandomSpawnCandidate | null {
    // 1. Collect all street nodes in distance range (excluding footpaths)
    const candidates: RandomSpawnCandidate[] = [];

    for (const street of network.streets) {
      // Skip footpaths and paths - enemies should spawn on roads
      if (!SPAWNABLE_STREET_TYPES.includes(street.type)) {
        continue;
      }

      for (const node of street.nodes) {
        const distance = this.haversineDistance(centerLat, centerLon, node.lat, node.lon);
        if (distance >= minDistance && distance <= maxDistance) {
          candidates.push({
            lat: node.lat,
            lon: node.lon,
            distance,
            streetName: street.name,
            nodeId: node.id,
          });
        }
      }
    }

    if (candidates.length === 0) {
      console.warn('[OSM] No street points found in distance range');
      return null;
    }

    // 2. Shuffle candidates
    const shuffled = candidates.sort(() => Math.random() - 0.5);

    // 3. Check path validity for top candidates
    let testedCount = 0;
    for (const candidate of shuffled.slice(0, 50)) {
      testedCount++;
      const path = this.findPath(network, candidate.lat, candidate.lon, centerLat, centerLon);

      // Path must exist (length > 0) and have at least 2 nodes
      if (path.length >= 2) {
        return candidate;
      }
    }

    console.warn(`[OSM] No reachable street points found after testing ${testedCount} candidates`);
    return null;
  }
}
