import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { Vector3 } from 'three';

// Angular DI replaced by a registry: inject() hands out what the test put there.
const injectionRegistry: Record<string, unknown> = {};
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
    effect: () => ({ destroy: () => undefined }),
    inject: (token: { name?: string }) => injectionRegistry[token?.name ?? ''],
  };
});

// Stand-in for the cubemap: a wall at 10 m, so a cell's visibility follows
// its height (same fake as in global-route-grid.spec.ts).
vi.mock('../utils/gpu-cube-resolve', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isCubeVisible: (...args: number[]) => args[4] < 10,
}));

import { TowerPlacementService } from './tower-placement.service';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { ResearchStore } from '../store/research.store';
import { Tower } from '../entities/tower.entity';
import { TowerTypeId } from '../configs/tower-types.config';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import type { ColumnSample } from '../three-engine/column-sample';
import type { RouteCell } from '../utils/global-route-grid';

/**
 * Per-tower LOS has to follow the cell heights as tiles refine, without
 * re-rendering a tower's cubemap more often than needed. Runs the real grid
 * and the real placement service; the cubemap, the engine and the frame loop
 * are fakes.
 */
describe('TowerPlacementService tower LOS refresh', () => {
  /** Fake space as in global-route-grid.spec.ts: lon is x, lat is z, height is y. */
  const sync = {
    geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon, y: height, z: lat }),
  };
  /** Straight route along +x; the corridor reaches ~7 m either side. */
  const route = [[{ lat: 0, lon: 0 }, { lat: 0, lon: 60 }]];

  let service: TowerPlacementService;
  let grid: GlobalRouteGridService;
  let researchStore: ResearchStore;
  let towers: Tower[];
  let column: ColumnSample;
  let peek: { depth: number; geometricError: number };
  let frames: FrameRequestCallback[];

  /** Block-level hull: what the city looks like before refinement. Ground answers: blocked. */
  const coarse = () => {
    column = { groundY: 85, topY: 85, tileDepth: 14, tileGeometricError: 40 };
    peek = { depth: 14, geometricError: 40 };
  };
  /** A finer tile reports the real street. Ground answers: visible. */
  const fine = () => {
    column = { groundY: 3, topY: 40, tileDepth: 21, tileGeometricError: 2 };
    peek = { depth: 21, geometricError: 2 };
  };

  const runFrame = () => {
    const due = frames;
    frames = [];
    for (const callback of due) callback(0);
  };
  /** Run frames until nothing is scheduled any more. */
  const drainFrames = () => {
    for (let i = 0; i < 100 && frames.length > 0; i++) runFrame();
  };

  const place = (lon: number, lat: number, typeId: TowerTypeId = 'archer'): Tower => {
    const position = { lat, lon, height: 0 };
    const tower = new Tower(position, typeId);
    towers.push(tower);
    service.registerTowerOnGrid(tower, position, typeId);
    return tower;
  };

  const cellsOf = (tower: Tower): RouteCell[] =>
    grid.getCellsInRange(tower.position.lon, tower.position.lat, tower.combat.range);

  /** Cells in range whose ground answer does not match the cell's current height. */
  const staleAnswers = (tower: Tower): RouteCell[] =>
    cellsOf(tower).filter(
      (c) => c.towerVisibility.get(tower.id) !== (c.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset < 10),
    );

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    // Only what the build-mode fields and dispose() touch.
    injectionRegistry['UIStore'] = {
      buildMode: signal(false),
      selectedTowerType: signal(null),
      buildValidationReason: signal(null),
      perTowerLosFilter: signal('both'),
    };
    injectionRegistry['AssetManagerService'] = {};
    injectionRegistry['TowerDefenseStore'] = {};
    injectionRegistry['PathAndRouteService'] = {};
    researchStore = new ResearchStore();
    injectionRegistry['ResearchStore'] = researchStore;
    grid = new GlobalRouteGridService();
    injectionRegistry['GlobalRouteGridService'] = grid;
    service = new TowerPlacementService();

    coarse();
    grid.initialize((() => column) as never, sync as never, () => peek);
    grid.generateFromRoutes(route as never);
    grid.updateTerrainHeights();

    const referencePos = new Vector3();
    const mapper = {
      invalidate: vi.fn(),
      update: vi.fn((tip: Vector3) => referencePos.copy(tip)),
      getRenderTarget: () => ({}),
      getReferencePos: () => referencePos,
      getFarDistance: () => 100,
      readFacesToCpu: () => [],
    };
    const engine = {
      sync,
      getLosBlockerGroup: () => ({}),
      getTowerShadowMapper: () => mapper,
    };
    towers = [];
    const gameState = {
      towerManager: {
        getAll: () => towers,
        refreshSelectionViz: vi.fn(),
        onTowerUnregistered: vi.fn(),
      },
    };
    service.initialize(engine as never, {} as never, {} as never, { lat: 0, lon: 0 }, gameState as never);
  });

  afterEach(() => {
    service.dispose();
    vi.unstubAllGlobals();
  });

  it('recomputes each covering tower once per sweep, not once per slice', () => {
    const a = place(15, 10);
    const b = place(40, 10);
    const recompute = vi.spyOn(service, 'recomputeTowerLOS');

    fine();
    grid.beginTerrainHeightRefresh();
    let slices = 0;
    for (;;) {
      // A zero budget yields every 32 cells: one slice per frame.
      grid.stepTerrainHeightRefresh(0);
      if (!grid.isTerrainRefreshActive()) break;
      slices++;
      runFrame();
    }
    expect(slices).toBeGreaterThan(1);
    expect(recompute).not.toHaveBeenCalled();
    // Until then the towers keep their old answers instead of losing them.
    expect(cellsOf(a).every((c) => c.towerVisibility.has(a.id))).toBe(true);

    drainFrames();
    expect(recompute).toHaveBeenCalledTimes(2);
    expect(new Set(recompute.mock.calls.map(([t]) => t))).toEqual(new Set([a, b]));
    expect(staleAnswers(a)).toEqual([]);
    expect(staleAnswers(b)).toEqual([]);
  });

  it('spreads the recomputes over frames, one tower each', () => {
    const towersInRange = [place(15, 10), place(40, 10), place(25, -10)];
    fine();
    grid.updateTerrainHeights();
    const recompute = vi.spyOn(service, 'recomputeTowerLOS');

    runFrame();
    expect(recompute).toHaveBeenCalledTimes(1);
    runFrame();
    expect(recompute).toHaveBeenCalledTimes(2);
    runFrame();
    expect(recompute).toHaveBeenCalledTimes(3);
    expect(frames).toHaveLength(0);
    // In the end every tower answers for the heights its cells have now.
    for (const tower of towersInRange) expect(staleAnswers(tower)).toEqual([]);
  });

  it('drops a sold tower from the queue', () => {
    const a = place(15, 10);
    const b = place(40, 10);
    fine();
    grid.updateTerrainHeights();
    const recompute = vi.spyOn(service, 'recomputeTowerLOS');

    service.unregisterTowerFromGrid(b);
    towers.splice(towers.indexOf(b), 1);
    drainFrames();

    expect(recompute.mock.calls.map(([t]) => t)).toEqual([a]);
  });

  it('lets a direct recompute settle what was queued for the tower', () => {
    const a = place(15, 10);
    const b = place(40, 10);
    fine();
    grid.updateTerrainHeights();
    const recompute = vi.spyOn(service, 'recomputeTowerLOS');

    // e.g. a range upgrade before the next frame
    service.recomputeTowerLOS(a);
    expect(staleAnswers(a)).toEqual([]);
    drainFrames();

    expect(recompute.mock.calls.map(([t]) => t)).toEqual([a, b]);
    expect(staleAnswers(b)).toEqual([]);
  });
});
