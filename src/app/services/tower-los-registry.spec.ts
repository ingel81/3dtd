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
 * The registry against a fake grid and cubemap. The registration on the
 * frozen cells runs with the real grid in tower-placement-los.spec.ts and
 * through the service in tower-placement.service.spec.ts; these pin the
 * lifecycle and the recompute queue.
 */
describe('TowerLosRegistry', () => {
  /** Local frame: lon is x, lat is z, height is y. */
  const sync = { geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon, y: height, z: lat }) };

  let grid: {
    isInitialized: () => boolean;
    registerTower: ReturnType<typeof vi.fn>;
    registerTowerIncremental: ReturnType<typeof vi.fn>;
    unregisterTower: ReturnType<typeof vi.fn>;
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
      isInitialized: () => true,
      registerTower: vi.fn(() => [cell(0, 0)]),
      registerTowerIncremental: vi.fn(() => []),
      unregisterTower: vi.fn(),
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
  });

  it('registers a tower on the cells as they are and marks its LOS ready', () => {
    attach();
    const t = tower(5, 7);
    registry.register(t, t.position, 'archer');

    const [id, x, z, range] = grid.registerTower.mock.calls[0];
    expect([id, x, z, range]).toEqual([t.id, 5, 7, TOWER_TYPES.archer.range]);
    expect(t.losReady).toBe(true);
    expect(t.visibleCells).toHaveLength(1);
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

  it('forgets the queue of the old location on attach', () => {
    attach();
    const t = tower();
    registry.scheduleRecompute(t);
    attach();
    runFrames();

    expect(grid.registerTowerIncremental).not.toHaveBeenCalled();
  });

  it('keeps a tower queued while its recompute cannot run', () => {
    const blocked = { ...engine, getLosBlockerGroup: () => null } as unknown as ThreeTilesEngine;
    registry.attach(blocked, { towerManager } as unknown as GameStateManager);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registry.scheduleRecompute(tower());

    runFrames();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no LOS blocker group'));
    expect(frames.size).toBe(1);
  });

  it('cancels a pending refresh on detach', () => {
    attach();
    registry.scheduleRecompute(tower());
    expect(frames.size).toBe(1);

    registry.detach();

    expect(frames.size).toBe(0);
  });

  describe('the log of a recompute that takes most cells away', () => {
    const seen = () => Array.from({ length: 10 }, (_, i) => cell(i, 0));
    const recomputeTo = (t: Tower, cells: RouteCell[]) => {
      grid.registerTowerIncremental.mockReturnValueOnce(cells);
      registry.scheduleRecompute(t);
      runFrames();
    };

    it('warns once per drop, with the trigger and what the cube saw, and again only after the cells came back', () => {
      attach();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const t = tower();
      t.losReady = true;
      t.visibleCells = seen();

      recomputeTo(t, []);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain(`${t.id} archer: 0 of 10 visible cells left after a LOS recompute (asked for)`);
      expect(line).toContain('geometry within 2 m of the tip');

      // Still down: no second line
      t.visibleCells = seen();
      recomputeTo(t, [cell(0, 0)]);
      expect(warn).toHaveBeenCalledTimes(1);

      // Back, then down again
      recomputeTo(t, seen());
      recomputeTo(t, []);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('names a direct call as the trigger', () => {
      attach();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const t = tower();
      t.losReady = true;
      t.visibleCells = seen();

      grid.registerTowerIncremental.mockReturnValueOnce([]);
      registry.recompute(t);

      expect(String(warn.mock.calls[0][0])).toContain('LOS recompute (direct call)');
    });

    it('stays quiet when a recompute moves a few answers or the tower saw only a few cells', () => {
      attach();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const t = tower();
      t.losReady = true;
      t.visibleCells = seen();
      recomputeTo(t, seen().slice(0, 7));

      const small = tower(50, 0);
      small.losReady = true;
      small.visibleCells = seen().slice(0, 5);
      recomputeTo(small, []);

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
