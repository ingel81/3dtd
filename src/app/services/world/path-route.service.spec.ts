import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Group, Vector3 } from 'three';

// Zellen-Stub, pro Test steuerbar: `ready` = Grid initialisiert, `cellY` = Zellhöhe,
// `unwalkable` = Mittelpunkte der Zellen, zu denen kein Gegner laufen kann.
const grid = vi.hoisted(() => ({
  ready: false,
  cellY: (_x: number, _z: number): number | null => null,
  unwalkable: [] as { x: number; z: number }[],
}));

// inject() liefert pro Service-Klasse einen Stub. PathAndRouteService braucht
// nur wenige Felder davon; OsmStreetService speichert seinen Cache-Service nur.
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  const stubs: Record<string, unknown> = {
    DevWorldService: { isActive: false },
    UIStore: { routesVisible: () => false },
    PathfindingWorkerService: { isWorkerAvailable: false, dispose: () => undefined },
    GlobalRouteGridService: {
      isInitialized: () => grid.ready,
      getGroundLocalYAt: (x: number, z: number) => grid.cellY(x, z),
      getGrid: () => ({ unwalkableCells: () => grid.unwalkable, getCellSize: () => 2 }),
    },
  };
  return {
    ...actual,
    inject: (token: { name?: string }) => stubs[token?.name ?? ''] ?? {},
  };
});

import { PathAndRouteService } from './path-route.service';
import { OsmStreetService, StreetNetwork, StreetNode } from '../location/osm-street.service';
import { SpawnPoint } from './marker-visualization.service';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';
import type { ThreeTilesEngine } from '../../three-engine';
import type { StationProbe } from '../../utils/route-corridor';

const ORIGIN = { lat: 48.0, lon: 9.0 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);

/** Lokale Meter-Koordinaten (x Ost, z Nord) um ORIGIN. */
function toMeters(p: { lat: number; lon: number }): { x: number; z: number } {
  return { x: (p.lon - ORIGIN.lon) * M_PER_DEG_LON, z: (p.lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT };
}

function distToSegmentM(
  p: { lat: number; lon: number },
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const P = toMeters(p);
  const A = toMeters(a);
  const B = toMeters(b);
  const dx = B.x - A.x;
  const dz = B.z - A.z;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.z - A.z) * dz) / lenSq));
  return Math.hypot(P.x - (A.x + t * dx), P.z - (A.z + t * dz));
}

/** True, wenn beide Punkte auf derselben Kante (zwei aufeinanderfolgende Nodes) eines Ways liegen. */
function liesOnWayEdge(network: StreetNetwork, a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  for (const street of network.streets) {
    for (let i = 0; i < street.nodes.length - 1; i++) {
      const u = street.nodes[i];
      const v = street.nodes[i + 1];
      if (distToSegmentM(a, u, v) < 0.05 && distToSegmentM(b, u, v) < 0.05) return true;
    }
  }
  return false;
}

/**
 * Freiraum links und rechts der Fahrtrichtung, den der Engine-Ersatz meldet,
 * pro Test steuerbar: lokale x/z der Messstation, `max` = Suchweite. Eine
 * Zahl gilt für beide Seiten und alle Strahlhöhen, ein Array je Strahlhöhe
 * (unten, oben), `null` = kein feines Tile, `'no tile'` = gar kein Tile unter
 * der Station (eine Naht zwischen zwei Tile-Meshes).
 */
type Hits = number | number[];
type Clearance = number | { left: Hits; right: Hits; shiftM?: number; lowRise?: { left: number; right: number } } | null | 'no tile';
let clearanceAt: (x: number, z: number, max: number) => Clearance = (_x, _z, max) => max;

/** Jede Messstation, die der Engine-Ersatz beantwortet hat: Ort, Richtung, Strahlhöhen, Länge, Deck. */
const probeCalls: unknown[][] = [];

/** Minimaler Engine-Ersatz: flaches Gelände, Geo→Lokal als Plattkarte um ORIGIN. */
function makeEngine(): ThreeTilesEngine {
  const overlay = new Group();
  return {
    getOverlayGroup: () => overlay,
    getTerrainHeightAtGeo: () => 0,
    terrain: {
      // Höhe des gelben Overlays: flaches Gelände.
      getStreetHeightEstimate: () => 0,
      measureStreetClearance: (
        x: number, z: number, ax: number, az: number, heights: readonly number[], max: number, onDeck = false,
      ): StationProbe => {
        probeCalls.push([x, z, ax, az, [...heights], max, onDeck]);
        const free = clearanceAt(x, z, max);
        if (free === null) return { unmeasured: 'coarse tile', tileError: 20, left: [], right: [] };
        if (free === 'no tile') return { unmeasured: 'no tile', tileError: Infinity, left: [], right: [] };
        const perHeight = (hits: Hits) => (typeof hits === 'number' ? heights.map(() => hits) : hits);
        const sides = typeof free === 'number' ? { left: free, right: free } : free;
        const shifted = typeof free === 'object' && free.shiftM !== undefined ? { shiftM: free.shiftM } : {};
        const lowRise = typeof free === 'object' && free.lowRise !== undefined ? { lowRise: free.lowRise } : {};
        return { unmeasured: null, tileError: 2, left: perHeight(sides.left), right: perHeight(sides.right), ...shifted, ...lowRise };
      },
    },
    sync: {
      getOrigin: () => ({ ...ORIGIN, height: 0 }),
      geoToLocalSimple: (lat: number, lon: number, h: number) => {
        const m = toMeters({ lat, lon });
        return new Vector3(m.x, h, -m.z);
      },
    },
  } as unknown as ThreeTilesEngine;
}

