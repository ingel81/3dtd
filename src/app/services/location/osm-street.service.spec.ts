import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OsmStreetService, BuildingFootprint, StreetNetwork } from './osm-street.service';
import { boxAround } from './street-box';

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
      expect(path.map((n) => n.id)).toEqual([10, 1, 2, 3]);
    });
  });

  // ════════════════════════════════════════════════════════════
  // loadStreets: the Overpass servers
  // ════════════════════════════════════════════════════════════

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
            const text = new Promise<string>((done) => { body = done; });
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
