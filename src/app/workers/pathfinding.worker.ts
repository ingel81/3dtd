/**
 * Pathfinding Web Worker
 *
 * Offloads A* pathfinding computation to a background thread.
 * The main thread sends the serialized street network once, then
 * requests paths via postMessage.
 *
 * ═══════════════════════════════════════════════════════════════
 * PROTOCOL:
 *
 *   Main → Worker:
 *     { type: 'init', network: SerializedStreetNetwork }
 *       Initialize with street network data. Must be called before findPath.
 *
 *     { type: 'findPath', id: string, startLat, startLon, endLat, endLon }
 *       Request a path. Returns result with matching id.
 *
 *     { type: 'clearGraph' }
 *       Clear cached graph (e.g. on location change).
 *
 *   Worker → Main:
 *     { type: 'initDone' }
 *       Network loaded and graph built.
 *
 *     { type: 'pathResult', id: string, path: StreetNode[] }
 *       Path result (may be empty if no path found).
 *
 *     { type: 'error', id?: string, message: string }
 *       Error response.
 *
 * ═══════════════════════════════════════════════════════════════
 * WEB WORKER OFFLOADING ANALYSIS
 *
 * This worker handles pathfinding (A*). Below is an analysis of
 * other game systems that could benefit from Web Worker offloading:
 *
 * 1. COLLISION / SPATIAL GRID QUERIES (GlobalRouteGrid)
 *    - Current: O(cells_in_radius) per tower per frame for targeting
 *    - Benefit: MEDIUM. The spatial grid is already well-optimized with
 *      cell-based lookups. The bottleneck is LOS raycasting (which needs
 *      Three.js scene access → not transferable to workers).
 *    - Verdict: NOT recommended. Data transfer overhead (enemy positions
 *      every frame) would likely exceed computation savings. The grid
 *      queries are O(1) per cell and very fast.
 *
 * 2. WAVE DIRECTOR INFERENCE
 *    - Current: Runs once per wave to decide composition/difficulty
 *    - Benefit: LOW. Wave planning is infrequent (every 15-30s) and
 *      computation is lightweight (no heavy iteration).
 *    - Verdict: NOT recommended. Negligible performance impact.
 *
 * 3. AUDIO BUFFER DECODING
 *    - Current: AudioContext.decodeAudioData() is already async
 *    - Benefit: LOW-MEDIUM. The Web Audio API handles decoding off
 *      the main thread internally via its async API.
 *    - Verdict: NOT needed. Already handled by browser internals.
 *      If custom DSP processing were added (e.g., procedural audio),
 *      an AudioWorklet (not Web Worker) would be the right tool.
 *
 * 4. PATHFINDING (this worker) ✅
 *    - Current: A* on potentially large OSM graphs (1000+ nodes)
 *    - Benefit: HIGH. Graph building and A* search can block the main
 *      thread for 10-50ms on complex street networks. Multiple paths
 *      computed on game start (one per spawn point).
 *    - Verdict: RECOMMENDED → implemented here.
 *
 * 5. FUTURE CANDIDATES:
 *    - Procedural terrain generation (DevWorld heightmap): Could benefit
 *      from worker if generation becomes more complex (noise octaves).
 *    - Street network filtering (filterStreetsNearRoutes): O(streets × routePoints),
 *      could be slow in dense cities. Worth offloading if it becomes a bottleneck.
 *    - Enemy movement batch updates: If enemy count exceeds ~500, batching
 *      position interpolation in a worker with SharedArrayBuffer could help.
 *
 * ═══════════════════════════════════════════════════════════════
 */

/// <reference lib="webworker" />

import { SegmentRoutes, type RouteTail } from '../utils/route-start';
import { MinHeap, haversineDistance, distanceToSegment } from '../utils/street-astar';

// ========================================
// TYPES (duplicated to avoid import issues in worker context)
// ========================================

