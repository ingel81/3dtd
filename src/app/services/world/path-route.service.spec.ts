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
 * (unten, oben), `null` = kein feines Tile.
 */
type Hits = number | number[];
type Clearance = number | { left: Hits; right: Hits } | null;
let clearanceAt: (x: number, z: number, max: number) => Clearance = (_x, _z, max) => max;

/** Minimaler Engine-Ersatz: flaches Gelände, Geo→Lokal als Plattkarte um ORIGIN. */
function makeEngine(): ThreeTilesEngine {
  const overlay = new Group();
  return {
    getOverlayGroup: () => overlay,
    getTerrainHeightAtGeo: () => 0,
    terrain: {
      // Höhe des gelben Overlays: flaches Gelände.
      getGroundHeightEstimate: () => 0,
      measureStreetClearance: (
        x: number, z: number, _ax: number, _az: number, heights: readonly number[], max: number,
      ): StationProbe => {
        const free = clearanceAt(x, z, max);
        if (free === null) return { unmeasured: 'coarse tile', tileError: 20, left: [], right: [] };
        const perHeight = (hits: Hits) => (typeof hits === 'number' ? heights.map(() => hits) : hits);
        const sides = typeof free === 'number' ? { left: free, right: free } : free;
        return { unmeasured: null, tileError: 2, left: perHeight(sides.left), right: perHeight(sides.right) };
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

        expect(service.measureStreetClearance()).toBe(true);
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

        expect(service.measureStreetClearance()).toBe(true);
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
        service.measureStreetClearance();
        service.showPathFromSpawn(spawnPointAt(spawn));
        expect(service.getCachedPath('s1')!.map((p) => p.corridorLeft)).toEqual([7, 7, 7, 7, 2.75, undefined]);
      });

      it('keeps the street width where no fine tile is loaded, and tries again later', () => {
        clearanceAt = () => null;
        const service = buildRouteService(network, spawn, hq);
        expect(service.measureStreetClearance()).toBe(false);

        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && northOfN1(z) > 40 && northOfN1(z) < 80 ? 2.6 : max);
        expect(service.measureStreetClearance()).toBe(true);
      });

      it('measures the stations again that had no fine tile, and only those', () => {
        // Facades 2.6 m off from 40 to 80 m north of n1, on way 200. The first
        // run has fine tiles only up to 60 m.
        const facades = (x: number, z: number, max: number) =>
          Math.abs(x) < 1 && northOfN1(z) > 40 && northOfN1(z) < 80 ? 2.6 : max;
        clearanceAt = (x, z, max) => (Math.abs(x) < 1 && northOfN1(z) > 60 && northOfN1(z) < 110 ? null : facades(x, z, max));
        const service = buildRouteService(network, spawn, hq);
        expect(service.measureStreetClearance()).toBe(true);

        const remeasured: number[] = [];
        clearanceAt = (x, z, max) => {
          if (Math.abs(x) < 1) remeasured.push(northOfN1(z));
          return facades(x, z, max);
        };
        expect(service.measureStreetClearance()).toBe(true);
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
        service.measureStreetClearance();
        expect(calls).toBeGreaterThan(100);

        calls = 0;
        service.measureStreetClearance();
        expect(calls).toBe(0);
      });

      it('explains the width at the station nearest to a point', () => {
        // On way 200 from 20 to 80 m north of n1: a van 2 m to the right in
        // front of a facade at 6 m; on the left the rays hit nothing.
        clearanceAt = (x, z, max) =>
          Math.abs(x) < 1 && Math.abs(northOfN1(z) - 50) < 30 ? { left: max, right: [2, 6] } : max;
        const service = buildRouteService(network, spawn, hq);
        service.measureStreetClearance();
        service.showPathFromSpawn(spawnPointAt(spawn));

        const n1Local = toMeters(n1);
        const why = service.explainCorridorAt(n1Local.x, -(n1Local.z + 50))!;
        expect(why).toMatchObject({ route: 's1', way: 200, streetWidthM: 12, widthSource: 'width', onStreet: true, unmeasured: null });
        expect(why.distanceM).toBeLessThan(1.5);
        expect(why.sides[0]).toMatchObject({
          side: 'left', lowHitM: 7, highHitM: 7, wall: false, halfWidthM: 7, inUseM: 7, rule: 'no wall within the maximum',
        });
        // The van stops only the low ray: the wall is the facade at 6 m, less the margin.
        expect(why.sides[1]).toMatchObject({
          side: 'right', lowHitM: 2, highHitM: 6, wall: true, freeM: 6, halfWidthM: 5.5, inUseM: 5.5, rule: 'wall less margin',
        });
        expect(why.nearby.filter((s) => s.here)).toHaveLength(1);
        expect(why.nearby.length).toBe(9);
      });

      it('says why a station has no measurement', () => {
        clearanceAt = () => null;
        const service = buildRouteService(network, spawn, hq);
        service.measureStreetClearance();

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
        service.measureStreetClearance();
        expect(service.hasUnmeasuredStations()).toBe(true);

        // Finer tiles later: the stations get measured and widen the corridor there.
        clearanceAt = (_x, _z, max) => max;
        expect(service.measureStreetClearance()).toBe(true);
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
        expect(service.measureStreetClearance()).toBe(true);
        service.showPathFromSpawn(spawnPointAt(spawn));
        const route = service.getCachedPath('s1')!;

        expect(probedOn200).toEqual([]);
        // n10, n1, n2, n3, turn-off on way 300, HQ: way 100 measured, 200
        // and 300 at their street width, the leg to the HQ inherits it.
        expect(route.map((p) => p.inTunnel === true)).toEqual([false, true, true, true, false, false]);
        expect(route.map((p) => p.corridorLeft)).toEqual([4.5, 6, 6, 2.75, 2.75, undefined]);

        const n1Local = toMeters(n1);
        const why = service.explainCorridorAt(n1Local.x, -(n1Local.z + 50))!;
        expect(why).toMatchObject({ way: 200, inTunnel: true, unmeasured: 'tunnel or covered: not measured' });
        expect(why.sides[0]).toMatchObject({ halfWidthM: 6, rule: 'tunnel or covered: street width' });
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
