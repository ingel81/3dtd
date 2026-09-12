import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Vector3 } from 'three';
import { TowerLosRegistry } from './tower-los-registry';
import { Tower } from '../entities/tower.entity';
import { TOWER_TYPES } from '../configs/tower-types.config';
import type { GlobalRouteGridService } from './world/global-route-grid.service';
import type { ThreeTilesEngine } from '../three-engine';
import type { GameStateManager } from '../managers/game-state.manager';
import type { RouteCell } from '../utils/route-cell';

/**
 * The registry against a fake grid and cubemap. The height-change queue is
 * exercised with the real grid in tower-placement-los.spec.ts, the
 * registration through the service in tower-placement.service.spec.ts;
 * these pin the lifecycle and the stale-answer handoff.
 */
describe('TowerLosRegistry', () => {
  /** Local frame: lon is x, lat is z, height is y. */
  const sync = { geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon, y: height, z: lat }) };

  let grid: {
    listener: ((changed: RouteCell[]) => void) | null;
    off: ReturnType<typeof vi.fn>;
    addCellsChangedListener: ReturnType<typeof vi.fn>;
    isInitialized: () => boolean;
    refineCellsInRadius: ReturnType<typeof vi.fn>;
    registerTower: ReturnType<typeof vi.fn>;
    registerTowerIncremental: ReturnType<typeof vi.fn>;
    unregisterTower: ReturnType<typeof vi.fn>;
    rebuildAirRouteLayer: ReturnType<typeof vi.fn>;
    isTerrainRefreshActive: () => boolean;
  };
  let towerManager: {
    getAll: () => Tower[];
    refreshSelectionViz: ReturnType<typeof vi.fn>;
    onTowerUnregistered: ReturnType<typeof vi.fn>;
  };
  let towers: Tower[];
  let engine: ThreeTilesEngine;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let registry: TowerLosRegistry;

  const runFrames = () => {
    const due = [...frames.values()];
    frames.clear();
    for (const callback of due) callback(0);
  };
  const tower = (lon = 0, lat = 0) => {
    const t = new Tower({ lat, lon, height: 0 }, 'archer');
    towers.push(t);
    return t;
  };
  const cell = (x: number, z: number) =>
    ({ x, z, towerVisibility: new Map(), airVisibility: new Map() }) as unknown as RouteCell;
  const attach = () => registry.attach(engine, { towerManager } as unknown as GameStateManager);

  beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));

    grid = {
      listener: null,
      off: vi.fn(),
      addCellsChangedListener: vi.fn((listener: (changed: RouteCell[]) => void) => {
        grid.listener = listener;
        return grid.off;
      }),
      isInitialized: () => true,
      refineCellsInRadius: vi.fn(),
      registerTower: vi.fn(() => [cell(0, 0)]),
      registerTowerIncremental: vi.fn(() => []),
      unregisterTower: vi.fn(),
      rebuildAirRouteLayer: vi.fn(),
      isTerrainRefreshActive: () => false,
    };
    towers = [];
    towerManager = { getAll: () => towers, refreshSelectionViz: vi.fn(), onTowerUnregistered: vi.fn() };
    const mapper = {
      invalidate: vi.fn(),
      update: vi.fn(),
      getRenderTarget: () => ({}),
      getReferencePos: () => new Vector3(),
      getFarDistance: () => 100,
      readFacesToCpu: () => [],
    };
    engine = { sync, getLosBlockerGroup: () => ({}), getTowerShadowMapper: () => mapper } as unknown as ThreeTilesEngine;
    registry = new TowerLosRegistry(grid as unknown as GlobalRouteGridService, () => false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers nothing before attach and after detach', () => {
    registry.register(tower(), { lat: 0, lon: 0, height: 0 }, 'archer');
    attach();
    registry.detach();
    registry.register(tower(), { lat: 0, lon: 0, height: 0 }, 'archer');

    expect(grid.registerTower).not.toHaveBeenCalled();
    expect(grid.off).toHaveBeenCalledTimes(1);
  });

  it('registers a tower with its range and marks its LOS ready', () => {
    attach();
    const t = tower(5, 7);
    registry.register(t, t.position, 'archer');

    const [id, x, z, range] = grid.registerTower.mock.calls[0];
    expect([id, x, z, range]).toEqual([t.id, 5, 7, TOWER_TYPES.archer.range]);
    expect(grid.refineCellsInRadius).toHaveBeenCalledWith(5, 7, TOWER_TYPES.archer.range);
    expect(t.losReady).toBe(true);
    expect(t.visibleCells).toHaveLength(1);
  });

  it('drops the stale answers of a queued tower before re-resolving it', () => {
    attach();
    const t = tower();
    t.losReady = true;
    const moved = cell(1, 1);
    moved.towerVisibility.set(t.id, true);
    moved.airVisibility.set(t.id, false);
    grid.registerTowerIncremental.mockImplementation(() => {
      // The incremental resolve sees the cell without its old answer.
      expect(moved.towerVisibility.has(t.id)).toBe(false);
      expect(moved.airVisibility.has(t.id)).toBe(false);
      return [moved];
    });

    grid.listener!([moved]);
    runFrames();

    expect(grid.registerTowerIncremental).toHaveBeenCalledTimes(1);
    expect(t.visibleCells).toEqual([moved]);
    expect(grid.rebuildAirRouteLayer).toHaveBeenCalledTimes(1);
  });

  it('runs a scheduled recompute on the next frame, unless the tower was unregistered', () => {
    attach();
    const kept = tower();
    const sold = tower(50, 0);
    registry.scheduleRecompute(kept);
    registry.scheduleRecompute(sold);
    registry.unregister(sold);

    runFrames();
    runFrames();

    expect(grid.registerTowerIncremental.mock.calls.map(([id]) => id)).toEqual([kept.id]);
    expect(towerManager.onTowerUnregistered).toHaveBeenCalledWith(sold);
    expect(grid.unregisterTower).toHaveBeenCalledWith(sold.id);
    expect(sold.visibleCells).toEqual([]);
  });

  it('keeps one subscription across locations and forgets the old queue', () => {
    attach();
    const t = tower();
    registry.scheduleRecompute(t);
    attach();
    runFrames();

    expect(grid.addCellsChangedListener).toHaveBeenCalledTimes(2);
    expect(grid.off).toHaveBeenCalledTimes(1);
    expect(grid.registerTowerIncremental).not.toHaveBeenCalled();
  });

  it('cancels a pending refresh on detach', () => {
    attach();
    registry.scheduleRecompute(tower());
    expect(frames.size).toBe(1);

    registry.detach();

    expect(frames.size).toBe(0);
  });
});
