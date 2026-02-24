import { inject, Injectable } from '@angular/core';
import { RandomSpawnCandidate } from '../models/location.types';
import { StreetCacheService } from './street-cache.service';

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

export interface BuildingFootprint {
  id: number;
  type: string; // yes, residential, commercial, etc.
  levels: number; // building:levels tag (default 2)
  nodes: StreetNode[];
}

export interface BuildingData {
  buildings: BuildingFootprint[];
}

/**
 * Street types suitable for enemy spawning (exclude footpaths)
 */
const SPAWNABLE_STREET_TYPES = ['residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'living_street'];

/**
 * Cost multipliers for pathfinding by street type.
 * Lower = preferred, Higher = avoided.
 * Footpaths get multiplier 3.0 = only used if route is >66% shorter
 */
const ROAD_TYPE_WEIGHTS: Record<string, number> = {
  // Main roads - preferred
  motorway: 0.8,
  motorway_link: 0.85,
  trunk: 0.85,
  trunk_link: 0.9,
  primary: 0.9,
  primary_link: 0.95,
  secondary: 0.95,
  secondary_link: 1.0,
  tertiary: 1.0,
  tertiary_link: 1.0,

  // Normal streets - standard
  residential: 1.0,
  living_street: 1.1,
  unclassified: 1.0,
  service: 1.2,

  // Footpaths/bike paths - heavily penalized (only if significantly shorter)
  pedestrian: 2.5,
  cycleway: 2.0,
  footway: 3.0,
  path: 3.0,
  track: 2.5,
  steps: 5.0, // Strongly avoid stairs
};

/** Default weight for unknown street types */
const DEFAULT_ROAD_WEIGHT = 1.5;

/**
 * MinHeap for A* pathfinding - O(log n) insert/extract
 */
class MinHeap<T> {
  private heap: { item: T; priority: number }[] = [];

  get size(): number { return this.heap.length; }

  push(item: T, priority: number): void {
    this.heap.push({ item, priority });
    this._bubbleUp(this.heap.length - 1);
  }

  pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].item;
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].priority >= this.heap[parent].priority) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  private _sinkDown(i: number): void {
    const len = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && this.heap[left].priority < this.heap[smallest].priority) smallest = left;
      if (right < len && this.heap[right].priority < this.heap[smallest].priority) smallest = right;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

@Injectable({
  providedIn: 'root',
})
export class OsmStreetService {
  // IndexedDB cache service (replaces localStorage)
  private readonly streetCache = inject(StreetCacheService);

