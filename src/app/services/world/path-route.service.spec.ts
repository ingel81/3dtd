import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Group, Vector3 } from 'three';

// inject() liefert pro Service-Klasse einen Stub. PathAndRouteService braucht
// nur wenige Felder davon; OsmStreetService speichert seinen Cache-Service nur.
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  const stubs: Record<string, unknown> = {
    DevWorldService: { isActive: false },
    UIStore: { routesVisible: () => false },
    PathfindingWorkerService: { isWorkerAvailable: false, dispose: () => undefined },
    GlobalRouteGridService: { isInitialized: () => false, getGroundLocalYAt: () => null },
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

/** Minimaler Engine-Ersatz: flaches Gelände, Geo→Lokal als Plattkarte um ORIGIN. */
function makeEngine(): ThreeTilesEngine {
  const overlay = new Group();
  return {
    getOverlayGroup: () => overlay,
    getTerrainHeightAtGeo: () => 0,
    sync: {
      getOrigin: () => ({ ...ORIGIN, height: 0 }),
      geoToLocalSimple: (lat: number, lon: number, h: number) => {
        const m = toMeters({ lat, lon });
        return new Vector3(m.x, h, -m.z);
      },
    },
  } as unknown as ThreeTilesEngine;
}

function makeNetwork(streets: { id: number; type?: string; nodes: StreetNode[] }[]): StreetNetwork {
  const nodes = new Map<number, StreetNode>();
  for (const s of streets) for (const n of s.nodes) nodes.set(n.id, n);
  return {
    streets: streets.map((s) => ({ id: s.id, name: `Way ${s.id}`, type: s.type ?? 'residential', nodes: s.nodes })),
    nodes,
    bounds: { minLat: 47.99, maxLat: 48.01, minLon: 8.99, maxLon: 9.01 },
  };
}

function buildRoute(network: StreetNetwork, spawn: { lat: number; lon: number }, hq: { lat: number; lon: number }) {
  const service = new PathAndRouteService();
  service.initialize(
    makeEngine(),
    network,
    { lat: hq.lat, lon: hq.lon },
    (() => false) as never,
    new OsmStreetService(),
    [],
  );
  const spawnPoint: SpawnPoint = { id: 's1', name: 'Spawn', color: 0xff0000, lat: spawn.lat, lon: spawn.lon };
  service.showPathFromSpawn(spawnPoint);
  return service.getCachedPath('s1')!;
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
