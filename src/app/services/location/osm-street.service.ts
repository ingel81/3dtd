import { inject, Injectable, isDevMode } from '@angular/core';
import type { Street, StreetNetwork, StreetNode } from '../../interfaces/street-network-provider.interface';
import { RandomSpawnCandidate } from '../../models/location.types';
import { StreetCacheService } from './street-cache.service';
import { GeoBox, boxAreaKm2, boxAround, boxMinus, boxesOverlap, mergeStreets } from './street-box';
import { METERS_PER_DEGREE_LAT, canonicalCoords } from '../../utils/geo-utils';
import { SegmentRoutes, type RouteTail } from '../../utils/route-start';
import {
  DEFAULT_ROAD_WEIGHT,
  MinHeap,
  ROAD_TYPE_WEIGHTS,
  haversineDistance as sharedHaversineDistance,
  distanceToSegment as sharedDistanceToSegment,
} from '../../utils/street-astar';

export type { Street, StreetNetwork, StreetNode } from '../../interfaces/street-network-provider.interface';

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

/** An element of an Overpass answer, as far as the parsers read it. */
interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

/** An Overpass answer. */
interface OverpassResponse {
  elements: OverpassElement[];
  /** Set when the server ran into a limit (memory, time); the elements may be cut short then. */
  remark?: string;
}

/** One answer of one Overpass server and how long it took, see OsmStreetService.askOverpass. */
interface OverpassAnswer {
  data: OverpassResponse;
  /** Length of the JSON text, about its bytes unpacked. */
  chars: number;
  /** From the request to the headers, and from there to the end of the body. */
  headersMs: number;
  bodyMs: number;
}

/**
 * Time a server gets to start its answer (the headers) before the attempt
 * is aborted.
 */
const OVERPASS_HEADER_TIMEOUT_MS = 15000;

/**
 * Time a server gets from its headers to the end of its body before the
 * attempt is aborted, so a server that starts its answer and then hangs
 * hands over to the next instead of holding the load up for good. Generous
 * against a slow but valid answer: the query itself runs at most 25 s on
 * the server (`[timeout:25]`) before any of it is sent.
 */
const OVERPASS_BODY_TIMEOUT_MS = 30000;

/**
 * Time a server gets to start its answer before the next one is asked
 * alongside it (OsmStreetService.fetchOverpass). An assumption, not a
 * measurement: a server that has not begun to answer after 4 s is taken
 * to be queueing the query. `headers=` in the `[OSM]` log shows what the
 * servers take.
 */
const OVERPASS_HEDGE_MS = 4000;

/** `[OSM] <what> from <host>: ...` for an answer: where its time went and what came. */
function logOverpassAnswer(what: string, server: string, answer: OverpassAnswer): void {
  let ways = 0;
  let nodes = 0;
  for (const element of answer.data.elements) {
    if (element.type === 'way') ways++;
    else if (element.type === 'node') nodes++;
  }
  const remark = answer.data.remark ? ` remark="${answer.data.remark}"` : '';
  console.warn(
    `[OSM] ${what} from ${new URL(server).host}: headers=${answer.headersMs.toFixed(0)} body=${answer.bodyMs.toFixed(0)}ms ` +
    `size=${(answer.chars / 1e6).toFixed(1)}MB ways=${ways} nodes=${nodes}${remark}`,
  );
}

/** Highway types loadStreets asks for: the roads, and the paths enemies may take. */
const HIGHWAY_TYPES =
  'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|' +
  'unclassified|residential|living_street|service|pedestrian|footway|path|cycleway|track|steps';

/**
 * Overpass query for the streets that run through any of `boxes`: each way
 * once with its tags, then all of its nodes, inside the boxes or not.
 * `maxsize` caps the server's memory for the query at 4 MB; a query that
 * needs more ends with a `remark` in the answer (logOverpassAnswer).
 */
function streetQuery(boxes: readonly GeoBox[]): string {
  const ways = boxes
    .map((box) => `way["highway"~"^(${HIGHWAY_TYPES})$"](${box.minLat},${box.minLon},${box.maxLat},${box.maxLon});`)
    .join('\n        ');
  return `
      [out:json][timeout:25][maxsize:4194304];
      (
        ${ways}
      );
      out body;
      >;
      out skel qt;
    `;
}

