import { isDevMode } from '@angular/core';
import type { Street, StreetNetwork, StreetNode } from '../../interfaces/street-network-provider.interface';
import type { RandomSpawnCandidate } from '../../models/location.types';
import { METERS_PER_DEGREE_LAT, canonicalCoords } from '../../utils/geo-utils';
import { SegmentRoutes, type RouteTail } from '../../utils/route-start';
import { PORTAL_DEPTH, PORTAL_MAX_SCALE, portalDepthScale } from '../../configs/marker-geometry.config';
import { closestPointOnSegment } from '../../utils/route-geometry';
import { MAX_HQ_STREET_DISTANCE } from '../../configs/map-constants.config';
import {
  DEFAULT_ROAD_WEIGHT,
  MinHeap,
  ROAD_TYPE_WEIGHTS,
  haversineDistance as sharedHaversineDistance,
} from '../../utils/street-astar';
import { nearestStreetSegment } from '../../utils/street-grid';
import { coveredSpawnRange, isInsideCoverage, type WorldCoverage } from '../../world/world-coverage';

/**
 * Street types suitable for enemy spawning (exclude footpaths)
 */
const SPAWNABLE_STREET_TYPES = ['residential', 'primary', 'secondary', 'tertiary', 'unclassified', 'living_street'];

/** Id A* gives the end of a route beyond the ends of its last segment; OSM ids are positive, -1 is a route start. */
const ROUTE_END_ID = -2;

/** A random spawn's route may turn this much (rad, 5°) up to the portal's plane and still count as straight. */
const SPAWN_STRAIGHT_TURN = (5 * Math.PI) / 180;
/** Step (m) a random spawn moves along its route to a straight stretch. */
const SPAWN_SHIFT_STEP_M = 0.5;
/** Farthest (m) a random spawn moves along its route to a straight stretch. */
const SPAWN_MAX_SHIFT_M = 30;

/** The street graph's connected pieces: a number per node id, the same for nodes a route can join. */
function connectedComponents(graph: ReadonlyMap<number, { neighbors: { nodeId: number }[] }>): Map<number, number> {
  const components = new Map<number, number>();
  let next = 0;
  for (const id of graph.keys()) {
    if (components.has(id)) continue;
    const piece = next++;
    const open = [id];
    components.set(id, piece);
    while (open.length > 0) {
      for (const { nodeId } of graph.get(open.pop()!)?.neighbors ?? []) {
        if (components.has(nodeId)) continue;
        components.set(nodeId, piece);
        open.push(nodeId);
      }
    }
  }
  return components;
}

/**
 * Routes on a street network, whatever world it comes from: the nearest
 * street point, A* along the segments (findPath, segmentRoutes), random
 * spawn points with a route to the HQ, the streets near the routes. Moved
 * out of OsmStreetService, which extends it with the Overpass loads;
 * DevStreetProvider extends it with its own pathfinding on the generated
 * grid. findRandomStreetPoint checks its candidates with the segment A*
 * (routeAlongSegments) in both, as it did before DevWorld had a street
 * source of its own.
 */
export class StreetRouter {
  // Cached graph for pathfinding (avoid rebuilding on every findPath call)
  // neighbors now include streetType for weighted pathfinding
  private cachedGraph: Map<number, { node: StreetNode; neighbors: { nodeId: number; streetType: string }[] }> | null = null;
  private cachedGraphNetworkId: string | null = null;
  /** Connected piece of the cached graph per node id, see connectedComponents. */
  private cachedComponents: Map<number, number> | null = null;

  /**
   * Find the nearest point on any street segment to given coordinates
   * This checks distance to line segments, not just nodes.
   * Runs over the network's segment grid (StreetSegmentGrid), which is built
   * on the first lookup of a network and dropped with it.
   */
  findNearestStreetPoint(
    network: StreetNetwork,
    lat: number,
    lon: number,
    accept?: (node: StreetNode, street: Street) => boolean
  ): { street: Street; nodeIndex: number; distance: number } | null {
    return nearestStreetSegment(network, lat, lon, accept);
  }

  /**
   * Path along the streets from start to end, A* on the street network. It
   * starts at the foot of the start on its nearest segment (SegmentRoutes)
   * and ends on the end of the segment nearest to the end that reaches the
   * end's foot on it for less, from where PathAndRouteService leads it to
   * the HQ (leavePathForBase).
   */
  findPath(
    network: StreetNetwork,
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ): StreetNode[] {
    return this.routeAlongSegments(network, startLat, startLon, endLat, endLon);
  }

  /** findPath's A* along the segments, also where a subclass routes otherwise */
  protected routeAlongSegments(
    network: StreetNetwork,
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ): StreetNode[] {
    const startPoint = this.findNearestStreetPoint(network, startLat, startLon);
    const routes = startPoint && this.segmentRoutes(network, startPoint, endLat, endLon);
    if (!routes) {
      console.warn('Could not find street points for pathfinding');
      return [];
    }
    return routes.routeFrom(startLat, startLon);
  }

