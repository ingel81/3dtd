import { inject, Injectable, isDevMode } from '@angular/core';
import { UNNAMED_STREET, type Street, type StreetNetwork, type StreetNode } from '../../interfaces/street-network-provider.interface';
import { StreetCacheService } from './street-cache.service';
import { GeoBox, boxAreaKm2, boxAround, boxMinus, boxesOverlap, mergeStreets } from './street-box';
import { METERS_PER_DEGREE_LAT } from '../../utils/geo-utils';
import { StreetRouter } from './street-router';
import { spawnLabel } from '../../utils/spawn-label';
import type { WorldStreetSource } from '../../world/world-provider';
import { OVERPASS_SERVERS, fetchOverpass, type OverpassElement, type OverpassResponse } from '../../world/osm/overpass-client';

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

/** Radius of the street box around the HQ, m: the one every place of the game loads its streets with */
export const STREET_RADIUS_M = 2000;

/** Streets fetched for a load, with the cache key to save them under (null: they came from the cache) */
interface LoadedStreets {
  network: StreetNetwork;
  cacheKey: string | null;
}

/** The arguments of a street load, for matching a prefetched load (OsmStreetService.prefetchStreets) */
function streetLoadKey(lat: number, lon: number, radiusMeters: number): string {
  return `${lat}|${lon}|${radiusMeters}`;
}

/** Highway types loadStreets asks for: the roads, and the paths enemies may take. */
const HIGHWAY_TYPES =
  'motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|' +
  'unclassified|residential|living_street|service|pedestrian|footway|path|cycleway|track|steps';

/**
 * Overpass query for the streets that run through any of `boxes`: each way
 * once with its tags, then all of its nodes, inside the boxes or not.
 * `maxsize` caps the server's memory for the query at 4 MB; a query that
 * needs more ends with a `remark` in the answer (logged by overpass-client.ts).
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

/**
 * How far a thinned route may stray from the real one, m. Small against the
 * building corridor, so the `around` query keeps what the route touches.
 */
const ROUTE_QUERY_TOLERANCE_M = 5;

/**
 * `route` with the points dropped that lie within `toleranceM` of the line
 * through their neighbours (Douglas-Peucker, flat metres around the first point).
 */