type StreetTags = Pick<Street, 'width' | 'lanes' | 'bridge' | 'tunnel' | 'covered' | 'layer'>;

/**
 * Die Tags eines Ways, die später Korridorbreite und Höhenmodell brauchen.
 * Kommen mit `out body` ohnehin in der Overpass-Antwort mit. Nicht lesbare
 * Werte (`width=3'6"`, `lanes=2;3`) werden weggelassen statt geraten.
 * Exportiert für die Szenen auf den OSM-Fixtures (integration/fixtures/osm).
 */
export function parseStreetTags(tags: Record<string, string> | undefined): StreetTags {
  const result: StreetTags = {};
  if (!tags) return result;

  const width = /^\s*(\d+(?:[.,]\d+)?)\s*m?\s*$/.exec(tags['width'] ?? '');
  if (width) result.width = parseFloat(width[1].replace(',', '.'));
  if (/^\d+$/.test(tags['lanes'] ?? '')) result.lanes = parseInt(tags['lanes'], 10);
  if (/^-?\d+$/.test(tags['layer'] ?? '')) result.layer = parseInt(tags['layer'], 10);
  for (const key of ['bridge', 'tunnel', 'covered'] as const) {
    const value = tags[key];
    if (value && value !== 'no') result[key] = value;
  }
  return result;
}

@Injectable({
  providedIn: 'root',
})
export class OsmStreetService {
  // IndexedDB cache service (replaces localStorage)
  private readonly streetCache = inject(StreetCacheService);