interface StreetNode {
  id: number;
  lat: number;
  lon: number;
}

interface Street {
  id: number;
  name: string;
  type: string;
  nodes: StreetNode[];
}

/**
 * Serializable version of StreetNetwork.
 * Map<number, StreetNode> is converted to [number, StreetNode][] for transfer.
 */
export interface SerializedStreetNetwork {
  streets: Street[];
  nodes: [number, StreetNode][];
  bounds: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
}

// Worker message types
export interface InitMessage {
  type: 'init';
  network: SerializedStreetNetwork;
}

export interface FindPathMessage {
  type: 'findPath';
  id: string;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
}

export interface ClearGraphMessage {
  type: 'clearGraph';
}

export type WorkerInMessage = InitMessage | FindPathMessage | ClearGraphMessage;

export interface InitDoneResponse {
  type: 'initDone';
}

export interface PathResultResponse {
  type: 'pathResult';
  id: string;
  path: StreetNode[];
}

export interface ErrorResponse {
  type: 'error';
  id?: string;
  message: string;
}

export type WorkerOutMessage = InitDoneResponse | PathResultResponse | ErrorResponse;

// ========================================
// ROAD TYPE WEIGHTS (same as OsmStreetService)
// ========================================

const ROAD_TYPE_WEIGHTS: Record<string, number> = {
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
  residential: 1.0,
  living_street: 1.1,
  unclassified: 1.0,
  service: 1.2,
  pedestrian: 2.5,
  cycleway: 2.0,
  footway: 3.0,
  path: 3.0,
  track: 2.5,
  steps: 5.0,
};

const DEFAULT_ROAD_WEIGHT = 1.5;

// ========================================
// PATHFINDING ENGINE (runs in worker)
// ========================================

interface GraphEntry {
  node: StreetNode;
  neighbors: { nodeId: number; streetType: string }[];
}

let graph: Map<number, GraphEntry> | null = null;
let _networkNodes: Map<number, StreetNode> | null = null;
let streets: Street[] = [];

function buildGraph(networkStreets: Street[]): Map<number, GraphEntry> {
  const g = new Map<number, GraphEntry>();

  for (const street of networkStreets) {
    const streetType = street.type;

    for (let i = 0; i < street.nodes.length; i++) {
      const node = street.nodes[i];

      if (!g.has(node.id)) {
        g.set(node.id, { node, neighbors: [] });
      }

      const entry = g.get(node.id)!;

      if (i > 0) {
        const prevNode = street.nodes[i - 1];
        if (!entry.neighbors.some(n => n.nodeId === prevNode.id)) {
          entry.neighbors.push({ nodeId: prevNode.id, streetType });
        }
      }

      if (i < street.nodes.length - 1) {
        const nextNode = street.nodes[i + 1];
        if (!entry.neighbors.some(n => n.nodeId === nextNode.id)) {
          entry.neighbors.push({ nodeId: nextNode.id, streetType });
        }
      }
    }
  }

  return g;
}

function findNearestStreetPoint(
  lat: number,
  lon: number
): { street: Street; nodeIndex: number; distance: number } | null {
  let nearest: { street: Street; nodeIndex: number; distance: number } | null = null;

  for (const street of streets) {
    for (let i = 0; i < street.nodes.length - 1; i++) {
      const node1 = street.nodes[i];
      const node2 = street.nodes[i + 1];
      const dist = distanceToSegment(lat, lon, node1.lat, node1.lon, node2.lat, node2.lon);

      if (!nearest || dist < nearest.distance) {
        nearest = { street, nodeIndex: i, distance: dist };
      }
    }
  }

  return nearest;
}

