import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

/**
 * Playtest 567 (fix session 2026-09-14): 66569eca moved the ground LOS probe
 * of a cell the step check put beside a car up above the car. A cell under an
 * eave, which the roof check put on the ground, keeps its probe 1.5 m above
 * that ground: `__corridor.pick()` answers for it as before, and
 * `__corridor.towerCells()` counts it under `clamped`.
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

describe('A cell under an eave in __corridor after 66569eca (playtest 567)', () => {
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

  it('probes the eave cell 1.5 m above its ground, as before 66569eca', () => {
    const eave = grid.getCellAt(20.5, 3.5)!;
    expect(eave.sample).toMatchObject({ clamped: true, stepTop: null });
    expect(eave.terrainHeight).toBe(0);

    const probes = cube.mock.calls.filter((call) => call[3] === eave.x && call[5] === eave.z);
    expect(probes.map((call) => call[4])).toEqual([0 + LOS_VIZ_CONFIG.groundSampleYOffset]);
    expect(getGroundTargetY(eave)).toBe(LOS_VIZ_CONFIG.groundSampleYOffset);
  });

  it('pick() answers for it from that probe: blocked under the eave, visible on the street', () => {
    const eave = grid.getCellAt(20.5, 3.5)!;
    const road = grid.getCellAt(20.5, 1.5)!;
    api().pick();
    picked!({ x: eave.x, y: 0, z: eave.z });

    const rows = vi.mocked(console.table).mock.calls[0][0] as Record<string, unknown>[];
    expect(rows.find((r) => r['x'] === eave.x && r['z'] === eave.z))
      .toMatchObject({ cell: true, clamped: true, heightM: 0, ground: 'blocked' });
    expect(rows.find((r) => r['x'] === road.x && r['z'] === road.z))
      .toMatchObject({ cell: true, clamped: false, ground: 'visible' });
  });

  it('towerCells() still counts it under clamped', () => {
    const eave = grid.getCellAt(20.5, 3.5)!;
    const inRange = grid.getCellsInRange(20, -6, TOWER.combat.range);
    const clamped = inRange.filter((c) => c.sample.clamped);
    expect(clamped).toContain(eave);

    const report = api().towerCells();
    expect(report['clamped']).toBe(clamped.length);
    expect(report['groundBlocked']).toBeGreaterThan(0);
  });
});