  // Multiple Overpass API servers for fallback. All three sit in the EU: the
  // player's IP and the queried bounding box reach whichever one answers, and
  // the mirror that used to be third was run by Mail.ru in Russia.
  private readonly OVERPASS_SERVERS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
  ];

  // Cached graph for pathfinding (avoid rebuilding on every findPath call)
  // neighbors now include streetType for weighted pathfinding
  private cachedGraph: Map<number, { node: StreetNode; neighbors: { nodeId: number; streetType: string }[] }> | null = null;
  private cachedGraphNetworkId: string | null = null;

  /**
   * The streets loaded last, from Overpass or the IndexedDB cache. The next
   * load takes the ways of them that run through its box and asks Overpass
   * only for the rest (loadStreets). One network, in memory for the session.
   */
  private lastLoaded: StreetNetwork | null = null;

  /**
   * Load street network for a given bounding box around coordinates
   * Uses IndexedDB cache to avoid repeated API calls (supports larger data than localStorage)
   *
   * Where the box overlaps the streets loaded last (lastLoaded), their ways
   * through the box are taken over and Overpass is asked only for the rest
   * of it, in up to four strips (boxMinus): about half the box after the HQ
   * moved just past an edge of the loaded streets, three quarters past a
   * corner, nothing when they cover it. A way in both comes once.
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
      if (isDevMode()) console.log('[OSM] Loaded from IndexedDB cache');
      this.lastLoaded = cached;
      return cached;
    }

    const bounds = boxAround(centerLat, centerLon, radiusMeters);
    const loaded = this.lastLoaded && boxesOverlap(bounds, this.lastLoaded.bounds) ? this.lastLoaded : null;
    const missing = loaded ? boxMinus(bounds, loaded.bounds) : [bounds];
    if (loaded) {
      const fetchKm2 = missing.reduce((sum, box) => sum + boxAreaKm2(box), 0);
      const totalKm2 = boxAreaKm2(bounds);
      console.warn(
        `[OSM] streets: ${(totalKm2 - fetchKm2).toFixed(1)} of ${totalKm2.toFixed(1)}km² from the streets loaded before, ` +
        `fetching ${fetchKm2.toFixed(1)}km² in ${missing.length} boxes`,
      );
    }
    const noStreets = () => new Error('No streets found in this area. Choose a different location.');

    let network: StreetNetwork;
    if (loaded && missing.length === 0) {
      network = mergeStreets(loaded, null, bounds);
      if (network.streets.length === 0) throw noStreets();
    } else {
      try {
        // An answer without streets hands over to the next server as well.
        network = await this.fetchOverpass('streets', streetQuery(missing), (data) => {
          const fetched = this.parseOverpassResponse(data, bounds);
          const streets = loaded ? mergeStreets(loaded, fetched, bounds) : fetched;
          if (streets.streets.length === 0) throw noStreets();
          return streets;
        });
      } catch (error) {
        console.error('[OSM] All Overpass servers failed');
        // Provide user-friendly error message
        const userMessage = 'OSM server unreachable. Check your internet connection.';
        throw error instanceof Error && error.message.includes('No streets')
          ? error
          : new Error(userMessage);
      }
    }

    this.lastLoaded = network;
    // Cache the result to IndexedDB (async, fire-and-forget)
    this.streetCache.save(cacheKey, network).catch((err) => {
      console.warn('[OSM] Failed to cache to IndexedDB:', err);
    });

    return network;
  }

  /**
   * Post `query` to the Overpass servers and return what `accept` makes of
   * the first answer it takes. The servers are asked in order. One that
   * fails, does not start its answer within OVERPASS_HEADER_TIMEOUT_MS, does
   * not finish it within OVERPASS_BODY_TIMEOUT_MS after that or whose answer
   * `accept` throws on hands over to the next at once. One
   * that has not started its answer after OVERPASS_HEDGE_MS gets the next
   * asked alongside it, so a server that waits out its 15 s no longer holds
   * the others back that long; the first answer taken aborts the rest.
   * Every attempt is logged: an answer with the time to its headers and on
   * to the end of its body, its size and what came (logOverpassAnswer), a
   * failure with its time and reason. So a slow load shows whether a server
   * was slow to start or its answer was long. Rejects with the last error
   * when none answered.
   *
   * @param what What is loaded, for the log
   */
  private fetchOverpass<T>(what: string, query: string, accept: (data: OverpassResponse) => T): Promise<T> {
    const servers = this.OVERPASS_SERVERS;
    return new Promise<T>((resolve, reject) => {
      const controllers: AbortController[] = [];
      let asked = 0;
      let failed = 0;
      let done = false;

      const askNext = (): void => {
        if (done || asked >= servers.length) return;
        const server = servers[asked++];
        const controller = new AbortController();
        controllers.push(controller);
        const start = performance.now();
        const hedge = setTimeout(askNext, OVERPASS_HEDGE_MS);
        const attempt = async (): Promise<T> => {
          const answer = await this.askOverpass(server, query, controller, () => clearTimeout(hedge));
          logOverpassAnswer(what, server, answer);
          return accept(answer.data);
        };
        attempt().then(
          (result) => {
            if (done) return;
            done = true;
            for (const other of controllers) if (other !== controller) other.abort();
            resolve(result);
          },
          (error: unknown) => {
            clearTimeout(hedge);
            // A server aborted because another answered first.
            if (done) return;
            const reason = error instanceof Error ? error : new Error(String(error));
            console.warn(
              `[OSM] ${what} from ${new URL(server).host} failed after ${(performance.now() - start).toFixed(0)}ms: ${reason.message}`,
            );
            failed++;
            if (asked < servers.length) {
              askNext();
            } else if (failed === asked) {
              done = true;
              reject(reason);
            }
          },
        );
      };
      askNext();
    });
  }

  /**
   * Post `query` to one Overpass server and read its answer. Aborted
   * through `controller`, and by itself when the headers take longer than
   * OVERPASS_HEADER_TIMEOUT_MS or the body after them longer than
   * OVERPASS_BODY_TIMEOUT_MS; `onHeaders` is called when the headers are
   * there.
   */
  private async askOverpass(
    server: string,
    query: string,
    controller: AbortController,
    onHeaders: () => void,
  ): Promise<OverpassAnswer> {
    const start = performance.now();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, OVERPASS_HEADER_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(server, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
    } catch (error) {
      throw timedOut ? new Error(`no answer within ${OVERPASS_HEADER_TIMEOUT_MS}ms`) : error;
    } finally {
      clearTimeout(timeoutId);
    }

    onHeaders();
    const headersAt = performance.now();
    if (!response.ok) {
      throw new Error(`OSM API error: ${response.status}`);
    }
    const bodyTimeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, OVERPASS_BODY_TIMEOUT_MS);
    let text: string;
    try {
      text = await response.text();
    } catch (error) {
      throw timedOut ? new Error(`answer not complete within ${OVERPASS_BODY_TIMEOUT_MS}ms`) : error;
    } finally {
      clearTimeout(bodyTimeoutId);
    }
    return {
      data: JSON.parse(text) as OverpassResponse,
      chars: text.length,
      headersMs: headersAt - start,
      bodyMs: performance.now() - headersAt,
    };
  }

  private parseOverpassResponse(
    data: { elements: OverpassElement[] },
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
            name: element.tags?.['name'] || 'Unnamed Street',
            type: element.tags?.['highway'] || 'unknown',
            nodes: streetNodes,
            ...parseStreetTags(element.tags),
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
    return sharedDistanceToSegment(pLat, pLon, aLat, aLon, bLat, bLon);
  }

  /**
   * Path along the streets from start to end, A* on the street network. It
   * starts at the foot of the start on its nearest segment (SegmentRoutes)
   * and ends on the first node of the segment nearest to the end, from
   * where PathAndRouteService leads it to the HQ (leavePathForBase).
   */
  findPath(
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
    const endPoint = this.findNearestStreetPoint(network, endLat, endLon);
    if (!endPoint) return null;

    // Get or build adjacency graph (cached for performance)
    const graph = this.getOrBuildGraph(network);
    const end = endPoint.street.nodes[endPoint.nodeIndex];
    return new SegmentRoutes(
      start.street.nodes[start.nodeIndex],
      start.street.nodes[start.nodeIndex + 1],
      ROAD_TYPE_WEIGHTS[start.street.type] ?? DEFAULT_ROAD_WEIGHT,
      (node) => this.astar(graph, node, end, endLat, endLon),
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

    if (isDevMode()) console.log(`[OSM] Filtered: ${network.streets.length} → ${filteredStreets.length} streets, ${network.nodes.size} → ${filteredNodes.size} nodes`);

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

  private astar(
    graph: Map<number, { node: StreetNode; neighbors: { nodeId: number; streetType: string }[] }>,
    start: StreetNode,
    end: StreetNode,
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

      if (current === end.id) {
        // Reconstruct path
        const path: StreetNode[] = [];
        let curr: number | undefined = current;

        while (curr !== undefined) {
          const entry = graph.get(curr);
          if (entry) path.unshift(entry.node);
          curr = cameFrom.get(curr);
        }

        return { path, cost: gScore.get(current)! };
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
   * Load building footprints for a given bounding box around coordinates
   */
  async loadBuildings(
    centerLat: number,
    centerLon: number,
    radiusMeters = 500
  ): Promise<BuildingData> {
    const bounds = boxAround(centerLat, centerLon, radiusMeters);

    const query = `
      [out:json][timeout:25][maxsize:4194304];
      (
        way["building"](${bounds.minLat},${bounds.minLon},${bounds.maxLat},${bounds.maxLon});
      );
      out body;
      >;
      out skel qt;
    `;

    let buildings: BuildingFootprint[];
    try {
      buildings = await this.fetchOverpass('buildings', query, (data) => this.parseBuildingResponse(data));
    } catch (error) {
      console.error('[OSM] All Overpass servers failed for buildings');
      throw error instanceof Error ? error : new Error('Failed to load buildings');
    }

    if (isDevMode()) console.log(`[OSM] Loaded ${buildings.length} building footprints`);
    return { buildings };
  }

  private parseBuildingResponse(
    data: { elements: OverpassElement[] }
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

    if (isDevMode()) console.log(`[OSM] Filtered buildings: ${buildings.length} → ${filtered.length}`);
    return filtered;
  }

  /**
   * Clear cache for specific coordinates or all street caches (IndexedDB)
   */
  async clearCache(centerLat?: number, centerLon?: number, radiusMeters?: number): Promise<void> {
    // The next load asks Overpass for all of its box again.
    this.lastLoaded = null;
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
        const { lat, lon } = canonicalCoords(node);
        const distance = this.haversineDistance(centerLat, centerLon, lat, lon);
        if (distance >= minDistance && distance <= maxDistance) {
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
