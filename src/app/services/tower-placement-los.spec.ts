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
import { TowerLosRegistry } from './tower-los-registry';
import { GameEventBus } from '../game-engine/game-event-bus';
import { GlobalRouteGridService } from './world/global-route-grid.service';
import { ResearchStore } from '../store/research.store';
import { Tower } from '../entities/tower.entity';
import { TowerTypeId } from '../configs/tower-types.config';
import type { ColumnSample } from '../three-engine/column-sample';
import { getGroundTargetY, type RouteCell } from '../utils/route-cell';

/**
 * A tower registers its LOS on the cells the corridor build froze
 * (CorridorBuild) and keeps those answers: no tile load and no second tower
 * samples a cell again. What still asks for a recompute is a research that
 * gives a tower air targets (scheduleLosRecompute) and a range upgrade.
 * Runs the real grid and the real placement service; the cubemap, the engine
 * and the frame loop are fakes.
 */
describe('TowerPlacementService tower LOS on the frozen cells', () => {
  /** Fake space as in global-route-grid.spec.ts: lon is x, lat is z, height is y. */
  const sync = {
    geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon, y: height, z: lat }),
  };
  /** Straight route along +x; the corridor reaches ~7 m either side. */
  const route = [[{ lat: 0, lon: 0 }, { lat: 0, lon: 60 }]];

  let service: TowerPlacementService;
  let grid: GlobalRouteGridService;
  let researchStore: ResearchStore;
  /** The simulation's research, which the LOS registry reads */
  let research: { airTargetingUnlocked: boolean };
  let towers: Tower[];
  let column: ColumnSample;
  let peek: { depth: number; geometricError: number };
  let blockerGroup: object | null;

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

  /** One frame of the game loop: GameStateManager.update drains the LOS queue. */
  const runFrame = () => service.drainLosQueue();
  /** Enough frames to work off every queued tower. */
  const drainFrames = () => {
    for (let i = 0; i < 20; i++) runFrame();
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
      (c) => c.towerVisibility.get(tower.id) !== (getGroundTargetY(c) < 10),
    );

  beforeEach(() => {
    // The queue is drained by the game loop, never from a frame callback
    vi.stubGlobal('requestAnimationFrame', () => {
      throw new Error('no frame callbacks');
    });

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
    research = { airTargetingUnlocked: false };
    injectionRegistry['ResearchStore'] = researchStore;
    grid = new GlobalRouteGridService();
    injectionRegistry['GlobalRouteGridService'] = grid;
    service = new TowerPlacementService();

    // The cells as a corridor build left them: sampled once, then frozen.
    coarse();
    grid.initialize((() => column) as never, sync as never, () => peek);
    grid.generateFromRoutes(route as never);

    const referencePos = new Vector3();
    const mapper = {
      invalidate: vi.fn(),
      update: vi.fn((tip: Vector3) => referencePos.copy(tip)),
      getRenderTarget: () => ({}),
      getReferencePos: () => referencePos,
      getFarDistance: () => 100,
      readFacesToCpu: () => [],
    };
    blockerGroup = {};
    const engine = {
      sync,
      getLosBlockerGroup: () => blockerGroup,
      getTowerShadowMapper: () => mapper,
    };
    towers = [];
    const gameState = {
      towerManager: {
        getAll: () => towers,
        refreshSelectionViz: vi.fn(),
        onTowerUnregistered: vi.fn(),
      },
      getEventBus: () => new GameEventBus(),
      researchOf: () => research,
    };
    service.initialize(engine as never, {} as never, {} as never, { lat: 0, lon: 0 }, gameState as never);
  });

  afterEach(() => {
    service.dispose();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers a tower on the cells as they are, with answers for their heights', () => {
    const a = place(15, 10);

    expect(a.losReady).toBe(true);
    expect(cellsOf(a).length).toBeGreaterThan(0);
    expect(staleAnswers(a)).toEqual([]);
    // The hull at 85 m stands behind the wall at 10 m: every cell blocked.
    expect(cellsOf(a).every((c) => c.towerVisibility.get(a.id) === false)).toBe(true);
  });

  it('samples no cell and moves no answer when finer tiles come in under a standing tower', () => {
    const a = place(15, 10);
    const heights = cellsOf(a).map((c) => c.terrainHeight);

    // What a tile batch does to the cells now: nothing (VisualizationFacadeService.onTilesLoaded)
    fine();
    drainFrames();

    expect(cellsOf(a).map((c) => c.terrainHeight)).toEqual(heights);
    expect(staleAnswers(a)).toEqual([]);
  });

  it('leaves the cells of the towers standing alone when another tower is placed on finer tiles', () => {
    const a = place(15, 10);
    fine();

    place(40, 10);
    drainFrames();

    expect(cellsOf(a).every((c) => c.terrainHeight === 85)).toBe(true);
    expect(staleAnswers(a)).toEqual([]);
  });

  it('resolves air for a retrofitted tower with the flag of the research manager', () => {
    const gatling = place(15, 10, 'dual-gatling');
    expect(cellsOf(gatling).some((c) => c.airVisibility.has(gatling.id))).toBe(false);

    // ResearchManager sets the flag before research:completed goes out
    research.airTargetingUnlocked = true;
    service.scheduleLosRecompute(gatling);
    drainFrames();

    expect(cellsOf(gatling).every((c) => c.airVisibility.has(gatling.id))).toBe(true);
  });

  it('spreads the queued recomputes over frames, one tower each', () => {
    const queued = [place(15, 10), place(40, 10), place(25, -10)];
    const recompute = vi.spyOn(TowerLosRegistry.prototype, 'recompute');
    for (const tower of queued) service.scheduleLosRecompute(tower);

    runFrame();
    expect(recompute).toHaveBeenCalledTimes(1);
    runFrame();
    expect(recompute).toHaveBeenCalledTimes(2);
    runFrame();
    expect(recompute).toHaveBeenCalledTimes(3);
    expect(new Set(recompute.mock.calls.map(([t]) => t))).toEqual(new Set(queued));
  });

  it('drops a sold tower from the queue', () => {
    const a = place(15, 10);
    const b = place(40, 10);
    const recompute = vi.spyOn(TowerLosRegistry.prototype, 'recompute');
    service.scheduleLosRecompute(a);
    service.scheduleLosRecompute(b);

    service.unregisterTowerFromGrid(b);
    towers.splice(towers.indexOf(b), 1);
    drainFrames();

    expect(recompute.mock.calls.map(([t]) => t)).toEqual([a]);
  });

  it('keeps a tower queued while its recompute cannot run', () => {
    const a = place(15, 10);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    service.scheduleLosRecompute(a);

    blockerGroup = null;
    runFrame();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no LOS blocker group'));

    blockerGroup = {};
    drainFrames();
    // Dropped from the queue on the failed attempt, its answers would have
    // stayed as they were for good.
    expect(staleAnswers(a)).toEqual([]);
  });

  it('lets a direct recompute settle what was queued for the tower', () => {
    const a = place(15, 10);
    const b = place(40, 10);
    const recompute = vi.spyOn(TowerLosRegistry.prototype, 'recompute');
    service.scheduleLosRecompute(a);
    service.scheduleLosRecompute(b);

    // e.g. a range upgrade before the next frame
    service.recomputeTowerLOS(a);
    drainFrames();

    expect(recompute.mock.calls.map(([t]) => t)).toEqual([a, b]);
  });
});
