import { afterEach, describe, expect, it, vi } from 'vitest';
import { Group, Vector3 } from 'three';

/**
 * Playtest 569 (fix session 2026-09-14): in DevWorld a left click on the red
 * line where the camera sees it gives `cameraSees: true` in the row at routeM
 * 0. The line is drawn 3 m over its cells there (d8298b31 made
 * PathAndRouteService.routeLineLift the one source), and `__corridor.pick()`
 * looks from the camera at that height, no longer at 1 m.
 *
 * The real route service draws the line; the console reads its lift. The
 * terrain in front of the camera is a crest that hides everything more than
 * half a metre below the line, as DevWorld's steep hills can.
 */
const world = vi.hoisted(() => ({ devWorld: false }));
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  const stubs: Record<string, unknown> = {
    DevWorldService: {
      get isActive() {
        return world.devWorld;
      },
    },
    UIStore: { routesVisible: () => false },
    PathfindingWorkerService: { isWorkerAvailable: false, dispose: () => undefined },
    GlobalRouteGridService: {
      isInitialized: () => true,
      getGroundLocalYAt: (x: number, z: number) => hill(x, z),
      getGrid: () => ({ setBand: () => undefined }),
    },
  };
  return { ...actual, inject: (token: { name?: string }) => stubs[token?.name ?? ''] ?? {} };
});

import { PathAndRouteService } from '../world/path-route.service';
import { OsmStreetService } from '../location/osm-street.service';
import { CorridorConsole, type CorridorConsoleDeps } from './corridor-console';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';
import { makeNetwork } from '../../../test/route-network-fixture';
import type { ThreeTilesEngine } from '../../three-engine';

/** Cell heights: a slope rising 5 cm per metre northwards (local z runs south). */
function hill(_x: number, z: number): number {
  return 12 - 0.05 * z;
}

const ORIGIN = { lat: 48.0, lon: 9.0 };
const M_PER_DEG_LON = METERS_PER_DEGREE_LAT * Math.cos(ORIGIN.lat * DEG_TO_RAD);

function makeEngine(): ThreeTilesEngine {
  const overlay = new Group();
  return {
    getOverlayGroup: () => overlay,
    getTerrainHeightAtGeo: () => 0,
    terrain: {},
    sync: {
      getOrigin: () => ({ ...ORIGIN, height: 0 }),
      geoToLocalSimple: (lat: number, lon: number, h: number) =>
        new Vector3((lon - ORIGIN.lon) * M_PER_DEG_LON, h, -(lat - ORIGIN.lat) * METERS_PER_DEGREE_LAT),
    },
  } as unknown as ThreeTilesEngine;
}

/** The red line of a route from the spawn to the HQ, as the service draws it. */
function drawLine(devWorld: boolean): { service: PathAndRouteService; points: Vector3[] } {
  world.devWorld = devWorld;
  const service = new PathAndRouteService();
  service.initialize(makeEngine(), makeNetwork(), { lat: 48.0011, lon: 9.0025 }, (() => false) as never, new OsmStreetService(), null);
  const layer = (service as unknown as { routeLines: { add: (...args: unknown[]) => void } }).routeLines;
  const add = vi.spyOn(layer, 'add');
  service.showPathFromSpawn({ id: 's1', name: 'Spawn', color: 0xff0000, lat: 47.9993, lon: 9.0 });
  return { service, points: add.mock.calls[0][1] as Vector3[] };
}

/**
 * `__corridor.pick()` and a left click on `point` of the line. The grid has
 * the centre line cell there, at the height the line was drawn over. Gives
 * the row and the height the camera ray aimed at.
 */
function pickOnLine(service: PathAndRouteService, point: Vector3): { row: Record<string, unknown>; aimedAt: number } {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const table = vi.spyOn(console, 'table').mockImplementation(() => undefined);
  let aimedAt = NaN;
  // The crest: a ray to anything more than 0.5 m below the line ends in it
  const blocked = (y: number) => y < point.y - 0.5;
  const engine = {
    sync: {
      localToGeo: (hit: { x: number; z: number }) => ({ lat: hit.x, lon: hit.z }),
      geoToLocalSimple: (lat: number, lon: number) => ({ x: lat, y: 0, z: lon }),
    },
    getCamera: () => ({ position: { x: point.x + 60, y: point.y + 25, z: point.z } }),
    terrain: {
      raycastColumnSample: () => null,
      inspectColumn: () => null,
      raycastLineOfSight: (...args: number[]) => {
        aimedAt = args[4];
        return blocked(args[4]);
      },
    },
  };
  const grid = {
    describeCellsAround: () => [{ x: point.x, z: point.z, routeM: 0, cell: true, heightM: hill(point.x, point.z) }],
  };
  let click: ((hit: { x: number; y: number; z: number }) => void) | null = null;
  const corridor = new CorridorConsole({
    gameState: () => ({
      towerManager: { getSelected: () => null, getSelectionViz: () => null },
      getGlobalRouteGrid: () => ({ getGrid: () => grid }),
    }),
    engineInit: { getEngine: () => engine },
    inputHandler: { armPick: (callback: (hit: { x: number; y: number; z: number }) => void) => { click = callback; } },
    pathRoute: service,
    change: () => '',
    cellReport: { start: () => '', connect: () => undefined, disconnect: () => undefined },
  } as unknown as CorridorConsoleDeps);
  corridor.install();
  ((globalThis as Record<string, unknown>)['__corridor'] as { pick: () => string }).pick();
  click!({ x: point.x, y: point.y, z: point.z });
  corridor.uninstall();
  return { row: (table.mock.calls[0][0] as Record<string, unknown>[])[0], aimedAt };
}

describe('__corridor.pick() on the red line in DevWorld (playtest 569)', () => {
  afterEach(() => {
    world.devWorld = false;
    vi.restoreAllMocks();
  });

  it('draws the line 3 m over its cells in DevWorld, 1 m elsewhere', () => {
    const dev = drawLine(true);
    expect(dev.service.routeLineLift()).toBe(3);
    for (const p of dev.points) expect(p.y).toBeCloseTo(hill(p.x, p.z) + 3, 9);

    const city = drawLine(false);
    expect(city.service.routeLineLift()).toBe(1);
    for (const p of city.points) expect(p.y).toBeCloseTo(hill(p.x, p.z) + 1, 9);
  });

  it('looks at the line where it is drawn: cameraSees true where the camera sees the line', () => {
    const { service, points } = drawLine(true);
    const point = points[Math.floor(points.length / 2)];

    const { row, aimedAt } = pickOnLine(service, point);

    expect(row).toMatchObject({ routeM: 0, cell: true, cameraSees: true });
    expect(aimedAt).toBeCloseTo(point.y, 9);
    // The fixed 1 m of before d8298b31 aimed 2 m below the line, into the crest
    expect(hill(point.x, point.z) + 1).toBeLessThan(point.y - 0.5);
  });
});