function makeNetwork(
  streets: {
    id: number;
    type?: string;
    width?: number;
    lanes?: number;
    bridge?: string;
    tunnel?: string;
    covered?: string;
    nodes: StreetNode[];
  }[],
): StreetNetwork {
  const nodes = new Map<number, StreetNode>();
  for (const s of streets) for (const n of s.nodes) nodes.set(n.id, n);
  return {
    streets: streets.map((s) => ({ ...s, name: `Way ${s.id}`, type: s.type ?? 'residential' })),
    nodes,
    bounds: { minLat: 47.99, maxLat: 48.01, minLon: 8.99, maxLon: 9.01 },
  };
}

function buildRoute(network: StreetNetwork, spawn: { lat: number; lon: number }, hq: { lat: number; lon: number }) {
  return buildRouteService(network, spawn, hq).getCachedPath('s1')!;
}

function buildRouteService(network: StreetNetwork, spawn: { lat: number; lon: number }, hq: { lat: number; lon: number }) {
  const service = new PathAndRouteService();
  service.initialize(
    makeEngine(),
    network,
    { lat: hq.lat, lon: hq.lon },
    (() => false) as never,
    new OsmStreetService(),
    null,
  );
  service.showPathFromSpawn(spawnPointAt(spawn));
  return service;
}

function spawnPointAt(spawn: { lat: number; lon: number }): SpawnPoint {
  return { id: 's1', name: 'Spawn', color: 0xff0000, lat: spawn.lat, lon: spawn.lon };
}

/** Measure every station in one go: a run with an unlimited budget, committed. */
function measure(service: PathAndRouteService): boolean {
  const run = service.beginClearanceMeasurement();
  run.step(Infinity);
  return run.commit();
}