  // Multiple Overpass API servers for fallback
  private readonly OVERPASS_SERVERS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];

  // Cached graph for pathfinding (avoid rebuilding on every findPath call)
  // neighbors now include streetType for weighted pathfinding
  private cachedGraph: Map<number, { node: StreetNode; neighbors: { nodeId: number; streetType: string }[] }> | null = null;
  private cachedGraphNetworkId: string | null = null;

  /**
   * Load street network for a given bounding box around coordinates
   * Uses IndexedDB cache to avoid repeated API calls (supports larger data than localStorage)
   */
  async loadStreets(
    centerLat: number,
    centerLon: number,
    radiusMeters = 500
  ): Promise<StreetNetwork> {
    // Try to load from IndexedDB cache first
    const cacheKey = this.streetCache.getCacheKey(centerLat, centerLon, radiusMeters);
    const cached = await this.streetCache.load(cacheKey);
    if (cached) {
      console.log('[OSM] Loaded from IndexedDB cache');
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

        const data = await response.json();

        const network = this.parseOverpassResponse(data, bounds);

        // Check if any streets were found
        if (network.streets.length === 0) {
          throw new Error('No streets found in this area. Choose a different location.');
        }

        // Cache the result to IndexedDB (async, fire-and-forget)
        this.streetCache.save(cacheKey, network).catch((err) => {
          console.warn('[OSM] Failed to cache to IndexedDB:', err);
        });

        return network;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Continue to next server
      }
    }

    console.error('[OSM] All Overpass servers failed');
    // Provide user-friendly error message
    const userMessage = 'OSM server unreachable. Check your internet connection.';
    throw lastError?.message?.includes('No streets')
      ? lastError
      : new Error(userMessage);
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
    // Scale longitude by cos(latitude) to get approximately equal-distance units
    const midLat = (aLat + bLat) * 0.5;
    const lonScale = Math.cos((midLat * Math.PI) / 180);

    const dxSeg = (bLon - aLon) * lonScale;
    const dySeg = bLat - aLat;
    const lengthSq = dxSeg * dxSeg + dySeg * dySeg;

    if (lengthSq === 0) {
      return this.haversineDistance(pLat, pLon, aLat, aLon);
    }

    const dxPoint = (pLon - aLon) * lonScale;
    const dyPoint = pLat - aLat;

    // Parameter t represents position along segment (0 = at A, 1 = at B)
    let t = (dxPoint * dxSeg + dyPoint * dySeg) / lengthSq;
    t = Math.max(0, Math.min(1, t)); // Clamp to segment

    // Interpolate in original coordinates for haversine
    const closestLat = aLat + t * (bLat - aLat);
    const closestLon = aLon + t * (bLon - aLon);

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
    const path = this.astar(
      graph,
      startPoint.street.nodes[startPoint.nodeIndex],
      endPoint.street.nodes[endPoint.nodeIndex],
      endLat,
      endLon
    );

    return path;
  }

  /**
   * Get cached graph or build new one if network changed
   */
  private getOrBuildGraph(network: StreetNetwork): Map<number, { node: StreetNode; neighbors: { nodeId: number; streetType: string }[] }> {
    // Create unique ID for this network based on bounds
    const networkId = `${network.bounds.minLat}_${network.bounds.maxLat}_${network.bounds.minLon}_${network.bounds.maxLon}_${network.streets.length}`;

    // Return cached graph if same network
    if (this.cachedGraph && this.cachedGraphNetworkId === networkId) {
      return this.cachedGraph;
    }

    // Build and cache new graph
    this.cachedGraph = this.buildGraph(network);
    this.cachedGraphNetworkId = networkId;

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

    // Collect all route points
    const routePoints: { lat: number; lon: number }[] = [];
    for (const route of routes) {
      routePoints.push(...route);
    }

    if (routePoints.length === 0) {
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

  private buildGraph(network: StreetNetwork): Map<number, { node: StreetNode; neighbors: { nodeId: number; streetType: string }[] }> {
    const graph = new Map<number, { node: StreetNode; neighbors: { nodeId: number; streetType: string }[] }>();

    // Add all nodes from streets
    for (const street of network.streets) {
      const streetType = street.type;

      for (let i = 0; i < street.nodes.length; i++) {
        const node = street.nodes[i];

        if (!graph.has(node.id)) {
          graph.set(node.id, { node, neighbors: [] });
        }

        const entry = graph.get(node.id)!;

        // Connect to previous node in street
        if (i > 0) {
          const prevNode = street.nodes[i - 1];
          // Check if neighbor already exists (avoid duplicates)
          if (!entry.neighbors.some(n => n.nodeId === prevNode.id)) {
            entry.neighbors.push({ nodeId: prevNode.id, streetType });
          }
        }

        // Connect to next node in street
        if (i < street.nodes.length - 1) {
          const nextNode = street.nodes[i + 1];
          if (!entry.neighbors.some(n => n.nodeId === nextNode.id)) {
            entry.neighbors.push({ nodeId: nextNode.id, streetType });
          }
        }
      }
    }

    return graph;
  }

  private astar(
    graph: Map<number, { node: StreetNode; neighbors: { nodeId: number; streetType: string }[] }>,
    start: StreetNode,
    end: StreetNode,
    endLat: number,
    endLon: number
  ): StreetNode[] {
    const openHeap = new MinHeap<number>();
    const openSetTracker = new Set<number>([start.id]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>();
    const fScore = new Map<number, number>();

    const startF = this.haversineDistance(start.lat, start.lon, endLat, endLon);
    gScore.set(start.id, 0);
    fScore.set(start.id, startF);
    openHeap.push(start.id, startF);

    while (openHeap.size > 0) {
      // Extract node with lowest fScore - O(log n) via MinHeap
      const current = openHeap.pop()!;

      // Skip if already processed (stale heap entry)
      if (!openSetTracker.has(current)) continue;

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

      openSetTracker.delete(current);
      const currentEntry = graph.get(current);

      if (!currentEntry) continue;

      for (const neighbor of currentEntry.neighbors) {
        const neighborEntry = graph.get(neighbor.nodeId);
        if (!neighborEntry) continue;

        // Calculate distance with road type weight
        const distance = this.haversineDistance(
          currentEntry.node.lat,
          currentEntry.node.lon,
          neighborEntry.node.lat,
          neighborEntry.node.lon
        );
        const weight = ROAD_TYPE_WEIGHTS[neighbor.streetType] ?? DEFAULT_ROAD_WEIGHT;
        const weightedDistance = distance * weight;

        const tentativeG = (gScore.get(current) ?? Infinity) + weightedDistance;

        if (tentativeG < (gScore.get(neighbor.nodeId) ?? Infinity)) {
          cameFrom.set(neighbor.nodeId, current);
          gScore.set(neighbor.nodeId, tentativeG);
          // Heuristic uses unweighted distance (admissible heuristic)
          const neighborF = tentativeG + this.haversineDistance(neighborEntry.node.lat, neighborEntry.node.lon, endLat, endLon);
          fScore.set(neighbor.nodeId, neighborF);

          openHeap.push(neighbor.nodeId, neighborF);
          openSetTracker.add(neighbor.nodeId);
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
   * Load building footprints for a given bounding box around coordinates
   */
  async loadBuildings(
    centerLat: number,
    centerLon: number,
    radiusMeters = 500
  ): Promise<BuildingData> {
    const latDelta = radiusMeters / 111320;
    const lonDelta = radiusMeters / (111320 * Math.cos((centerLat * Math.PI) / 180));

    const bounds = {
      minLat: centerLat - latDelta,
      maxLat: centerLat + latDelta,
      minLon: centerLon - lonDelta,
      maxLon: centerLon + lonDelta,
    };

    const query = `
      [out:json][timeout:25][maxsize:4194304];
      (
        way["building"](${bounds.minLat},${bounds.minLon},${bounds.maxLat},${bounds.maxLon});
      );
      out body;
      >;
      out skel qt;
    `;

    let lastError: Error | null = null;

    for (const server of this.OVERPASS_SERVERS) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(server, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`OSM API error: ${response.status}`);
        }

        const data = await response.json();
        const buildings = this.parseBuildingResponse(data);

        console.log(`[OSM] Loaded ${buildings.length} building footprints`);
        return { buildings };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    console.error('[OSM] All Overpass servers failed for buildings');
    throw lastError ?? new Error('Failed to load buildings');
  }

  private parseBuildingResponse(
    data: {
      elements: {
        type: string;
        id: number;
        lat?: number;
        lon?: number;
        nodes?: number[];
        tags?: Record<string, string>;
      }[];
    }
  ): BuildingFootprint[] {
    const nodes = new Map<number, StreetNode>();
    const buildings: BuildingFootprint[] = [];

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

    // Second pass: build polygons from ways
    for (const element of data.elements) {
      if (element.type === 'way' && element.nodes) {
        const polyNodes: StreetNode[] = [];

        for (const nodeId of element.nodes) {
          const node = nodes.get(nodeId);
          if (node) {
            polyNodes.push(node);
          }
        }

        if (polyNodes.length >= 3) {
          const rawLevels = element.tags?.['building:levels'];
          const levels = rawLevels ? Math.max(1, Math.round(parseFloat(rawLevels))) : 2;
          buildings.push({
            id: element.id,
            type: element.tags?.['building'] || 'yes',
            levels,
            nodes: polyNodes,
          });
        }
      }
    }

    return buildings;
  }

  /**
   * Filter buildings to only include those near the given routes.
   */
  filterBuildingsNearRoutes(
    buildings: BuildingFootprint[],
    routes: { lat: number; lon: number }[][],
    corridorWidth = 100
  ): BuildingFootprint[] {
    const routePoints: { lat: number; lon: number }[] = [];
    for (const route of routes) {
      routePoints.push(...route);
    }

    if (routePoints.length === 0) {
      return buildings;
    }

    const filtered: BuildingFootprint[] = [];

    for (const building of buildings) {
      let nearRoute = false;
      for (const node of building.nodes) {
        if (this.isPointNearRoute(node.lat, node.lon, routePoints, corridorWidth)) {
          nearRoute = true;
          break;
        }
      }
      if (nearRoute) {
        filtered.push(building);
      }
    }

    console.log(`[OSM] Filtered buildings: ${buildings.length} → ${filtered.length}`);
    return filtered;
  }

  /**
   * Clear cache for specific coordinates or all street caches (IndexedDB)
   */
  async clearCache(centerLat?: number, centerLon?: number, radiusMeters?: number): Promise<void> {
    if (centerLat !== undefined && centerLon !== undefined && radiusMeters !== undefined) {
      // Clear specific cache
      const cacheKey = this.streetCache.getCacheKey(centerLat, centerLon, radiusMeters);
      await this.streetCache.clear(cacheKey);
    } else {
      // Clear all street caches
      await this.streetCache.clearAll();
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