  /**
   * The routes from the street segment `start` (as findNearestStreetPoint
   * gives it) to the end findPath goes to, see SegmentRoutes. findPath takes
   * the one from its start; the spawn preview keeps them per segment. Null
   * without a street near the end.
   */
  segmentRoutes(
    network: StreetNetwork,
    start: { street: Street; nodeIndex: number },
    endLat: number,
    endLon: number
  ): SegmentRoutes | null {
    // Get or build adjacency graph (cached for performance)
    const graph = this.getOrBuildGraph(network);

    // The end's segment among those the start's streets connect to: a way cut
    // off from them (a passage mapped inside the Colosseum, playtest
    // 2026-09-17) can lie nearest to the HQ, and A* never reaches it. A
    // connected one only up to MAX_HQ_STREET_DISTANCE farther than the
    // nearest of all, so a start on a cut-off piece far off gets no route.
    const components = this.cachedComponents!;
    const reachable = components.get(start.street.nodes[start.nodeIndex].id);
    const nearest = this.findNearestStreetPoint(network, endLat, endLon);
    const endPoint = this.findNearestStreetPoint(network, endLat, endLon, (node) => components.get(node.id) === reachable);
    if (!nearest || !endPoint || endPoint.distance > nearest.distance + MAX_HQ_STREET_DISTANCE) return null;

    // Both ends of the end's segment, each with the piece of it up to the
    // end's foot: the route goes to whichever reaches the foot for less. Until
    // 2026-09-17 it went to the segment's first node, round a square to the
    // far side of a way drawn towards the HQ (Plaça de Catalunya).
    const a = endPoint.street.nodes[endPoint.nodeIndex];
    const b = endPoint.street.nodes[endPoint.nodeIndex + 1];
    const foot = closestPointOnSegment(a, b, { lat: endLat, lon: endLon });
    const weight = ROAD_TYPE_WEIGHTS[endPoint.street.type] ?? DEFAULT_ROAD_WEIGHT;
    const ends = [a, b].map((node) => ({ node, cost: this.haversineDistance(node.lat, node.lon, foot.lat, foot.lon) * weight }));
    return new SegmentRoutes(
      start.street.nodes[start.nodeIndex],
      start.street.nodes[start.nodeIndex + 1],
      ROAD_TYPE_WEIGHTS[start.street.type] ?? DEFAULT_ROAD_WEIGHT,
      (node) => this.astar(graph, node, ends, endLat, endLon),
    );
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
    this.cachedComponents = connectedComponents(this.cachedGraph);
    this.cachedGraphNetworkId = networkId;

    return this.cachedGraph;
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

    if (isDevMode()) console.log(`[Streets] Filtered: ${network.streets.length} → ${filteredStreets.length} streets, ${network.nodes.size} → ${filteredNodes.size} nodes`);

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
    const roughDelta = maxDistance / METERS_PER_DEGREE_LAT * 1.5; // Add 50% margin

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

  /**
   * A* from `start` to the cheapest of `ends`, each node with the cost still
   * to pay from it to the end of the route. The path ends on that node, its
   * cost includes it.
   */
  private astar(
    graph: Map<number, { node: StreetNode; neighbors: { nodeId: number; streetType: string }[] }>,
    start: StreetNode,
    ends: readonly { node: StreetNode; cost: number }[],
    endLat: number,
    endLon: number
  ): RouteTail | null {
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

      if (current === ROUTE_END_ID) {
        // Reconstruct path
        const path: StreetNode[] = [];
        let curr: number | undefined = cameFrom.get(current);

        while (curr !== undefined) {
          const entry = graph.get(curr);
          if (entry) path.unshift(entry.node);
          curr = cameFrom.get(curr);
        }

        return { path, cost: gScore.get(current)! };
      }

      openSetTracker.delete(current);

      // An end of the route leads on to it at its remaining cost
      for (const end of ends) {
        if (end.node.id !== current) continue;
        const tentativeEnd = (gScore.get(current) ?? Infinity) + end.cost;
        if (tentativeEnd < (gScore.get(ROUTE_END_ID) ?? Infinity)) {
          cameFrom.set(ROUTE_END_ID, current);
          gScore.set(ROUTE_END_ID, tentativeEnd);
          openHeap.push(ROUTE_END_ID, tentativeEnd);
          openSetTracker.add(ROUTE_END_ID);
        }
      }
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

    // No path found - null (NOT a direct line!)
    console.warn('No path found between nodes');
    return null;
  }

  /**
   * Calculate distance between two coordinates in meters (Haversine formula)
   */
  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    return sharedHaversineDistance(lat1, lon1, lat2, lon2);
  }

