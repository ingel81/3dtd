import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Group, Vector3 } from 'three';

// Zellen-Stub, pro Test steuerbar: `ready` = Grid initialisiert, `cellY` = Zellhöhe.
const grid = vi.hoisted(() => ({
  ready: false,
  cellY: (_x: number, _z: number): number | null => null,
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
 * Freiraum quer zur Route, den der Engine-Ersatz meldet, pro Test steuerbar:
 * lokale x/z der Messstation, `max` = Suchweite. `null` = kein feines Tile.
 */
let clearanceAt: (x: number, z: number, max: number) => number | null = (_x, _z, max) => max;

/** Minimaler Engine-Ersatz: flaches Gelände, Geo→Lokal als Plattkarte um ORIGIN. */
function makeEngine(): ThreeTilesEngine {
  const overlay = new Group();
  return {
    getOverlayGroup: () => overlay,
    getTerrainHeightAtGeo: () => 0,
    // Höhe des gelben Overlays: flaches Gelände.
    getGroundHeightEstimate: () => 0,
    measureStreetClearance: (x: number, z: number, _ax: number, _az: number, _h: number, max: number) =>
      clearanceAt(x, z, max),
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
  streets: { id: number; type?: string; width?: number; lanes?: number; bridge?: string; nodes: StreetNode[] }[],
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
    [],
  );
  service.showPathFromSpawn(spawnPointAt(spawn));
  return service;
}

function spawnPointAt(spawn: { lat: number; lon: number }): SpawnPoint {
  return { id: 's1', name: 'Spawn', color: 0xff0000, lat: spawn.lat, lon: spawn.lon };
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
    clearanceAt = (_x, _z, max) => max;
    network = makeNetwork([
      { id: 100, nodes: [n10, n1] },
      { id: 200, nodes: [n1, n2, n3] },
      { id: 300, nodes: [n3, n30] },
    ]);
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
      // 12 m width tag, a 2 m footway clamped to two cells, the leg to the
      // HQ keeps the footway's, the HQ ends the route.
      expect(route.map((p) => p.corridorHalfWidth)).toEqual([2.75, 6, 6, 2, 2, undefined]);
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

      it('narrows the corridor where facades stand closer than the street width', () => {
        // 2.6 m free space from 40 to 80 m north of n1, on way 200.
        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && northOfN1(z) > 40 && northOfN1(z) < 80 ? 2.6 : max);
        const service = buildRouteService(network, spawn, hq);

        expect(service.measureStreetClearance()).toBe(true);
        service.showPathFromSpawn(spawnPointAt(spawn));
        const route = service.getCachedPath('s1')!;

        const narrow = route.filter((p) => p.corridorHalfWidth === 2.5);
        expect(narrow).toHaveLength(1);
        const start = northOfN1(-toMeters(narrow[0]).z);
        expect(start).toBeGreaterThan(38);
        expect(start).toBeLessThan(42);
        // The rest of way 200 keeps its 12 m, and the diagnostics show the range.
        expect(route.filter((p) => p.corridorHalfWidth === 6).length).toBeGreaterThanOrEqual(2);
        expect(service.describeRoutes()[1]).toMatchObject({ way: 200, corridorM: '5.0-12.0' });
      });

      it('ignores something narrow that stands in the way for a single station', () => {
        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && Math.abs(northOfN1(z) - 50) < 1 ? 1 : max);
        const service = buildRouteService(network, spawn, hq);
        expect(service.measureStreetClearance()).toBe(false);
      });

      it('keeps the street width where no fine tile is loaded, and tries again later', () => {
        clearanceAt = () => null;
        const service = buildRouteService(network, spawn, hq);
        expect(service.measureStreetClearance()).toBe(false);

        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && northOfN1(z) > 40 && northOfN1(z) < 80 ? 2.6 : max);
        expect(service.measureStreetClearance()).toBe(true);
      });

      it('measures a segment once', () => {
        let calls = 0;
        clearanceAt = (_x, _z, max) => {
          calls++;
          return max;
        };
        const service = buildRouteService(network, spawn, hq);
        service.measureStreetClearance();
        expect(calls).toBeGreaterThan(100);

        calls = 0;
        service.measureStreetClearance();
        expect(calls).toBe(0);
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
