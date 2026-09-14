import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

/**
 * Playtest 567 (fix session 2026-09-14), after the user decision to leave the
 * orange cells out: a cell under an eave is no longer put on the ground. It
 * keeps the height its column finds, the eave, and the grid names it as a
 * cell no enemy could walk to; the route service then ends the corridor
 * before it (corridor-walk.ts, integration/corridor-walk.spec.ts). Where the
 * corridor still holds such a cell (the grid alone here, as under towers),
 * `__corridor.pick()` shows it as `walkable: false`, `__corridor.towerCells()`
 * counts it under `unwalkable`, and its ground LOS probe is 1.5 m above the
 * eave.
 *
 * The real grid with its sampler and LOS resolve, the console on it. The
 * cubemap is a stand-in: an eave 6 m up over the pavement south of z = 2.5
 * hides every ray that ends under it.
 */
vi.mock('./gpu-cube-resolve', () => ({
  isCubeVisible: vi.fn((...args: number[]) => !(args[5] > 2.5 && args[4] < 6)),
}));

import { isCubeVisible } from './gpu-cube-resolve';
import { GlobalRouteGrid } from './global-route-grid';
import { getGroundTargetY } from './route-cell';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import { CorridorConsole, type CorridorConsoleDeps } from '../services/debug/corridor-console';
import type { RouteWaypoint } from '../models/game.types';

const cube = isCubeVisible as unknown as MockInstance;
const column = (y: number) => ({ groundY: y, topY: y, tileDepth: 20, tileGeometricError: 2 });
/** Street at 0 m; south of z = 2.5 a house whose eave, 6 m up, is all a column finds. */
const street = (_x: number, z: number) => column(z > 2.5 ? 6 : 0);
const at = (x: number, z: number): RouteWaypoint => ({ lat: z, lon: x, corridorLeft: 4, corridorRight: 4 }) as RouteWaypoint;
/** Local x, z are lon, lat here, both in the grid and in the console's engine. */
const coordinateSync = { geoToLocalSimple: (lat: number, lon: number) => ({ x: lon, y: 0, z: lat }) } as never;

/** A tower in front of the house, across the street. */
const TOWER = { id: 't1', position: { lat: -6, lon: 20, height: 0 }, combat: { range: 12 } };

describe('A cell under an eave in __corridor (playtest 567, orange cells left out)', () => {
  let grid: GlobalRouteGrid;
  let corridor: CorridorConsole;
  let picked: ((hit: { x: number; y: number; z: number }) => void) | null;
  const api = () => (globalThis as Record<string, unknown>)['__corridor'] as {
    pick: () => string;
    towerCells: () => Record<string, unknown>;
  };

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'table').mockImplementation(() => undefined);
    cube.mockClear();
    grid = new GlobalRouteGrid();
    grid.initialize(street as never, coordinateSync);
    // An eastbound street along z = 1, 4 m either side
    grid.generateFromRoutes([[at(0, 1), at(40, 1)]]);
    grid.registerTower(TOWER.id, 20, -6, TOWER.combat.range, { referencePos: { x: 20, y: 8, z: -6 } } as never);

    picked = null;
    const engine = {
      sync: {
        localToGeo: (hit: { x: number; z: number }) => ({ lat: hit.z, lon: hit.x }),
        geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon, y: height, z: lat }),
      },
      getTowerShadowMapper: () => ({ getReferencePos: () => ({ x: 20, z: -6 }) }),
      getCamera: () => ({ position: { x: 20, y: 60, z: -40 } }),
      terrain: { raycastColumnSample: street, raycastLineOfSight: () => false },
    };
    const towerManager = { getSelected: () => TOWER, getById: () => TOWER, getSelectionViz: () => null };
    corridor = new CorridorConsole({
      gameState: () => ({ towerManager, getGlobalRouteGrid: () => ({ getGrid: () => grid }) }),
      engineInit: { getEngine: () => engine },
      inputHandler: { armPick: (callback: (hit: { x: number; y: number; z: number }) => void) => { picked = callback; } },
      pathRoute: { explainCorridorAt: () => null, routeLineLift: () => 1 },
      change: () => '',
    } as unknown as CorridorConsoleDeps);
    corridor.install();
  });

  afterEach(() => {
    corridor.uninstall();
    vi.restoreAllMocks();
  });

  it('keeps the eave cell at the eave, names it, and probes 1.5 m above it', () => {
    const eave = grid.getCellAt(20.5, 3.5)!;
    expect(eave.terrainHeight).toBe(6);
    expect(grid.unwalkableCells()).toContain(eave);

    const probes = cube.mock.calls.filter((call) => call[3] === eave.x && call[5] === eave.z);
    expect(probes.map((call) => call[4])).toEqual([6 + LOS_VIZ_CONFIG.groundSampleYOffset]);
    expect(getGroundTargetY(eave)).toBe(6 + LOS_VIZ_CONFIG.groundSampleYOffset);
  });

  it('pick() shows it as a cell no enemy could walk to, the street before it as walkable', () => {
    const eave = grid.getCellAt(20.5, 3.5)!;
    const pavement = grid.getCellAt(20.5, -0.5)!;
    api().pick();
    picked!({ x: eave.x, y: 0, z: eave.z });

    const rows = vi.mocked(console.table).mock.calls[0][0] as Record<string, unknown>[];
    expect(rows.find((r) => r['x'] === eave.x && r['z'] === eave.z))
      .toMatchObject({ cell: true, walkable: false, heightM: 6 });
    picked = null;
    api().pick();
    picked!({ x: pavement.x, y: 0, z: pavement.z });
    const street = vi.mocked(console.table).mock.calls.at(-2)![0] as Record<string, unknown>[];
    expect(street.find((r) => r['x'] === pavement.x && r['z'] === pavement.z))
      .toMatchObject({ cell: true, walkable: true, heightM: 0, ground: 'visible' });
  });

  it('towerCells() counts it under unwalkable', () => {
    const eave = grid.getCellAt(20.5, 3.5)!;
    const inRange = grid.getCellsInRange(20, -6, TOWER.combat.range);
    const unwalkable = grid.unwalkableCells().filter((c) => inRange.includes(c));
    expect(unwalkable).toContain(eave);

    const report = api().towerCells();
    expect(report['unwalkable']).toBe(unwalkable.length);
    expect(report['clamped']).toBeUndefined();
  });
});