  /**
   * Find a random street point within a distance range from center
   * Used for generating random spawn points
   *
   * A candidate stands at its node's canonical coordinates
   * (canonicalCoords), where the spawn will stand, and its route is checked
   * from there: rounded, the point can lie nearer another way than the one
   * the node is on.
   *
   * @param network - The loaded street network
   * @param centerLat - Center latitude (HQ position)
   * @param centerLon - Center longitude (HQ position)
   * @param minDistance - Minimum distance from center in meters (default 500m)
   * @param maxDistance - Maximum distance from center in meters (default 1000m)
   * @param coverage - The area the world has ground in (an own tileset's): the range is
   *   capped to it and a node outside it is no candidate; null: anywhere
   * @returns A random spawn candidate or null if none found
   */
  findRandomStreetPoint(
    network: StreetNetwork,
    centerLat: number,
    centerLon: number,
    minDistance = 500,
    maxDistance = 1000,
    coverage: WorldCoverage | null = null,
  ): RandomSpawnCandidate | null {
    ({ min: minDistance, max: maxDistance } = coveredSpawnRange(coverage, { lat: centerLat, lon: centerLon }, minDistance, maxDistance));

    // 1. Collect all street nodes in distance range (excluding footpaths)
    const candidates: RandomSpawnCandidate[] = [];

    for (const street of network.streets) {
      // Skip footpaths and paths - enemies should spawn on roads
      if (!SPAWNABLE_STREET_TYPES.includes(street.type)) {
        continue;
      }

      for (const node of street.nodes) {
        const { lat, lon } = canonicalCoords(node);
        const distance = this.haversineDistance(centerLat, centerLon, lat, lon);
        if (distance >= minDistance && distance <= maxDistance && isInsideCoverage(coverage, lat, lon)) {
          candidates.push({
            lat,
            lon,
            distance,
            streetName: street.name,
            nodeId: node.id,
          });
        }
      }
    }

    if (candidates.length === 0) {
      console.warn('[Streets] No street points found in distance range');
      return null;
    }

    // 2. Shuffle candidates
    const shuffled = candidates.sort(() => Math.random() - 0.5);

    // 3. Check path validity for top candidates
    let testedCount = 0;
    for (const candidate of shuffled.slice(0, 50)) {
      testedCount++;
      const path = this.routeAlongSegments(network, candidate.lat, candidate.lon, centerLat, centerLon);

      // Path must exist (length > 0) and have at least 2 nodes
      if (path.length >= 2) {
        return this.straightSpawn(network, candidate, path, centerLat, centerLon);
      }
    }

    console.warn(`[Streets] No reachable street points found after testing ${testedCount} candidates`);
    return null;
  }

  /**
   * `candidate` moved along its `path` towards the HQ as little as it takes
   * for the route to run straight through the spawn portal: within
   * SPAWN_STRAIGHT_TURN of the chord up to the portal's plane at its largest
   * scale. A random node often sits in a junction or just before a bend,
   * where the portal, turned to the route, stood askew to both streets. In
   * steps of SPAWN_SHIFT_STEP_M up to SPAWN_MAX_SHIFT_M; the candidate as it
   * is where no such place comes, or where the moved point has no route.
   */
  private straightSpawn(
    network: StreetNetwork,
    candidate: RandomSpawnCandidate,
    path: readonly StreetNode[],
    centerLat: number,
    centerLon: number,
  ): RandomSpawnCandidate {
    const cosLat = Math.cos((candidate.lat * Math.PI) / 180);
    const points = path.map((n) => ({
      x: (n.lon - candidate.lon) * cosLat * METERS_PER_DEGREE_LAT,
      z: (n.lat - candidate.lat) * METERS_PER_DEGREE_LAT,
    }));
    const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.z - points[i].z));
    const total = lengths.reduce((sum, l) => sum + l, 0);
    const reach = (PORTAL_DEPTH / 2) * portalDepthScale(PORTAL_MAX_SCALE);

    // The point `m` along the path, with the index of the segment it lies on
    const at = (m: number) => {
      let i = 0;
      while (i < lengths.length - 1 && m > lengths[i]) m -= lengths[i++];
      const f = lengths[i] > 0 ? Math.min(1, m / lengths[i]) : 0;
      return { x: points[i].x + (points[i + 1].x - points[i].x) * f, z: points[i].z + (points[i + 1].z - points[i].z) * f, i };
    };
    const straightFrom = (m: number) => {
      const a = at(m);
      const b = at(m + reach);
      const chord = Math.atan2(b.x - a.x, b.z - a.z);
      for (let i = a.i; i <= b.i; i++) {
        if (lengths[i] === 0) continue;
        const heading = Math.atan2(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
        if (Math.abs(Math.atan2(Math.sin(heading - chord), Math.cos(heading - chord))) > SPAWN_STRAIGHT_TURN) return false;
      }
      return true;
    };

    for (let m = 0; m <= SPAWN_MAX_SHIFT_M && m + reach <= total; m += SPAWN_SHIFT_STEP_M) {
      if (!straightFrom(m)) continue;
      if (m === 0) return candidate;
      const p = at(m);
      const moved = canonicalCoords({
        lat: candidate.lat + p.z / METERS_PER_DEGREE_LAT,
        lon: candidate.lon + p.x / (cosLat * METERS_PER_DEGREE_LAT),
      });
      if (this.routeAlongSegments(network, moved.lat, moved.lon, centerLat, centerLon).length < 2) return candidate;
      return {
        ...candidate,
        ...moved,
        distance: this.haversineDistance(centerLat, centerLon, moved.lat, moved.lon),
        nodeId: undefined,
      };
    }
    return candidate;
  }
}
