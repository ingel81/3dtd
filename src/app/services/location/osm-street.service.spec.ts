import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OsmStreetService, BuildingFootprint, StreetNetwork } from './osm-street.service';
import { boxAround } from './street-box';
import { ROUTE_START_NODE_ID } from '../../utils/route-start';
import { extendPathToOptimalTurnoff, leavePathForBase } from '../../utils/route-geometry';

// Mock Angular DI — OsmStreetService uses inject(StreetCacheService)
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<typeof import('@angular/core')>('@angular/core');
  return {
    ...actual,
    inject: vi.fn(() => ({
      getCacheKey: vi.fn(() => 'mock-key'),
      load: vi.fn(async () => null),
      save: vi.fn(async () => { /* noop */ }),
      clear: vi.fn(async () => { /* noop */ }),
      clearAll: vi.fn(async () => { /* noop */ }),
    })),
  };
});

describe('OsmStreetService', () => {
  let service: OsmStreetService;

  beforeEach(() => {
    service = new OsmStreetService();
  });

  // ════════════════════════════════════════════════════════════
  // parseBuildingResponse (private — accessed via 'as any')
  // ════════════════════════════════════════════════════════════

  describe('parseBuildingResponse', () => {
    const parse = (elements: unknown[]) =>
      (service as unknown as { parseBuildingResponse: (r: { elements: unknown[] }) => BuildingFootprint[] })
        .parseBuildingResponse({ elements });

    it('parses nodes and ways into building footprints', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        { type: 'node', id: 3, lat: 48.001, lon: 9.001 },
        {
          type: 'way', id: 100, nodes: [1, 2, 3],
          tags: { building: 'residential', 'building:levels': '3' },
        },
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(100);
      expect(result[0].type).toBe('residential');
      expect(result[0].levels).toBe(3);
      expect(result[0].nodes).toHaveLength(3);
      expect(result[0].nodes[0].lat).toBe(48.0);
    });

    it('defaults to type "yes" and 2 levels when tags missing', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        { type: 'node', id: 3, lat: 48.001, lon: 9.001 },
        { type: 'way', id: 200, nodes: [1, 2, 3], tags: {} },
      ]);

      expect(result[0].type).toBe('yes');
      expect(result[0].levels).toBe(2);
    });

    it('clamps levels to minimum 1', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        { type: 'node', id: 3, lat: 48.001, lon: 9.001 },
        { type: 'way', id: 300, nodes: [1, 2, 3], tags: { building: 'yes', 'building:levels': '0' } },
      ]);

      expect(result[0].levels).toBe(1);
    });

    it('rounds fractional levels', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        { type: 'node', id: 3, lat: 48.001, lon: 9.001 },
        { type: 'way', id: 400, nodes: [1, 2, 3], tags: { building: 'yes', 'building:levels': '2.7' } },
      ]);

      expect(result[0].levels).toBe(3);
    });

    it('skips ways with fewer than 3 resolved nodes', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        { type: 'way', id: 500, nodes: [1, 2], tags: { building: 'yes' } },
      ]);

      expect(result).toHaveLength(0);
    });

    it('skips nodes referenced by way but not in response', () => {
      const result: BuildingFootprint[] = parse([
        { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
        { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
        // node 3 missing
        { type: 'way', id: 600, nodes: [1, 2, 3], tags: { building: 'yes' } },
      ]);

      // Only 2 resolved nodes → skipped
      expect(result).toHaveLength(0);
    });

    it('returns empty array for empty response', () => {
      expect(parse([])).toHaveLength(0);
    });
  });

  // ════════════════════════════════════════════════════════════
  // parseOverpassResponse (private, accessed via cast)
  // ════════════════════════════════════════════════════════════

  describe('parseOverpassResponse', () => {
    const bounds = { minLat: 48.0, maxLat: 48.001, minLon: 9.0, maxLon: 9.0 };
    const parse = (tags: Record<string, string>) =>
      (service as unknown as {
        parseOverpassResponse: (r: { elements: unknown[] }, b: typeof bounds) => StreetNetwork;
      }).parseOverpassResponse({
        elements: [
          { type: 'node', id: 1, lat: 48.0, lon: 9.0 },
          { type: 'node', id: 2, lat: 48.001, lon: 9.0 },
          { type: 'way', id: 100, nodes: [1, 2], tags },
        ],
      }, bounds).streets[0];

    it('keeps width, lanes, layer and the bridge/tunnel/covered tags', () => {
      const street = parse({
        highway: 'footway', name: 'Durchgang', width: '2.5 m', lanes: '1',
        layer: '-1', tunnel: 'building_passage', covered: 'yes', bridge: 'no',
      });
      expect(street).toMatchObject({
        type: 'footway', name: 'Durchgang', width: 2.5, lanes: 1,
        layer: -1, tunnel: 'building_passage', covered: 'yes',
      });
      expect(street.bridge).toBeUndefined();
    });

    it('drops values it cannot read instead of guessing', () => {
      const street = parse({ highway: 'residential', width: "12'6\"", lanes: '2;3', layer: 'x' });
      expect(street.width).toBeUndefined();
      expect(street.lanes).toBeUndefined();
      expect(street.layer).toBeUndefined();
    });

    it('reads a decimal comma in width', () => {
      expect(parse({ highway: 'service', width: '3,5' }).width).toBe(3.5);
    });
  });

  // ════════════════════════════════════════════════════════════
  // filterBuildingsNearRoutes
  // ════════════════════════════════════════════════════════════

  describe('filterBuildingsNearRoutes', () => {
    const makeBuilding = (id: number, lat: number, lon: number): BuildingFootprint => ({
      id,
      type: 'yes',
      levels: 2,
      nodes: [
        { id: id * 10 + 1, lat, lon },
        { id: id * 10 + 2, lat: lat + 0.0001, lon },
        { id: id * 10 + 3, lat: lat + 0.0001, lon: lon + 0.0001 },
      ],
    });

    it('returns all buildings when no routes given', () => {
      const buildings = [makeBuilding(1, 48.0, 9.0)];
      const result = service.filterBuildingsNearRoutes(buildings, []);
      expect(result).toHaveLength(1);
    });

    it('keeps buildings near a route', () => {
      // Building at 48.0, 9.0 — route passes through 48.0, 9.0
      const buildings = [makeBuilding(1, 48.0, 9.0)];
      const routes = [[{ lat: 48.0, lon: 9.0 }, { lat: 48.001, lon: 9.001 }]];
      const result = service.filterBuildingsNearRoutes(buildings, routes, 100);
      expect(result).toHaveLength(1);
    });

    it('filters out buildings far from routes', () => {
      // Building at 48.1, 9.1 — far from route at 48.0, 9.0
      const buildings = [makeBuilding(1, 48.1, 9.1)];
      const routes = [[{ lat: 48.0, lon: 9.0 }, { lat: 48.001, lon: 9.001 }]];
      const result = service.filterBuildingsNearRoutes(buildings, routes, 100);
      expect(result).toHaveLength(0);
    });

    it('filters mixed near/far buildings correctly', () => {
      const buildings = [
        makeBuilding(1, 48.0, 9.0),       // near route
        makeBuilding(2, 48.1, 9.1),       // far from route
        makeBuilding(3, 48.0005, 9.0005), // near route
      ];
      const routes = [[{ lat: 48.0, lon: 9.0 }, { lat: 48.001, lon: 9.001 }]];
      const result = service.filterBuildingsNearRoutes(buildings, routes, 100);
      expect(result).toHaveLength(2);
      expect(result.map(b => b.id)).toEqual([1, 3]);
    });
  });

  // ════════════════════════════════════════════════════════════
  // findPath
  // ════════════════════════════════════════════════════════════

  describe('findPath', () => {
    // L-förmiger Way mit reinem Shape-Node an der Ecke (id 2), Kreuzungen
    // nur an den Enden (Node 1 und Node 3).
    const n10 = { id: 10, lat: 47.999, lon: 9.0 };
    const n1 = { id: 1, lat: 48.0, lon: 9.0 };
    const n2 = { id: 2, lat: 48.001, lon: 9.0 };
    const n3 = { id: 3, lat: 48.001, lon: 9.0015 };
    const n30 = { id: 30, lat: 48.001, lon: 9.003 };
    const network: StreetNetwork = {
      streets: [
        { id: 100, name: 'Süd', type: 'residential', nodes: [n10, n1] },
        { id: 200, name: 'Ecke', type: 'residential', nodes: [n1, n2, n3] },
        { id: 300, name: 'Ost', type: 'residential', nodes: [n3, n30] },
      ],
      nodes: new Map([n10, n1, n2, n3, n30].map((n) => [n.id, n])),
      bounds: { minLat: 47.999, maxLat: 48.001, minLon: 9.0, maxLon: 9.003 },
    };

    it('keeps the shape node at the corner of a way', () => {
      const path = service.findPath(network, 47.9995, 9.0, 48.001, 9.0025);
      expect(path.map((n) => n.id)).toEqual([ROUTE_START_NODE_ID, 1, 2, 3]);
    });

    describe('where the route starts and ends', () => {
      // A straight street north along lon 9, in ways of 111 to 333 m:
      // n0 - n1 (111 m) - n2 (333 m) - n3 (111 m) - n4 (222 m)
      const s0 = { id: 0, lat: 47.999, lon: 9.0 };
      const s1 = { id: 1, lat: 48.0, lon: 9.0 };
      const s2 = { id: 2, lat: 48.003, lon: 9.0 };
      const s3 = { id: 3, lat: 48.004, lon: 9.0 };
      const s4 = { id: 4, lat: 48.006, lon: 9.0 };
      const straight: StreetNetwork = {
        streets: [
          { id: 100, name: 'Süd', type: 'residential', nodes: [s0, s1] },
          { id: 200, name: 'Lang', type: 'residential', nodes: [s1, s2] },
          { id: 300, name: 'Mitte', type: 'residential', nodes: [s2, s3] },
          { id: 400, name: 'Nord', type: 'residential', nodes: [s3, s4] },
        ],
        nodes: new Map([s0, s1, s2, s3, s4].map((n) => [n.id, n])),
        bounds: { minLat: 47.999, maxLat: 48.006, minLon: 9.0, maxLon: 9.0 },
      };
      /** 20 m east of the street beside the middle of Nord */
      const hq = { lat: 48.005, lon: 9.00027 };

      it('starts a click beside the middle of a long segment at its foot there, not on the segment\'s first node', () => {
        // 7 m east of the middle of Lang, 167 m from either node
        const path = service.findPath(straight, 48.0015, 9.0001, hq.lat, hq.lon);
        expect(path[0].id).toBe(ROUTE_START_NODE_ID);
        expect(path[0].lat).toBeCloseTo(48.0015, 9);
        expect(path[0].lon).toBe(9.0);
        expect(path.slice(1).map((n) => n.id)).toEqual([2, 3]);
      });

      it('leaves the foot towards the HQ, whichever end of the segment that is', () => {
        // The HQ beside the middle of Süd: the route ends on n1, the end of
        // Süd it reaches first, not on n0 beyond the HQ's foot
        const south = { lat: 47.9995, lon: 9.00027 };
        const path = service.findPath(straight, 48.0015, 9.0001, south.lat, south.lon);
        expect(path[0].id).toBe(ROUTE_START_NODE_ID);
        expect(path.slice(1).map((n) => n.id)).toEqual([1]);
      });

      it('ends on the end of the HQ\'s segment that reaches its foot for less, not on the segment\'s first node', () => {
        // A path across a square drawn from its north edge n to its middle m;
        // the HQ stands beside it near m. From the west the route reaches m
        // straight over the east link j-m, n only round the ring.
        const w = { id: 20, lat: 48.0, lon: 8.99 };
        const j = { id: 21, lat: 48.0, lon: 9.0 };
        const m = { id: 22, lat: 48.0, lon: 9.001 };
        const n = { id: 23, lat: 48.002, lon: 9.001 };
        const square: StreetNetwork = {
          streets: [
            { id: 500, name: 'West', type: 'residential', nodes: [w, j] },
            { id: 600, name: 'Radial', type: 'footway', nodes: [n, m] },
            { id: 700, name: 'East link', type: 'footway', nodes: [j, m] },
            { id: 800, name: 'Ring', type: 'footway', nodes: [j, n] },
          ],
          nodes: new Map([w, j, m, n].map((node) => [node.id, node])),
          bounds: { minLat: 48.0, maxLat: 48.002, minLon: 8.99, maxLon: 9.001 },
        };
        const path = service.findPath(square, 48.0, 8.995, 48.0004, 9.0011);
        expect(path.slice(1).map((node) => node.id)).toEqual([21, 22]);
      });

      it('ends on a street the start connects to where a cut-off way lies nearest to the HQ', () => {
        // A passage p-q beside the HQ joins no other way (as inside the
        // Colosseum); the street w-j 30 m off does
        const w = { id: 30, lat: 48.0, lon: 8.99 };
        const j = { id: 31, lat: 48.0, lon: 9.0 };
        const p = { id: 32, lat: 48.0003, lon: 9.0001 };
        const q = { id: 33, lat: 48.0003, lon: 9.0002 };
        const cutOff: StreetNetwork = {
          streets: [
            { id: 900, name: 'Street', type: 'residential', nodes: [w, j] },
            { id: 910, name: 'Passage', type: 'footway', nodes: [p, q] },
          ],
          nodes: new Map([w, j, p, q].map((node) => [node.id, node])),
          bounds: { minLat: 48.0, maxLat: 48.0003, minLon: 8.99, maxLon: 9.0002 },
        };
        const path = service.findPath(cutOff, 48.0, 8.995, 48.00025, 9.00015);
        expect(path.slice(1).map((node) => node.id)).toEqual([31]);
      });

      it('starts a click 11 m short of a junction at its foot, not on the far end of the segment', () => {
        const path = service.findPath(straight, 48.0029, 9.0001, hq.lat, hq.lon);
        expect(path[0].id).toBe(ROUTE_START_NODE_ID);
        expect(service.haversineDistance(path[0].lat, path[0].lon, s2.lat, s2.lon)).toBeCloseTo(11.1, 0);
        expect(path.slice(1).map((n) => n.id)).toEqual([2, 3]);
      });

      it('starts a click on a junction on the junction node itself', () => {
        // Foot 0.5 m past n2 on Mitte
        const path = service.findPath(straight, 48.0030045, 9.0001, hq.lat, hq.lon);
        expect(path.map((n) => n.id)).toEqual([2, 3]);
        expect(path[0]).toBe(s2);
      });

      it('ends the built route at the foot of the HQ on its segment and then at the HQ', () => {
        // A* ends on the first node of the HQ's segment; the route is led on
        // from there as PathAndRouteService.buildRouteFromPath does it
        const path = service.findPath(straight, 48.0015, 9.0001, hq.lat, hq.lon);
        expect(path[path.length - 1]).toBe(s3);

        const built = leavePathForBase(extendPathToOptimalTurnoff(path, hq, straight.streets, service), hq, service);
        const [foot, end] = built.slice(-2);
        expect(end).toEqual(hq);
        expect(foot.lat).toBeCloseTo(hq.lat, 9);
        expect(foot.lon).toBe(9.0);
        expect(built.slice(1, -2).map((p) => p.lat)).toEqual([s2.lat, s3.lat]);
      });
    });
  });

  // ════════════════════════════════════════════════════════════
  // loadStreets: the Overpass servers
  // ════════════════════════════════════════════════════════════

  describe('findRandomStreetPoint', () => {
    it('checks the route from where the spawn will stand, the node rounded as the game takes it', () => {
      // A street north along lon 9, its far end at more digits than the URL keeps.
      const s0 = { id: 0, lat: 48.0, lon: 9.0 };
      const s1 = { id: 1, lat: 48.003, lon: 9.0 };
      const s2 = { id: 2, lat: 48.0045678912, lon: 9.0000012345 };
      const network: StreetNetwork = {
        streets: [
          { id: 100, name: 'Süd', type: 'residential', nodes: [s0, s1] },
          { id: 200, name: 'Nord', type: 'residential', nodes: [s1, s2] },
        ],
        nodes: new Map([s0, s1, s2].map((n) => [n.id, n])),
        bounds: { minLat: 48.0, maxLat: 48.0046, minLon: 9.0, maxLon: 9.0 },
      };
      const findPath = vi.spyOn(service, 'findPath');

      // 20 m east of the middle of Süd; only s2 lies 300 m or more off.
      const spawn = service.findRandomStreetPoint(network, 48.0015, 9.00027, 300, 1000);

      expect(spawn).toMatchObject({ lat: 48.00457, lon: 9, nodeId: 2 });
      expect(findPath).toHaveBeenCalledOnce();
      expect(findPath.mock.calls[0].slice(1, 3)).toEqual([48.00457, 9]);
    });

    it('moves a spawn off a bend along its route until the route runs straight through the portal', () => {
      // A stub 2 m east from j0 to the corner j1, then a street south past the HQ.
      const j0 = { id: 0, lat: 48.0, lon: 9.0 };
      const j1 = { id: 1, lat: 48.0, lon: 9.0000268 };
      const j2 = { id: 2, lat: 47.99955, lon: 9.0000268 };
      const j3 = { id: 3, lat: 47.995, lon: 9.0000268 };
      const network: StreetNetwork = {
        streets: [
          { id: 100, name: 'Stub', type: 'residential', nodes: [j0, j1] },
          { id: 200, name: 'South', type: 'residential', nodes: [j1, j2, j3] },
        ],
        nodes: new Map([j0, j1, j2, j3].map((n) => [n.id, n])),
        bounds: { minLat: 47.995, maxLat: 48.0, minLon: 9.0, maxLon: 9.0000268 },
      };
      // The shuffle keeps the order, so j0 on the stub is drawn first
      const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const spawn = service.findRandomStreetPoint(network, 47.9952, 9.0000268, 300, 1000);
      random.mockRestore();

      // At j0 the route turns south 2 m on; the spawn stands on the corner, rounded
      expect(spawn).toMatchObject({ lat: 48, lon: 9.00003, streetName: 'Stub' });
      expect(spawn?.nodeId).toBeUndefined();
    });
  });

  describe('loadStreets', () => {
    /** A request to a fake Overpass server, answered by the test. */
    interface OverpassRequest {
      host: string;
      query: string;
      signal: AbortSignal;
      answer(data: object, status?: number): void;
      /** Send the headers now; the body comes with the call returned. */
      stream(): (data: object) => void;
      fail(error: Error): void;
    }
    let requests: OverpassRequest[];
    let warn: ReturnType<typeof vi.spyOn>;
    /** Let the promise chain of a load run up to its next request or its end. */
    const flush = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    };
    /** Overpass answer with a residential way per [id, lat0, lon0, lat1, lon1]. */
    const overpass = (...ways: [number, number, number, number, number][]) => ({
      elements: ways.flatMap(([id, lat0, lon0, lat1, lon1]) => [
        { type: 'node', id: id * 10, lat: lat0, lon: lon0 },
        { type: 'node', id: id * 10 + 1, lat: lat1, lon: lon1 },
        { type: 'way', id, nodes: [id * 10, id * 10 + 1], tags: { highway: 'residential', name: `Way ${id}` } },
      ]),
    });
    const logged = (): string[] => warn.mock.calls.map((call: unknown[]) => String(call[0]));

    beforeEach(() => {
      requests = [];
      vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => new Promise((resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
        requests.push({
          host: new URL(url).host,
          query: decodeURIComponent(String(init.body).replace(/^data=/, '')),
          signal,
          answer: (data, status = 200) => resolve({ ok: status < 400, status, text: async () => JSON.stringify(data) }),
          stream: () => {
            let body!: (text: string) => void;
            const text = new Promise<string>((done, abort) => {
              body = done;
              signal.addEventListener('abort', () => abort(new DOMException('The operation was aborted.', 'AbortError')));
            });
            resolve({ ok: true, status: 200, text: () => text });
            return (data) => body(JSON.stringify(data));
          },
          fail: reject,
        });
      })));
      warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('logs where the time of each attempt went, and asks the next server when one fails', async () => {
      const loading = service.loadStreets(48.78, 9.18, 500);
      await flush();
      requests[0].answer({}, 504);
      await flush();
      expect(requests.map((request) => request.host)).toEqual(['overpass.kumi.systems', 'overpass-api.de']);

      requests[1].answer({ ...overpass([1, 48.78, 9.18, 48.781, 9.18]), remark: 'runtime error: out of memory' });
      const network = await loading;

      expect(network.streets.map((street) => street.id)).toEqual([1]);
      expect(logged()).toContainEqual(expect.stringMatching(
        /^\[OSM\] streets from overpass\.kumi\.systems failed after \d+ms: OSM API error: 504$/,
      ));
      expect(logged()).toContainEqual(expect.stringMatching(
        /^\[OSM\] streets from overpass-api\.de: headers=\d+ body=\d+ms size=\d+\.\dMB ways=1 nodes=2 remark="runtime error: out of memory"$/,
      ));
    });

    it('asks the next server as well when the first has not started its answer after 4 s, and aborts the slower', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const loading = service.loadStreets(48.78, 9.18, 500);
      await flush();

      vi.advanceTimersByTime(3999);
      await flush();
      expect(requests).toHaveLength(1);
      vi.advanceTimersByTime(1);
      await flush();
      expect(requests.map((request) => request.host)).toEqual(['overpass.kumi.systems', 'overpass-api.de']);

      requests[1].answer(overpass([1, 48.78, 9.18, 48.781, 9.18]));
      await expect(loading).resolves.toMatchObject({ streets: [{ id: 1 }] });
      expect(requests[0].signal.aborted).toBe(true);
      expect(logged().filter((line) => line.includes('failed'))).toEqual([]);

      vi.advanceTimersByTime(20000);
      await flush();
      expect(requests).toHaveLength(2);
    });

    it('aborts a server that has not started its answer after 15 s; the others were asked meanwhile', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const loading = service.loadStreets(48.78, 9.18, 500);
      await flush();

      for (let i = 0; i < 15; i++) {
        vi.advanceTimersByTime(1000);
        await flush();
      }

      expect(requests).toHaveLength(3);
      expect(requests[0].signal.aborted).toBe(true);
      expect(logged()).toContainEqual(expect.stringMatching(/overpass\.kumi\.systems failed after \d+ms: no answer within 15000ms$/));
      requests[2].answer(overpass([1, 48.78, 9.18, 48.781, 9.18]));
      await expect(loading).resolves.toMatchObject({ streets: [{ id: 1 }] });
      expect(requests[1].signal.aborted).toBe(true);
    });

    it('asks no other server while an answer streams in', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const loading = service.loadStreets(48.78, 9.18, 500);
      await flush();
      vi.advanceTimersByTime(1000);
      const body = requests[0].stream();
      await flush();

      vi.advanceTimersByTime(20000);
      await flush();
      expect(requests).toHaveLength(1);

      body(overpass([1, 48.78, 9.18, 48.781, 9.18]));
      await expect(loading).resolves.toMatchObject({ streets: [{ id: 1 }] });
    });

    it('aborts a server whose answer has not ended 30 s after its headers, and asks the next', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const loading = service.loadStreets(48.78, 9.18, 500);
      await flush();
      requests[0].stream();
      await flush();

      vi.advanceTimersByTime(29999);
      await flush();
      expect(requests).toHaveLength(1);
      vi.advanceTimersByTime(1);
      await flush();

      expect(requests[0].signal.aborted).toBe(true);
      expect(logged()).toContainEqual(expect.stringMatching(
        /overpass\.kumi\.systems failed after \d+ms: answer not complete within 30000ms$/,
      ));
      expect(requests.map((request) => request.host)).toEqual(['overpass.kumi.systems', 'overpass-api.de']);
      requests[1].answer(overpass([1, 48.78, 9.18, 48.781, 9.18]));
      await expect(loading).resolves.toMatchObject({ streets: [{ id: 1 }] });
    });

    it('hands over to the next server at once when one fails, also after the second was asked alongside', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const loading = service.loadStreets(48.78, 9.18, 500);
      await flush();
      vi.advanceTimersByTime(4000);
      await flush();

      requests[0].answer({}, 429);
      await flush();
      expect(requests).toHaveLength(3);

      requests[1].answer(overpass([1, 48.78, 9.18, 48.781, 9.18]));
      await expect(loading).resolves.toMatchObject({ streets: [{ id: 1 }] });
      expect(requests[2].signal.aborted).toBe(true);
    });

    it('hands an answer without streets to the next server, and says so when no server has any', async () => {
      const loading = service.loadStreets(48.78, 9.18, 500);
      for (let i = 0; i < 3; i++) {
        await flush();
        requests[i].answer({ elements: [] });
      }
      await expect(loading).rejects.toThrow('No streets found in this area');
      expect(requests).toHaveLength(3);
    });

    describe('after streets were loaded', () => {
      const LAT = 48.78;
      const LON = 9.18;
      const old = boxAround(LAT, LON, 500);
      /** One radius east: the new box starts in the middle of the old one. */
      const EAST = LON + (old.maxLon - old.minLon) / 2;
      const wayClauses = (query: string) => query.match(/way\[/g)?.length ?? 0;

      /** Load around (LAT, LON) and answer with the ways of the first test below. */
      const loadFirst = async () => {
        const loading = service.loadStreets(LAT, LON, 500);
        await flush();
        requests[0].answer(overpass(
          [1, LAT, 9.175, LAT, 9.176], // west half, outside the next box
          [2, LAT, 9.185, LAT, 9.188], // across the east edge
          [3, LAT, 9.181, LAT, 9.182], // east half, inside both boxes
        ));
        await loading;
      };

      it('takes the loaded ways inside the new box and asks Overpass only for the rest of it', async () => {
        await loadFirst();

        const loading = service.loadStreets(LAT, EAST, 500);
        await flush();
        const query = requests[1].query;
        expect(wayClauses(query)).toBe(1);
        expect(query).toContain(`,${old.maxLon},`);
        requests[1].answer(overpass(
          [2, LAT, 9.185, LAT, 9.188],
          [4, LAT, 9.19, LAT, 9.191], // east strip
        ));
        const network = await loading;

        expect(network.streets.map((street) => street.id)).toEqual([2, 3, 4]);
        expect(network.bounds).toEqual(boxAround(LAT, EAST, 500));
        expect(logged()).toContainEqual(expect.stringMatching(
          /^\[OSM\] streets: \d+\.\d of \d+\.\dkm² from the streets loaded before, fetching \d+\.\dkm² in 1 boxes$/,
        ));
      });

      it('asks Overpass nothing when the loaded streets cover the new box', async () => {
        await loadFirst();

        const network = await service.loadStreets(LAT, 9.1815, 50);

        expect(requests).toHaveLength(1);
        expect(network.streets.map((street) => street.id)).toEqual([3]);
      });

      it('asks for the whole box when it does not overlap the loaded streets', async () => {
        await loadFirst();

        const loading = service.loadStreets(LAT + 0.1, LON, 500);
        await flush();
        const far = boxAround(LAT + 0.1, LON, 500);
        expect(wayClauses(requests[1].query)).toBe(1);
        expect(requests[1].query).toContain(`(${far.minLat},${far.minLon},${far.maxLat},${far.maxLon})`);
        requests[1].answer(overpass([7, LAT + 0.1, LON, LAT + 0.1, LON + 0.001]));
        await expect(loading).resolves.toMatchObject({ streets: [{ id: 7 }] });
      });
    });

    it('says the servers are unreachable when all of them fail', async () => {
      const loading = service.loadStreets(48.78, 9.18, 500);
      for (let i = 0; i < 3; i++) {
        await flush();
        requests[i].fail(new TypeError('Failed to fetch'));
      }
      await expect(loading).rejects.toThrow('OSM server unreachable');
    });
  });

  // ════════════════════════════════════════════════════════════
  // haversineDistance
  // ════════════════════════════════════════════════════════════

  describe('haversineDistance', () => {
    it('returns 0 for same point', () => {
      expect(service.haversineDistance(48.0, 9.0, 48.0, 9.0)).toBe(0);
    });

    it('calculates reasonable distance for known points', () => {
      // ~111m per 0.001 degree latitude
      const dist = service.haversineDistance(48.0, 9.0, 48.001, 9.0);
      expect(dist).toBeGreaterThan(100);
      expect(dist).toBeLessThan(120);
    });
  });
});