function astar(
  g: Map<number, GraphEntry>,
  start: StreetNode,
  end: StreetNode,
  endLat: number,
  endLon: number
): RouteTail | null {
  const openHeap = new MinHeap<number>();
  const openSetTracker = new Set<number>([start.id]);
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>();

  const startF = haversineDistance(start.lat, start.lon, endLat, endLon);
  gScore.set(start.id, 0);
  openHeap.push(start.id, startF);

  while (openHeap.size > 0) {
    const current = openHeap.pop()!;

    if (!openSetTracker.has(current)) continue;

    if (current === end.id) {
      const path: StreetNode[] = [];
      let curr: number | undefined = current;
      while (curr !== undefined) {
        const entry = g.get(curr);
        if (entry) path.unshift(entry.node);
        curr = cameFrom.get(curr);
      }
      return { path, cost: gScore.get(current)! };
    }

    openSetTracker.delete(current);
    const currentEntry = g.get(current);
    if (!currentEntry) continue;

    for (const neighbor of currentEntry.neighbors) {
      const neighborEntry = g.get(neighbor.nodeId);
      if (!neighborEntry) continue;

      const distance = haversineDistance(
        currentEntry.node.lat, currentEntry.node.lon,
        neighborEntry.node.lat, neighborEntry.node.lon
      );
      const weight = ROAD_TYPE_WEIGHTS[neighbor.streetType] ?? DEFAULT_ROAD_WEIGHT;
      const weightedDistance = distance * weight;

      const tentativeG = (gScore.get(current) ?? Infinity) + weightedDistance;

      if (tentativeG < (gScore.get(neighbor.nodeId) ?? Infinity)) {
        cameFrom.set(neighbor.nodeId, current);
        gScore.set(neighbor.nodeId, tentativeG);
        const neighborF = tentativeG + haversineDistance(
          neighborEntry.node.lat, neighborEntry.node.lon, endLat, endLon
        );
        openHeap.push(neighbor.nodeId, neighborF);
        openSetTracker.add(neighbor.nodeId);
      }
    }
  }

  return null;
}

function findPath(
  startLat: number, startLon: number,
  endLat: number, endLon: number
): StreetNode[] {
  if (!graph || streets.length === 0) {
    return [];
  }

  const startPoint = findNearestStreetPoint(startLat, startLon);
  const endPoint = findNearestStreetPoint(endLat, endLon);

  if (!startPoint || !endPoint) {
    return [];
  }

  // From the foot of the start on its segment, as OsmStreetService.findPath
  const g = graph;
  const end = endPoint.street.nodes[endPoint.nodeIndex];
  return new SegmentRoutes(
    startPoint.street.nodes[startPoint.nodeIndex],
    startPoint.street.nodes[startPoint.nodeIndex + 1],
    ROAD_TYPE_WEIGHTS[startPoint.street.type] ?? DEFAULT_ROAD_WEIGHT,
    (node) => astar(g, node, end, endLat, endLon),
  ).routeFrom(startLat, startLon);
}

// ========================================
// MESSAGE HANDLER
// ========================================

addEventListener('message', (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init': {
      try {
        // Deserialize network
        _networkNodes = new Map(msg.network.nodes);
        streets = msg.network.streets;

        // Build graph
        graph = buildGraph(streets);

        const response: InitDoneResponse = { type: 'initDone' };
        postMessage(response);
      } catch (e) {
        const response: ErrorResponse = {
          type: 'error',
          message: `Init failed: ${e instanceof Error ? e.message : String(e)}`,
        };
        postMessage(response);
      }
      break;
    }

    case 'findPath': {
      try {
        const path = findPath(msg.startLat, msg.startLon, msg.endLat, msg.endLon);
        const response: PathResultResponse = {
          type: 'pathResult',
          id: msg.id,
          path,
        };
        postMessage(response);
      } catch (e) {
        const response: ErrorResponse = {
          type: 'error',
          id: msg.id,
          message: `findPath failed: ${e instanceof Error ? e.message : String(e)}`,
        };
        postMessage(response);
      }
      break;
    }

    case 'clearGraph': {
      graph = null;
      _networkNodes = null;
      streets = [];
      break;
    }
  }
});
