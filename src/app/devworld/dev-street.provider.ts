import {
  StreetNetworkProvider,
  StreetNetwork,
  StreetNode,
  Street,
  NearestStreetPoint,
  SpawnCandidate,
} from '../interfaces/street-network-provider.interface';
import { DevWorldService, DEV_WORLD_SIZE } from './devworld.service';
import { StreetSegment, SpawnPoint } from './generators/street-generator';

/**
 * Street type weights for A* pathfinding
 * Lower = preferred
 */
const STREET_TYPE_WEIGHTS: Record<string, number> = {
  primary: 1.0,
  secondary: 1.2,
  residential: 1.5,
};

/**
 * Graph node for A* pathfinding
 */
interface GraphNode {
  id: number;
  x: number;
  z: number;
  neighbors: { nodeId: number; weight: number }[];
}

/**
 * DevStreetProvider
 *
 * Implements StreetNetworkProvider for DevWorld using generated street network.
 * Features:
 * - Uses streets from StreetGenerator (via DevTerrainProvider)
 * - Converts street segments to graph with intersection detection
 * - A* pathfinding with street type weights
 * - Spawn candidate generation
 */
export class DevStreetProvider implements StreetNetworkProvider {
  private network: StreetNetwork | null = null;
  private graph = new Map<number, GraphNode>();
  private nodeIdCounter = 1;

  // Street data from generator
  private streetSegments: StreetSegment[] = [];
  private spawnPoints: SpawnPoint[] = [];

  constructor(private devWorld: DevWorldService) {}

  /**
   * Set generated streets and spawns.
   * Called by DevTerrainProvider after generation.
   */
  setGeneratedStreets(segments: StreetSegment[], spawns: SpawnPoint[]): void {
    this.streetSegments = segments;
    this.spawnPoints = spawns;
    this.network = null; // Clear cached network
    this.graph.clear();
    this.nodeIdCounter = 1;
  }

  async loadStreets(
    _centerLat: number,
    _centerLon: number,
    _radiusMeters?: number
  ): Promise<StreetNetwork> {
    // DevWorld ignores center coords - always returns the same network
    if (this.network) {
      return this.network;
    }

    const _startTime = performance.now();

    // Build network from generated segments
    this.network = this.buildNetwork();

    // Build graph for pathfinding
    this.buildGraph();


    return this.network;
  }

  private buildNetwork(): StreetNetwork {
    const streets: Street[] = [];
    const nodes = new Map<number, StreetNode>();
    const halfSize = DEV_WORLD_SIZE / 2;

    // Convert segments to streets with nodes
    for (const segment of this.streetSegments) {
      const streetNodes = this.segmentToNodes(segment);

      // Add nodes to global map
      for (const node of streetNodes) {
        nodes.set(node.id, node);
      }

      streets.push({
        id: streets.length + 1,
        name: segment.id,
        type: segment.type,
        nodes: streetNodes,
      });
    }

    // Bounds calculation - note coordinate convention: -X = East = +lon, +X = West = -lon
    const geoSouth = this.devWorld.localToGeo(0, -halfSize);
    const geoNorth = this.devWorld.localToGeo(0, halfSize);
    const geoWest = this.devWorld.localToGeo(halfSize, 0);   // +X = West = -lon
    const geoEast = this.devWorld.localToGeo(-halfSize, 0);  // -X = East = +lon

    return {
      streets,
      nodes,
      bounds: {
        minLat: geoSouth.lat,
        maxLat: geoNorth.lat,
        minLon: geoWest.lon,  // West has smaller longitude
        maxLon: geoEast.lon,  // East has larger longitude
      },
    };
  }

  private segmentToNodes(segment: StreetSegment): StreetNode[] {
    const [x1, z1] = segment.from;
    const [x2, z2] = segment.to;

    // Convert local coords to geo
    const geo1 = this.devWorld.localToGeo(x1, z1);
    const geo2 = this.devWorld.localToGeo(x2, z2);

    const startNode: StreetNode = {
      id: this.nodeIdCounter++,
      lat: geo1.lat,
      lon: geo1.lon,
    };

    const endNode: StreetNode = {
      id: this.nodeIdCounter++,
      lat: geo2.lat,
      lon: geo2.lon,
    };

    return [startNode, endNode];
  }