export function thinRoute<P extends { lat: number; lon: number }>(route: readonly P[], toleranceM: number): P[] {
  if (route.length <= 2) return [...route];
  const cosLat = Math.cos((route[0].lat * Math.PI) / 180);
  const xs = route.map((p) => (p.lon - route[0].lon) * cosLat * METERS_PER_DEGREE_LAT);
  const zs = route.map((p) => (p.lat - route[0].lat) * METERS_PER_DEGREE_LAT);
  const keep = new Uint8Array(route.length);
  keep[0] = keep[route.length - 1] = 1;
  const stack: [number, number][] = [[0, route.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const dx = xs[last] - xs[first];
    const dz = zs[last] - zs[first];
    const lengthSq = dx * dx + dz * dz;
    let worst = -1;
    let worstDist = toleranceM;
    for (let i = first + 1; i < last; i++) {
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((xs[i] - xs[first]) * dx + (zs[i] - zs[first]) * dz) / lengthSq)) : 0;
      const dist = Math.hypot(xs[i] - xs[first] - t * dx, zs[i] - zs[first] - t * dz);
      if (dist > worstDist) {
        worst = i;
        worstDist = dist;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return route.filter((_, i) => keep[i] === 1);
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
export class OsmStreetService extends StreetRouter implements WorldStreetSource {
  // IndexedDB cache service (replaces localStorage)
  private readonly streetCache = inject(StreetCacheService);

  // Overpass servers, asked in this order (overpass-client.ts)
  private readonly OVERPASS_SERVERS = [...OVERPASS_SERVERS];

  /**
   * The streets loaded last, from Overpass or the IndexedDB cache. The next
   * load takes the ways of them that run through its box and asks Overpass
   * only for the rest (loadStreets). One network, in memory for the session.
   */
  private lastLoaded: StreetNetwork | null = null;

  /**
   * A load prefetchStreets() began before its caller asked, with the
   * arguments it was begun for; the loadStreets() call with the same
   * arguments takes it (TODO H13). It leaves no trace (lastLoaded, the
   * IndexedDB cache) until then, so a load nobody takes changes no later
   * query. `after` is the lastLoaded it began from: once another load kept
   * its streets, the query would differ, and the prefetch is not taken.
   */
  private prefetched: { key: string; after: StreetNetwork | null; promise: Promise<LoadedStreets> } | null = null;

  /**
   * Begin loadStreets(`centerLat`, `centerLon`, `radiusMeters`) now, while
   * other things load (the tiles), so that the loadStreets() call with the
   * same arguments later takes this load instead of starting one: the same
   * box, the same query, the same network, only earlier (TODO H13). A later
   * call with other arguments loads on its own. A failure reaches the caller
   * that takes the load.
   */
  prefetchStreets(centerLat: number, centerLon: number, radiusMeters: number): void {
    const key = streetLoadKey(centerLat, centerLon, radiusMeters);
    if (this.prefetched?.key === key && this.prefetched.after === this.lastLoaded) return;
    const promise = this.fetchStreets(centerLat, centerLon, radiusMeters);
    // Nobody may take it (the place changed again); its error must not go unhandled
    promise.catch(() => undefined);
    this.prefetched = { key, after: this.lastLoaded, promise };
  }

  /**
   * Load street network for a given bounding box around coordinates
   * Uses IndexedDB cache to avoid repeated API calls (supports larger data than localStorage)
   *
   * Where the box overlaps the streets loaded last (lastLoaded), their ways
   * through the box are taken over and Overpass is asked only for the rest
   * of it, in up to four strips (boxMinus): about half the box after the HQ
   * moved just past an edge of the loaded streets, three quarters past a
   * corner, nothing when they cover it. A way in both comes once.
   *
   * A load prefetchStreets() began for the same arguments is taken as it is.
   */
  loadStreets(
    centerLat: number,
    centerLon: number,
    radiusMeters = 500
  ): Promise<StreetNetwork> {
    const prefetched = this.prefetched;
    this.prefetched = null;
    const taken = prefetched?.key === streetLoadKey(centerLat, centerLon, radiusMeters)
      && prefetched.after === this.lastLoaded;
    const loading = taken
      ? prefetched.promise
      : this.fetchStreets(centerLat, centerLon, radiusMeters);
    return loading.then((loaded) => this.keepStreets(loaded));
  }

  /**
   * The streets for loadStreets(), from the IndexedDB cache or Overpass,
   * without keeping them: keepStreets() does that for the load a caller takes.
   */
  private async fetchStreets(
    centerLat: number,
    centerLon: number,
    radiusMeters: number,
  ): Promise<LoadedStreets> {
    // Try to load from IndexedDB cache first
    const cacheKey = this.streetCache.getCacheKey(centerLat, centerLon, radiusMeters);
    const cached = await this.streetCache.load(cacheKey);
    if (cached) {
      if (isDevMode()) console.log('[OSM] Loaded from IndexedDB cache');
      return { network: cached, cacheKey: null };
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

    return { network, cacheKey };
  }

  /** Keep the streets a caller took: the next load starts from them, and the cache holds them */
  private keepStreets({ network, cacheKey }: LoadedStreets): StreetNetwork {
    this.lastLoaded = network;
    if (cacheKey !== null) {
      // Cache the result to IndexedDB (async, fire-and-forget)
      this.streetCache.save(cacheKey, network).catch((err) => {
        console.warn('[OSM] Failed to cache to IndexedDB:', err);
      });
    }
    return network;
  }

  /** The Overpass client (overpass-client.ts) on this service's servers, with the street loads' limits */
  private fetchOverpass<T>(what: string, query: string, accept: (data: OverpassResponse) => T): Promise<T> {
    return fetchOverpass({ what, query, accept: (data) => accept(data), servers: this.OVERPASS_SERVERS });
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
            name: element.tags?.['name'] || UNNAMED_STREET,
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
   * Load the building footprints within `radiusMeters` of the routes, and
   * no others: one Overpass `around` filter per route, on the route thinned
   * by ROUTE_QUERY_TOLERANCE_M.
   */
  async loadBuildingsNearRoutes(
    routes: readonly (readonly { lat: number; lon: number }[])[],
    radiusMeters: number
  ): Promise<BuildingData> {
    const lines = routes
      .map((route) => thinRoute(route, ROUTE_QUERY_TOLERANCE_M))
      .filter((line) => line.length > 0)
      .map((line) => line.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(','));
    if (lines.length === 0) return { buildings: [] };

    const ways = lines
      .map((line) => `way["building"](around:${Math.round(radiusMeters)},${line});`)
      .join('\n        ');
    const query = `
      [out:json][timeout:25][maxsize:4194304];
      (
        ${ways}
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

    if (isDevMode()) console.log(`[OSM] Loaded ${buildings.length} building footprints near ${lines.length} routes`);
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
   * Clear cache for specific coordinates or all street caches (IndexedDB)
   */
  /**
   * On a real map every spawn is named after its street (spawnLabel),
   * whichever way it came about, so a reload and a location change show
   * the same label; `name` does not count.
   */
  spawnLabel(network: StreetNetwork, lat: number, lon: number): string {
    return spawnLabel(network, lat, lon);
  }

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

}