describe('PathAndRouteService route geometry', () => {
  // L-förmiger Way mit reinem Shape-Node an der Ecke (id 2), Kreuzungen nur
  // an den Enden (Node 1 zu Way 100, Node 3 zu Way 300).
  const n10 = { id: 10, lat: 47.999, lon: 9.0 };
  const n1 = { id: 1, lat: 48.0, lon: 9.0 };
  const n2 = { id: 2, lat: 48.001, lon: 9.0 };
  const n3 = { id: 3, lat: 48.001, lon: 9.0015 };
  const n30 = { id: 30, lat: 48.001, lon: 9.003 };
  let network: StreetNetwork;

  beforeEach(() => {
    grid.ready = false;
    grid.cellY = () => null;
    grid.unwalkable = [];
    clearanceAt = (_x, _z, max) => max;
    network = makeNetwork([
      { id: 100, nodes: [n10, n1] },
      { id: 200, nodes: [n1, n2, n3] },
      { id: 300, nodes: [n3, n30] },
    ]);
  });

  it('hands the spawn portal the very route the enemies spawn on, starting on the street', () => {
    // EnemyManager.spawn starts every enemy on path[0] of the cached route;
    // the portal stands on route[0] of the route it is handed
    const onRouteBuilt = vi.fn();
    const service = new PathAndRouteService();
    service.initialize(
      makeEngine(), network, { lat: 48.0011, lon: 9.0025 }, (() => false) as never, new OsmStreetService(), onRouteBuilt,
    );
    // 7 m east of Way 100, 33 m north of its first node
    const spawn = { lat: 47.9993, lon: 9.0001 };
    service.showPathFromSpawn(spawnPointAt(spawn));

    const route = service.getCachedPath('s1')!;
    expect(onRouteBuilt).toHaveBeenCalledTimes(1);
    expect(onRouteBuilt.mock.calls[0][0]).toBe('s1');
    expect(onRouteBuilt.mock.calls[0][1]).toBe(route);
    // The route starts at the spawn's foot on the street, not on a node of it
    expect(distToSegmentM(route[0], n10, n1)).toBeLessThan(0.05);
    expect(distToSegmentM(spawn, route[0], route[0])).toBeCloseTo(distToSegmentM(spawn, n10, n1), 2);
    expect(distToSegmentM(route[0], n10, n10)).toBeGreaterThan(30);
  });

  it('says whether a route is cached (hasRoutes, gates the recent-locations list)', () => {
    const service = new PathAndRouteService();
    service.initialize(
      makeEngine(), network, { lat: 48.0011, lon: 9.0025 }, (() => false) as never, new OsmStreetService(), null,
    );
    expect(service.hasRoutes()).toBe(false);
    service.showPathFromSpawn(spawnPointAt({ lat: 47.9993, lon: 9.0 }));
    expect(service.hasRoutes()).toBe(true);
    service.clearCache();
    expect(service.hasRoutes()).toBe(false);
  });

  it('keeps the corner shape node in the cached route', () => {
    // HQ gut 10 m nördlich von Way 300.
    const route = buildRoute(network, { lat: 47.9995, lon: 9.0 }, { lat: 48.0011, lon: 9.0025 });
    expect(route.some((p) => p.lat === n2.lat && p.lon === n2.lon)).toBe(true);
  });

  it('runs on OSM way edges everywhere except the final leg to the HQ', () => {
    const hq = { lat: 48.0011, lon: 9.0025 };
    const route = buildRoute(network, { lat: 47.9995, lon: 9.0 }, hq);

    expect(route[route.length - 1]).toMatchObject(hq);
    for (let i = 0; i < route.length - 2; i++) {
      expect(liesOnWayEdge(network, route[i], route[i + 1]), `segment ${i}`).toBe(true);
    }
  });

  describe('describeRoutes', () => {
    const hq = { lat: 48.0011, lon: 9.0025 };

    it('splits the route into the OSM ways it runs over', () => {
      const service = buildRouteService(network, { lat: 47.9995, lon: 9.0 }, hq);
      const rows = service.describeRoutes();

      // Way 300 bis zum Abzweig, danach das Stück neben dem Netz zum HQ.
      expect(rows.map((r) => r.way)).toEqual([100, 200, 300, null]);
      expect(rows[1]).toMatchObject({ route: 's1', fromIndex: 1, toIndex: 3, type: 'residential' });
      expect(rows[1].lengthM).toBeGreaterThan(200);
      expect(rows.every((r) => r.maxCellAboveStreetM === null)).toBe(true);
    });

    it('reports where the cells sit above the street overlay', () => {
      const service = buildRouteService(network, { lat: 47.9995, lon: 9.0 }, hq);
      // Die Zelle an der Ecke (Node 2) liegt 8 m hoch, etwa auf einem Dach.
      // Unter 1 m, damit nur der Abtastpunkt genau auf der Ecke sie trifft.
      const corner = toMeters(n2);
      grid.ready = true;
      grid.cellY = (x, z) => (Math.hypot(x - corner.x, -z - corner.z) < 1 ? 8 : 0);

      const rows = service.describeRoutes();
      expect(rows[1]).toMatchObject({ way: 200, maxCellAboveStreetM: 8, at: '48.001000,9.000000' });
      expect(rows[0].maxCellAboveStreetM).toBe(0);
    });

    it('lists the tags that explain a hidden shortcut', () => {
      network.streets[1] = { ...network.streets[1], type: 'footway', tunnel: 'building_passage', width: 2 };
      const rows = buildRouteService(network, { lat: 47.9995, lon: 9.0 }, hq).describeRoutes();
      expect(rows[1]).toMatchObject({ type: 'footway', tags: 'width=2 tunnel=building_passage' });
    });

    it('shows the street width, where it came from and the corridor it gave', () => {
      network.streets[1] = { ...network.streets[1], type: 'primary', lanes: 3 };
      const rows = buildRouteService(network, { lat: 47.9995, lon: 9.0 }, hq).describeRoutes();
      expect(rows[0]).toMatchObject({ way: 100, widthM: 5.5, widthSource: 'highway', corridorM: '5.5' });
      expect(rows[1]).toMatchObject({ way: 200, widthM: 10, widthSource: 'lanes', corridorM: '10.0' });
      expect(rows[3]).toMatchObject({ way: null, widthM: null, widthSource: 'inherited', corridorM: '5.5' });
    });
  });

  describe('corridor width', () => {
    const hq = { lat: 48.0011, lon: 9.0025 };

    it('gives each segment the half width of the street it runs over', () => {
      network = makeNetwork([
        { id: 100, nodes: [n10, n1] },
        { id: 200, type: 'primary', width: 12, nodes: [n1, n2, n3] },
        { id: 300, type: 'footway', nodes: [n3, n30] },
      ]);
      const route = buildRoute(network, { lat: 47.9995, lon: 9.0 }, hq);

      // n10, n1, n2, n3, turn-off on way 300, HQ. Residential 5.5 m, the
      // 12 m width tag, a 2 m footway, one cell wide, the leg to the HQ
      // keeps the footway's, the HQ ends the route. Nothing is measured yet,
      // so both sides have the street's half width.
      expect(route.map((p) => p.corridorLeft)).toEqual([2.75, 6, 6, 1, 1, undefined]);
      expect(route.map((p) => p.corridorRight)).toEqual([2.75, 6, 6, 1, 1, undefined]);
    });

    it('marks the segments that run over a bridge', () => {
      network = makeNetwork([
        { id: 100, nodes: [n10, n1] },
        { id: 200, bridge: 'yes', nodes: [n1, n2, n3] },
        { id: 300, nodes: [n3, n30] },
      ]);
      const route = buildRoute(network, { lat: 47.9995, lon: 9.0 }, hq);
      expect(route.map((p) => p.onBridge === true)).toEqual([false, true, true, false, false, false]);
    });

    it('widens a short narrow stretch between wider ones', () => {
      // A 3.3 m footway link (1 m half width) between two residential ways.
      const n1b = { id: 5, lat: 48.00003, lon: 9.0 };
      network = makeNetwork([
        { id: 100, nodes: [n10, n1] },
        { id: 150, type: 'footway', nodes: [n1, n1b] },
        { id: 200, nodes: [n1b, n2, n3] },
        { id: 300, nodes: [n3, n30] },
      ]);
      const service = buildRouteService(network, { lat: 47.9995, lon: 9.0 }, hq);
      expect(service.getCachedPath('s1')!.map((p) => p.corridorLeft)).toEqual([2.75, 2.75, 2.75, 2.75, 2.75, 2.75, undefined]);

      const n1Local = toMeters(n1);
      const why = service.explainCorridorAt(n1Local.x, -(n1Local.z + 1.5))!;
      expect(why).toMatchObject({ way: 150, unmeasured: 'not measured yet' });
      expect(why.sides[0]).toMatchObject({
        streetHalfWidthM: 1, halfWidthM: 2.75, inUseM: 2.75, rule: 'not measured yet: street width, short narrowing closed',
      });
    });

    describe('fitted to the tiles', () => {
      const spawn = { lat: 47.9995, lon: 9.0 };
      /** Metres north of n1 at a local position (local z points south). */
      const northOfN1 = (z: number) => -z - toMeters(n1).z;

      beforeEach(() => {
        network = makeNetwork([
          { id: 100, nodes: [n10, n1] },
          { id: 200, type: 'primary', width: 12, nodes: [n1, n2, n3] },
          { id: 300, nodes: [n3, n30] },
        ]);
      });

      it('widens or narrows the corridor to the free space the tiles show', () => {
        // Facades 5.2 m off everywhere, 4.5 m after the wall margin: more
        // room than the 5.5 m residential ways get from OSM, less than the
        // 12 m of way 200.
        clearanceAt = () => 5.2;
        const service = buildRouteService(network, spawn, hq);

        expect(measure(service)).toBe(true);
        service.showPathFromSpawn(spawnPointAt(spawn));
        const route = service.getCachedPath('s1')!;

        // The leg to the HQ runs off the network and keeps the width it inherited.
        expect(route.map((p) => p.corridorLeft)).toEqual([4.5, 4.5, 4.5, 4.5, 2.75, undefined]);
        expect(route.map((p) => p.corridorRight)).toEqual([4.5, 4.5, 4.5, 4.5, 2.75, undefined]);
        expect(service.describeRoutes()[1]).toMatchObject({ way: 200, corridorM: '9.0', leftM: '4.5', rightM: '4.5' });
      });

      it('gives each side the free space on that side', () => {
        // From 40 to 80 m north of n1 a wall stands 2.6 m to the right; on
        // the left the rays run past front gardens without a hit.
        clearanceAt = (x, z, max) =>
          Math.abs(x) < 1 && northOfN1(z) > 40 && northOfN1(z) < 80 ? { left: max, right: 2.6 } : max;
        const service = buildRouteService(network, spawn, hq);

        expect(measure(service)).toBe(true);
        service.showPathFromSpawn(spawnPointAt(spawn));
        const route = service.getCachedPath('s1')!;

        // 2.6 m to the wall, 2.0 m after the wall margin.
        const narrow = route.filter((p) => p.corridorRight === 2);
        expect(narrow).toHaveLength(1);
        expect(narrow[0].corridorLeft).toBe(7);
        const start = northOfN1(-toMeters(narrow[0]).z);
        expect(start).toBeGreaterThan(38);
        expect(start).toBeLessThan(42);
        expect(service.describeRoutes()[1]).toMatchObject({
          way: 200,
          corridorM: '9.0-14.0',
          leftM: '7.0',
          rightM: '2.0-7.0',
        });
      });

      it('ignores something narrow that stands in the way for a single station', () => {
        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && Math.abs(northOfN1(z) - 50) < 1 ? 1 : max);
        const service = buildRouteService(network, spawn, hq);
        measure(service);
        service.showPathFromSpawn(spawnPointAt(spawn));
        expect(service.getCachedPath('s1')!.map((p) => p.corridorLeft)).toEqual([7, 7, 7, 7, 2.75, undefined]);
      });

      it('ends the corridor before a cell no enemy could walk to, and keeps it there', () => {
        // Open on both sides; the grid in use has a van 3 m right of the
        // centre line, 50 m north of n1 (local z points south).
        const service = buildRouteService(network, spawn, hq);
        measure(service);
        const n1Local = toMeters(n1);
        grid.ready = true;
        grid.unwalkable = [{ x: n1Local.x + 3, z: -(n1Local.z + 50) }];

        expect(service.narrowToWalkable()).toBe(true);
        // The same cell again narrows nothing more.
        expect(service.hasUnwalkableCells()).toBe(false);
        expect(service.narrowToWalkable()).toBe(false);

        service.showPathFromSpawn(spawnPointAt(spawn));
        const narrow = service.getCachedPath('s1')!.filter((p) => p.corridorRight === 2.5);
        // One station, 2.9 m short of the van rounded down; closing short narrowings keeps it.
        expect(narrow).toHaveLength(1);
        expect(narrow[0].corridorLeft).toBe(7);
        expect(northOfN1(-toMeters(narrow[0]).z)).toBeCloseTo(50, -1);

        const why = service.explainCorridorAt(n1Local.x, -(n1Local.z + 50))!;
        expect(why.sides[1]).toMatchObject({
          side: 'right', halfWidthM: 2.5, walkableM: 2.9, rule: 'no wall within the maximum, unwalkable cell beyond',
        });
        expect(why.sides[0]).toMatchObject({ side: 'left', halfWidthM: 7, walkableM: null });

        // Forgotten with the measurements.
        service.clearCorridorMeasurements();
        grid.unwalkable = [];
        measure(service);
        service.showPathFromSpawn(spawnPointAt(spawn));
        expect(service.getCachedPath('s1')!.some((p) => p.corridorRight === 2.5)).toBe(false);
      });

      it('gives a station without a tile between measured ones their width, not the street width', () => {
        // Playtest 2026-09-13: a residential street (2.75 m from OSM), open
        // on both sides, and a seam between two tile meshes under one station.
        network = makeNetwork([
          { id: 100, nodes: [n10, n1] },
          { id: 200, nodes: [n1, n2, n3] },
          { id: 300, nodes: [n3, n30] },
        ]);
        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && Math.abs(northOfN1(z) - 50) < 1 ? 'no tile' : max);
        const service = buildRouteService(network, spawn, hq);
        measure(service);
        service.showPathFromSpawn(spawnPointAt(spawn));
        expect(service.getCachedPath('s1')!.map((p) => p.corridorLeft)).toEqual([7, 7, 7, 7, 2.75, undefined]);

        const n1Local = toMeters(n1);
        const why = service.explainCorridorAt(n1Local.x, -(n1Local.z + 50))!;
        expect(why).toMatchObject({ way: 200, streetWidthM: 5.5, unmeasured: 'no tile' });
        expect(why.sides[0]).toMatchObject({
          freeM: null, smoothedM: 7, halfWidthM: 7, rule: 'unmeasured: from neighbours, no wall within the maximum',
        });
        const here = why.nearby.find((s) => s.here)!;
        expect(here).toMatchObject({ leftFreeM: null, leftM: 7, rightM: 7, unmeasured: 'no tile' });
      });

      it('says when a station was measured beside a seam', () => {
        clearanceAt = (x, z, max) =>
          Math.abs(x) < 1 && Math.abs(northOfN1(z) - 50) < 1 ? { left: max, right: max, shiftM: 0.5 } : max;
        const service = buildRouteService(network, spawn, hq);
        measure(service);

        const n1Local = toMeters(n1);
        expect(service.explainCorridorAt(n1Local.x, -(n1Local.z + 50))).toMatchObject({ unmeasured: null, shiftM: 0.5 });
        expect(service.explainCorridorAt(n1Local.x, -(n1Local.z + 30))).toMatchObject({ unmeasured: null, shiftM: null });
      });

      it('names in the log where stations found no tile', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && Math.abs(northOfN1(z) - 50) < 1 ? 'no tile' : max);
        measure(buildRouteService(network, spawn, hq));
        const line = warn.mock.calls.map(([l]) => String(l)).find((l) => l.startsWith('[Corridor] clearance:'))!;
        warn.mockRestore();

        const at = / unmeasured=1 \(coarse tile 0\) .* noTile=(-?[\d.]+),(-?[\d.]+)$/.exec(line)!;
        expect(Number(at[1])).toBeCloseTo(toMeters(n1).x, 0);
        expect(Math.abs(northOfN1(Number(at[2])) - 50)).toBeLessThan(1.1);
      });

      it('keeps the street width where no fine tile is loaded, and tries again later', () => {
        clearanceAt = () => null;
        const service = buildRouteService(network, spawn, hq);
        expect(measure(service)).toBe(false);

        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && northOfN1(z) > 40 && northOfN1(z) < 80 ? 2.6 : max);
        expect(measure(service)).toBe(true);
      });

      it('measures the stations again that had no fine tile, and only those', () => {
        // Facades 2.6 m off from 40 to 80 m north of n1, on way 200. The first
        // run has fine tiles only up to 60 m.
        const facades = (x: number, z: number, max: number) =>
          Math.abs(x) < 1 && northOfN1(z) > 40 && northOfN1(z) < 80 ? 2.6 : max;
        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && northOfN1(z) > 60 && northOfN1(z) < 110 ? null : facades(x, z, max));
        const service = buildRouteService(network, spawn, hq);
        expect(measure(service)).toBe(true);

        const remeasured: number[] = [];
        clearanceAt = (x, z, max) => {
          if (Math.abs(x) < 1) remeasured.push(northOfN1(z));
          return facades(x, z, max);
        };
        expect(measure(service)).toBe(true);
        expect(remeasured.length).toBeGreaterThan(0);
        expect(Math.min(...remeasured)).toBeGreaterThan(60);

        // The narrow stretch now runs to 80 m instead of ending at 60.
        service.showPathFromSpawn(spawnPointAt(spawn));
        const route = service.getCachedPath('s1')!;
        const k = route.findIndex((p) => p.corridorLeft === 2);
        expect(northOfN1(-toMeters(route[k]).z)).toBeGreaterThan(38);
        expect(northOfN1(-toMeters(route[k]).z)).toBeLessThan(42);
        expect(northOfN1(-toMeters(route[k + 1]).z)).toBeGreaterThan(78);
        expect(northOfN1(-toMeters(route[k + 1]).z)).toBeLessThan(82);
      });

      it('measures a segment once', () => {
        let calls = 0;
        clearanceAt = (_x, _z, max) => {
          calls++;
          return max;
        };
        const service = buildRouteService(network, spawn, hq);
        measure(service);
        expect(calls).toBeGreaterThan(100);

        calls = 0;
        measure(service);
        expect(calls).toBe(0);
      });

      it('explains the width at the station nearest to a point', () => {
        // On way 200 from 20 to 80 m north of n1: a van 2 m to the right in
        // front of a facade at 6 m; on the left the rays hit nothing.
        clearanceAt = (x, z, max) =>
          Math.abs(x) < 1 && Math.abs(northOfN1(z) - 50) < 30 ? { left: max, right: [2, 6] } : max;
        const service = buildRouteService(network, spawn, hq);
        measure(service);
        service.showPathFromSpawn(spawnPointAt(spawn));

        const n1Local = toMeters(n1);
        const why = service.explainCorridorAt(n1Local.x, -(n1Local.z + 50))!;
        expect(why).toMatchObject({
          route: 's1', way: 200, tags: 'width=12', streetWidthM: 12, widthSource: 'width', onStreet: true, unmeasured: null,
        });
        expect(why.distanceM).toBeLessThan(1.5);
        expect(why.sides[0]).toMatchObject({
          side: 'left', lowHitM: 7, highHitM: 7, wall: false, halfWidthM: 7, inUseM: 7, rule: 'no wall within the maximum',
        });
        // The van stops only the low ray, and no raised ground behind it was
        // reported (no lowRise): the wall is the facade at 6 m, less the margin.
        expect(why.sides[1]).toMatchObject({
          side: 'right', lowHitM: 2, highHitM: 6, wall: true, freeM: 6, halfWidthM: 5.5, inUseM: 5.5, rule: 'wall less margin',
        });
        expect(why.nearby.filter((s) => s.here)).toHaveLength(1);
        expect(why.nearby.length).toBe(9);
      });

      it('narrows the corridor at a car the low ray found with its roof behind the hit, however short', () => {
        // Playtest 2026-09-14, Rothenburg: a car on two stations 50 m north of
        // n1, its side 3.2 m right of the centre line, nothing over it; the
        // column 1 m behind the hit is its roof, 1.2 m up.
        const car = (rise: number) => (x: number, z: number, max: number): Clearance =>
          Math.abs(x) < 1 && Math.abs(northOfN1(z) - 50) < 2 ? { left: max, right: [3.2, max], lowRise: { left: NaN, right: rise } } : max;
        clearanceAt = car(1.2);
        const service = buildRouteService(network, spawn, hq);
        measure(service);
        service.showPathFromSpawn(spawnPointAt(spawn));

        const narrow = service.getCachedPath('s1')!.filter((p) => p.corridorRight === 2.5);
        expect(narrow).toHaveLength(1);
        expect(narrow[0].corridorLeft).toBe(7);
        const n1Local = toMeters(n1);
        const why = service.explainCorridorAt(n1Local.x, -(n1Local.z + 50))!;
        expect(why.sides[1]).toMatchObject({
          side: 'right', lowHitM: 3.2, highHitM: 7, lowRiseM: 1.2, wall: true, freeM: 3.2, halfWidthM: 2.5,
          rule: 'low obstacle, raised behind, wall less margin',
        });
        expect(why.sides[0]).toMatchObject({ side: 'left', lowRiseM: null, wall: false });

        // A fence with the pavement 0.15 m up behind it narrows nothing: the
        // corridor of open space, the leg to the HQ at its inherited width.
        clearanceAt = car(0.15);
        const fence = buildRouteService(network, spawn, hq);
        measure(fence);
        fence.showPathFromSpawn(spawnPointAt(spawn));
        expect(fence.getCachedPath('s1')!.map((p) => p.corridorRight)).toEqual([7, 7, 7, 7, 2.75, undefined]);
        expect(fence.explainCorridorAt(n1Local.x, -(n1Local.z + 50))!.sides[1])
          .toMatchObject({ lowRiseM: 0.2, wall: false, freeM: 7, rule: 'no wall within the maximum' });
      });

      it('says why a station has no measurement', () => {
        clearanceAt = () => null;
        const service = buildRouteService(network, spawn, hq);
        measure(service);

        const n1Local = toMeters(n1);
        const why = service.explainCorridorAt(n1Local.x, -(n1Local.z + 50))!;
        expect(why).toMatchObject({ way: 200, unmeasured: 'coarse tile', tileError: 20 });
        expect(why.sides[0]).toMatchObject({ lowHitM: null, wall: null, freeM: null, halfWidthM: 6, rule: 'unmeasured: street width' });
      });

      it('knows which stations still wait for finer tiles', () => {
        // Way 200 from 60 to 110 m north of n1 is still on coarse tiles.
        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && northOfN1(z) > 60 && northOfN1(z) < 110 ? null : max);
        const service = buildRouteService(network, spawn, hq);
        expect(service.hasUnmeasuredStations()).toBe(false);
        measure(service);
        expect(service.hasUnmeasuredStations()).toBe(true);

        // Finer tiles later: the stations get measured and widen the corridor there.
        clearanceAt = (_x, _z, max) => max;
        expect(measure(service)).toBe(true);
        expect(service.hasUnmeasuredStations()).toBe(false);
      });

      it('does not measure a tunnel or covered passage and keeps its street width there', () => {
        network = makeNetwork([
          { id: 100, nodes: [n10, n1] },
          { id: 200, type: 'primary', width: 12, tunnel: 'yes', nodes: [n1, n2, n3] },
          { id: 300, covered: 'yes', nodes: [n3, n30] },
        ]);
        // Facades 5.2 m off everywhere; inside a tunnel the rays would hit its walls.
        const probedOn200: number[] = [];
        clearanceAt = (x, z) => {
          if (Math.abs(x) < 1 && northOfN1(z) > 1) probedOn200.push(northOfN1(z));
          return 5.2;
        };
        const service = buildRouteService(network, spawn, hq);
        expect(measure(service)).toBe(true);
        service.showPathFromSpawn(spawnPointAt(spawn));
        const route = service.getCachedPath('s1')!;

        expect(probedOn200).toEqual([]);
        // n10, n1, n2, n3, turn-off on way 300, HQ: way 100 measured, 200
        // and 300 at their street width, the leg to the HQ inherits it.
        expect(route.map((p) => p.inTunnel === true)).toEqual([false, true, true, true, false, false]);
        expect(route.map((p) => p.corridorLeft)).toEqual([4.5, 6, 6, 2.75, 2.75, undefined]);

        const n1Local = toMeters(n1);
        const why = service.explainCorridorAt(n1Local.x, -(n1Local.z + 50))!;
        expect(why).toMatchObject({
          way: 200, tags: 'width=12 tunnel=yes', inTunnel: true, unmeasured: 'tunnel or covered: not measured',
        });
        expect(why.sides[0]).toMatchObject({ halfWidthM: 6, rule: 'tunnel or covered: street width' });
      });

      describe('in slices', () => {
        /** Facades 2.6 m off to the right from 40 to 80 m north of n1, nothing on the left. */
        const facades = (x: number, z: number, max: number): Clearance =>
          Math.abs(x) < 1 && northOfN1(z) > 40 && northOfN1(z) < 80 ? { left: max, right: 2.6 } : max;

        afterEach(() => vi.restoreAllMocks());

        it('casts the same rays in the same order and gives the same corridor as one go', () => {
          const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
          clearanceAt = facades;
          const oneGo = buildRouteService(network, spawn, hq);
          probeCalls.length = 0;
          expect(measure(oneGo)).toBe(true);
          const oneGoProbes = [...probeCalls];

          // Each station costs 1.7 ms on a fake clock, as in the city-centre playtest.
          let clock = 0;
          vi.spyOn(performance, 'now').mockImplementation(() => clock);
          clearanceAt = (x, z, max) => {
            clock += 1.7;
            return facades(x, z, max);
          };
          const sliced = buildRouteService(network, spawn, hq);
          probeCalls.length = 0;
          const run = sliced.beginClearanceMeasurement();
          let slices = 1;
          while (!run.step(4)) slices++;
          expect(run.commit()).toBe(true);

          expect(probeCalls).toEqual(oneGoProbes);
          // Two stations fit into 4 ms.
          expect(slices).toBe(Math.ceil(oneGoProbes.length / 2));
          oneGo.showPathFromSpawn(spawnPointAt(spawn));
          sliced.showPathFromSpawn(spawnPointAt(spawn));
          expect(sliced.getCachedPath('s1')).toEqual(oneGo.getCachedPath('s1'));
          expect(sliced.describeRoutes()).toEqual(oneGo.describeRoutes());

          // The log keeps its fields; the sliced run adds how it was cut up.
          const [oneGoLog, slicedLog] = warn.mock.calls
            .map(([line]) => String(line))
            .filter((line) => line.startsWith('[Corridor] clearance:'));
          expect(slicedLog.split(' in ')[0]).toBe(oneGoLog.split(' in ')[0]);
          expect(slicedLog).toMatch(new RegExp(`slices=${slices} wall=`));
          expect(oneGoLog).toMatch(/slices=1 wall=/);
        });

        it('keeps the corridor in use until the run is committed', () => {
          clearanceAt = () => 5.2;
          const service = buildRouteService(network, spawn, hq);
          const widths = () => service.getCachedPath('s1')!.map((p) => p.corridorLeft);
          const before = widths();

          const run = service.beginClearanceMeasurement();
          // A budget of 0 takes one station a step.
          expect(run.step(0)).toBe(false);
          expect(run.step(0)).toBe(false);
          // A route build in between, as after a settled tile batch.
          service.showPathFromSpawn(spawnPointAt(spawn));
          expect(widths()).toEqual(before);

          run.step(Infinity);
          expect(run.commit()).toBe(true);
          service.showPathFromSpawn(spawnPointAt(spawn));
          expect(widths()).toEqual([4.5, 4.5, 4.5, 4.5, 2.75, undefined]);
        });

        it('tells how far an open run is, and nothing once it is committed or cancelled', () => {
          vi.spyOn(console, 'warn').mockImplementation(() => undefined);
          clearanceAt = () => 5.2;
          const service = buildRouteService(network, spawn, hq);
          expect(service.clearanceProgress()).toBeNull();

          const run = service.beginClearanceMeasurement();
          const total = service.clearanceProgress()!.total;
          expect(total).toBeGreaterThan(2);
          expect(service.clearanceProgress()).toEqual({ done: 0, total });
          run.step(0);
          run.step(0);
          expect(service.clearanceProgress()).toEqual({ done: 2, total });
          run.step(Infinity);
          run.commit();
          expect(service.clearanceProgress()).toBeNull();

          const other = buildRouteService(network, spawn, hq);
          const cancelled = other.beginClearanceMeasurement();
          cancelled.step(0);
          cancelled.cancel('a tower');
          expect(other.clearanceProgress()).toBeNull();
        });

        it('tells how the latest run ended: committed, or cancelled by its owner or by the routes going away', () => {
          vi.spyOn(console, 'warn').mockImplementation(() => undefined);
          clearanceAt = () => 5.2;
          const service = buildRouteService(network, spawn, hq);
          expect(service.clearanceEnding()).toBeNull();

          const run = service.beginClearanceMeasurement();
          run.step(0);
          expect(service.clearanceEnding()).toBeNull();
          run.step(Infinity);
          run.commit();
          expect(service.clearanceEnding()).toBe('commit');

          // CorridorRefit drops it for a blocker (enemies from the debug panel)
          service.beginClearanceMeasurement().cancel('enemies are on the map');
          expect(service.clearanceEnding()).toBe('cancel');

          // The spawn moved: the routes it measured are replaced
          const replaced = buildRouteService(network, spawn, hq);
          replaced.beginClearanceMeasurement().step(0);
          replaced.clearCache();
          expect(replaced.clearanceEnding()).toBe('cancel');
          expect(replaced.clearanceProgress()).toBeNull();
        });

        it('gives the same corridor as one go when a tower or a wave has it finish at once', () => {
          const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
          clearanceAt = facades;
          const oneGo = buildRouteService(network, spawn, hq);
          probeCalls.length = 0;
          measure(oneGo);
          const oneGoProbes = [...probeCalls];

          const flushed = buildRouteService(network, spawn, hq);
          probeCalls.length = 0;
          const run = flushed.beginClearanceMeasurement();
          for (let i = 0; i < 5; i++) run.step(0);
          // What CorridorRefit.flush does: the rest in one go.
          run.step(Infinity);
          expect(run.commit('tower')).toBe(true);

          expect(probeCalls).toEqual(oneGoProbes);
          oneGo.showPathFromSpawn(spawnPointAt(spawn));
          flushed.showPathFromSpawn(spawnPointAt(spawn));
          expect(flushed.getCachedPath('s1')).toEqual(oneGo.getCachedPath('s1'));
          expect(String(warn.mock.calls.at(-1)?.[0])).toMatch(/ slices=6 wall=[\d.]+ms flushed=tower$/);
        });

        it('stores nothing of a cancelled run, the next one measures every station', () => {
          vi.spyOn(console, 'warn').mockImplementation(() => undefined);
          clearanceAt = () => 5.2;
          const service = buildRouteService(network, spawn, hq);
          const run = service.beginClearanceMeasurement();
          run.step(0);
          run.cancel('a tower');

          expect(run.open).toBe(false);
          expect(run.step(4)).toBe(true);
          expect(run.commit()).toBe(false);
          expect(service.hasUnmeasuredStations()).toBe(false);
          probeCalls.length = 0;
          expect(measure(service)).toBe(true);
          expect(probeCalls.length).toBeGreaterThan(100);
        });

        it('is cancelled when the routes or the measurements are replaced, or another run starts', () => {
          const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
          const replacements: [string, (service: PathAndRouteService) => void][] = [
            ['routes replaced', (service) => service.clearCache()],
            ['measurements cleared', (service) => service.clearCorridorMeasurements()],
            ['location changed', (service) =>
              service.initialize(makeEngine(), network, hq, (() => false) as never, new OsmStreetService(), null)],
            ['disposed', (service) => service.dispose()],
            ['superseded', (service) => service.beginClearanceMeasurement()],
          ];
          for (const [reason, replace] of replacements) {
            const service = buildRouteService(network, spawn, hq);
            const run = service.beginClearanceMeasurement();
            run.step(0);
            replace(service);

            expect(run.open, reason).toBe(false);
            expect(run.commit(), reason).toBe(false);
            expect(String(warn.mock.calls.at(-1)?.[0]), reason).toMatch(
              new RegExp(`^\\[Corridor\\] clearance cancelled \\(${reason}\\): stations=1 of \\d+ `),
            );
          }
        });
      });

      describe('after the routes were replaced', () => {
        // A spawn moved in place (LocationFacadeService.applySpawnInPlace):
        // the cache is cleared and the route built again from the new spawn.

        it('measures the new route only, and only its stations count as waiting', () => {
          // Way 400 runs on east of n30; the new spawn stands at its end.
          const n40 = { id: 40, lat: 48.001, lon: 9.0045 };
          network = makeNetwork([
            { id: 100, nodes: [n10, n1] },
            { id: 200, type: 'primary', width: 12, nodes: [n1, n2, n3] },
            { id: 300, nodes: [n3, n30] },
            { id: 400, nodes: [n30, n40] },
          ]);
          // Way 200 from 60 to 110 m north of n1 is still on coarse tiles.
          clearanceAt = (x, z, max) => (Math.abs(x) < 1 && northOfN1(z) > 60 && northOfN1(z) < 110 ? null : max);
          const service = buildRouteService(network, spawn, hq);
          measure(service);
          expect(service.hasUnmeasuredStations()).toBe(true);

          service.clearCache();
          service.showPathFromSpawn(spawnPointAt({ lat: n40.lat, lon: n40.lon }));
          // The stations still waiting belong to the route that is gone.
          expect(service.hasUnmeasuredStations()).toBe(false);

          probeCalls.length = 0;
          expect(measure(service)).toBe(true);
          // The new route runs east of way 200 (x up to 112 m) all the way.
          expect(probeCalls.length).toBeGreaterThan(0);
          expect(probeCalls.every(([x]) => (x as number) > 150)).toBe(true);
        });

        it('keeps what was measured for the segments a new route shares', () => {
          const service = buildRouteService(network, spawn, hq);
          measure(service);

          service.clearCache();
          service.showPathFromSpawn(spawnPointAt(spawn));
          probeCalls.length = 0;
          expect(measure(service)).toBe(false);
          expect(probeCalls).toEqual([]);
        });
      });
    });
  });

  it('leaves a diagonal street at the point closest to the HQ', () => {
    // Diagonale Straße A→B (149 m Ost, 111 m Nord). Die Länge muss in Metern
    // projiziert werden, sonst wandert der Abzweig einige Meter die Straße entlang.
    const s = { id: 1, lat: 47.999, lon: 9.0 };
    const a = { id: 2, lat: 48.0, lon: 9.0 };
    const b = { id: 3, lat: 48.001, lon: 9.002 };
    const c = { id: 4, lat: 48.002, lon: 9.002 };
    const diagonal = makeNetwork([
      { id: 100, nodes: [s, a] },
      { id: 200, nodes: [a, b] },
      { id: 300, nodes: [b, c] },
    ]);
    // 20 m senkrecht neben der Mitte von A→B.
    const hq = { lat: 48.000644, lon: 9.000841 };

    const route = buildRoute(diagonal, { lat: 47.9995, lon: 9.0 }, hq);
    const turnOff = route[route.length - 2];

    const shortest = distToSegmentM(hq, a, b);
    expect(shortest).toBeGreaterThan(19);
    expect(distToSegmentM(turnOff, a, b)).toBeLessThan(0.05);
    expect(Math.hypot(toMeters(turnOff).x - toMeters(hq).x, toMeters(turnOff).z - toMeters(hq).z))
      .toBeCloseTo(shortest, 1);
  });
});