  private buildGraph(): void {
    this.graph.clear();

    // Step 1: Find all intersections between street segments
    const intersections: { x: number; z: number; streetIndices: number[] }[] = [];

    for (let i = 0; i < this.streetSegments.length; i++) {
      const seg1 = this.streetSegments[i];
      for (let j = i + 1; j < this.streetSegments.length; j++) {
        const seg2 = this.streetSegments[j];
        const intersection = this.segmentIntersection(
          seg1.from[0], seg1.from[1], seg1.to[0], seg1.to[1],
          seg2.from[0], seg2.from[1], seg2.to[0], seg2.to[1]
        );
        if (intersection) {
          intersections.push({
            x: intersection.x,
            z: intersection.z,
            streetIndices: [i, j],
          });
        }
      }
    }


    // Step 2: Create graph nodes for all endpoints AND intersections
    const nodePositions = new Map<string, number>(); // "x_z" -> nodeId

    // Add all segment endpoints
    for (const segment of this.streetSegments) {
      for (const [x, z] of [segment.from, segment.to]) {
        const key = `${Math.round(x)}_${Math.round(z)}`;
        if (!nodePositions.has(key)) {
          const id = this.nodeIdCounter++;
          nodePositions.set(key, id);
          this.graph.set(id, { id, x, z, neighbors: [] });
        }
      }
    }

    // Add all intersection points
    for (const intersection of intersections) {
      const key = `${Math.round(intersection.x)}_${Math.round(intersection.z)}`;
      if (!nodePositions.has(key)) {
        const id = this.nodeIdCounter++;
        nodePositions.set(key, id);
        this.graph.set(id, { id, x: intersection.x, z: intersection.z, neighbors: [] });
      }
    }

    // Step 3: Build edges for each street segment, splitting at intersections
    for (let segIdx = 0; segIdx < this.streetSegments.length; segIdx++) {
      const segment = this.streetSegments[segIdx];
      const weight = STREET_TYPE_WEIGHTS[segment.type] || 1.5;

      // Collect all points on this segment (endpoints + intersections)
      const points: { x: number; z: number; t: number }[] = [
        { x: segment.from[0], z: segment.from[1], t: 0 },
        { x: segment.to[0], z: segment.to[1], t: 1 },
      ];

      // Add intersections on this segment
      for (const intersection of intersections) {
        if (intersection.streetIndices.includes(segIdx)) {
          const t = this.parameterOnSegment(
            segment.from[0], segment.from[1],
            segment.to[0], segment.to[1],
            intersection.x, intersection.z
          );
          if (t > 0 && t < 1) {
            points.push({ x: intersection.x, z: intersection.z, t });
          }
        }
      }

      // Sort by parameter t
      points.sort((a, b) => a.t - b.t);

      // Add edges between consecutive points
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        const key1 = `${Math.round(p1.x)}_${Math.round(p1.z)}`;
        const key2 = `${Math.round(p2.x)}_${Math.round(p2.z)}`;

        const id1 = nodePositions.get(key1)!;
        const id2 = nodePositions.get(key2)!;

        if (id1 === id2) continue;

        const graphNode1 = this.graph.get(id1);
        const graphNode2 = this.graph.get(id2);

        if (graphNode1 && graphNode2) {
          // Add bidirectional edges
          if (!graphNode1.neighbors.some((n) => n.nodeId === id2)) {
            graphNode1.neighbors.push({ nodeId: id2, weight });
          }
          if (!graphNode2.neighbors.some((n) => n.nodeId === id1)) {
            graphNode2.neighbors.push({ nodeId: id1, weight });
          }
        }
      }
    }

    // Log graph stats
    let _totalEdges = 0;
    for (const node of this.graph.values()) {
      _totalEdges += node.neighbors.length;
    }
  }

  /**
   * Find intersection point of two line segments (if it exists)
   */
  private segmentIntersection(
    x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number, x4: number, y4: number
  ): { x: number; z: number } | null {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 0.0001) return null; // Parallel or coincident

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;

    // Check if intersection is within both segments (exclusive of endpoints to avoid duplicates)
    if (t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999) {
      return {
        x: x1 + t * (x2 - x1),
        z: y1 + t * (y2 - y1),
      };
    }

    return null;
  }

  /**
   * Get parameter t for point P on segment AB
   * Returns value in [0, 1] if P is on segment
   */
  private parameterOnSegment(ax: number, az: number, bx: number, bz: number, px: number, pz: number): number {
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    if (len2 < 0.0001) return 0;
    return ((px - ax) * dx + (pz - az) * dz) / len2;
  }

  findNearestStreetPoint(
    network: StreetNetwork,
    lat: number,
    lon: number
  ): NearestStreetPoint | null {
    let nearest: NearestStreetPoint | null = null;

    for (const street of network.streets) {
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

  findPath(
    _network: StreetNetwork,
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ): StreetNode[] {
    // Convert geo coords to local coords
    const startLocal = this.devWorld.geoToLocal(startLat, startLon);
    const endLocal = this.devWorld.geoToLocal(endLat, endLon);

    // Find closest graph nodes directly (not via street segments)
    let startId: number | null = null;
    let endId: number | null = null;
    let minStartDist = Infinity;
    let minEndDist = Infinity;

    for (const [id, node] of this.graph) {
      const startDist = Math.hypot(node.x - startLocal.x, node.z - startLocal.z);
      const endDist = Math.hypot(node.x - endLocal.x, node.z - endLocal.z);

      if (startDist < minStartDist) {
        minStartDist = startDist;
        startId = id;
      }
      if (endDist < minEndDist) {
        minEndDist = endDist;
        endId = id;
      }
    }

    if (startId === null || endId === null) {
      console.warn('[DevStreets] Could not find graph nodes for pathfinding');
      return [];
    }

    const _startNode = this.graph.get(startId)!;
    const _endNode = this.graph.get(endId)!;


    // A* pathfinding
    return this.astar(startId, endId);
  }

  private astar(startId: number, endId: number): StreetNode[] {
    if (startId === endId) {
      // Same node - return single point
      const node = this.graph.get(startId)!;
      const geo = this.devWorld.localToGeo(node.x, node.z);
      return [{ id: startId, lat: geo.lat, lon: geo.lon }];
    }

    if (!this.graph.has(startId) || !this.graph.has(endId)) {
      return [];
    }

    // A* algorithm
    const openSet = new Set<number>([startId]);
    const cameFrom = new Map<number, number>();
    const gScore = new Map<number, number>();
    const fScore = new Map<number, number>();

    gScore.set(startId, 0);
    fScore.set(startId, this.heuristic(startId, endId));

    while (openSet.size > 0) {
      // Get node with lowest fScore
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
      if (current === endId) {
        return this.reconstructPath(cameFrom, current);
      }

      openSet.delete(current);
      const currentNode = this.graph.get(current)!;

      for (const neighbor of currentNode.neighbors) {
        const distance = this.graphDistance(current, neighbor.nodeId);
        const tentativeG = (gScore.get(current) ?? Infinity) + distance * neighbor.weight;

        if (tentativeG < (gScore.get(neighbor.nodeId) ?? Infinity)) {
          cameFrom.set(neighbor.nodeId, current);
          gScore.set(neighbor.nodeId, tentativeG);
          fScore.set(neighbor.nodeId, tentativeG + this.heuristic(neighbor.nodeId, endId));
          openSet.add(neighbor.nodeId);
        }
      }
    }

    console.warn('[DevStreets] No path found');
    return [];
  }

  private heuristic(fromId: number, toId: number): number {
    const from = this.graph.get(fromId);
    const to = this.graph.get(toId);
    if (!from || !to) return Infinity;
    return Math.hypot(to.x - from.x, to.z - from.z);
  }

  private graphDistance(fromId: number, toId: number): number {
    return this.heuristic(fromId, toId);
  }

  private reconstructPath(cameFrom: Map<number, number>, current: number): StreetNode[] {
    const path: StreetNode[] = [];
    let nodeId: number | undefined = current;

    while (nodeId !== undefined) {
      const graphNode = this.graph.get(nodeId);
      if (graphNode) {
        const geo = this.devWorld.localToGeo(graphNode.x, graphNode.z);
        path.unshift({
          id: nodeId,
          lat: geo.lat,
          lon: geo.lon,
        });
      }
      nodeId = cameFrom.get(nodeId);
    }

    return path;
  }

  getSpawnCandidates(
    _network: StreetNetwork,
    _centerLat: number,
    _centerLon: number,
    minDistance: number,
    maxDistance: number,
    count = 5
  ): SpawnCandidate[] {
    const hqPosition = { x: 0, z: 0 }; // HQ is at origin

    // Return generated spawn points that are within distance range
    const candidates: SpawnCandidate[] = [];

    for (const spawn of this.spawnPoints) {
      const distance = Math.hypot(spawn.position.x - hqPosition.x, spawn.position.z - hqPosition.z);

      if (distance >= minDistance && distance <= maxDistance) {
        const geo = this.devWorld.localToGeo(spawn.position.x, spawn.position.z);
        candidates.push({
          lat: geo.lat,
          lon: geo.lon,
          distance,
          direction: spawn.name,
          streetName: `DevWorld ${spawn.name}`,
        });
      }
    }

    // If no candidates in range, return all spawn points
    if (candidates.length === 0) {
      for (const spawn of this.spawnPoints) {
        const distance = Math.hypot(spawn.position.x - hqPosition.x, spawn.position.z - hqPosition.z);
        const geo = this.devWorld.localToGeo(spawn.position.x, spawn.position.z);
        candidates.push({
          lat: geo.lat,
          lon: geo.lon,
          distance,
          direction: spawn.name,
          streetName: `DevWorld ${spawn.name}`,
        });
      }
    }

    return candidates.slice(0, count);
  }

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

  clearCache(): void {
    this.network = null;
    this.graph.clear();
    this.nodeIdCounter = 1;
  }
}
