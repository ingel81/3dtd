import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Vector3 } from 'three';
import { TowerLosRegistry } from './tower-los-registry';
import { Tower } from '../entities/tower.entity';
import { TOWER_TYPES } from '../configs/tower-types.config';
import type { GlobalRouteGridService } from './world/global-route-grid.service';
import type { ThreeTilesEngine } from '../three-engine';
import type { GameStateManager } from '../managers/game-state.manager';
import type { RouteCell } from '../utils/route-cell';
import type { LosMask } from '../utils/los-mask';
import { GameEventBus, type GameEvent } from '../game-engine/game-event-bus';

/**
 * The registry against a fake grid and cubemap. The registration on the
 * frozen cells runs with the real grid in tower-placement-los.spec.ts and
 * through the service in tower-placement.service.spec.ts; these pin the
 * lifecycle, the masks and events and the recompute queue.
 */
describe('TowerLosRegistry', () => {
  /** Local frame: lon is x, lat is z, height is y. */
  const sync = { geoToLocalSimple: (lat: number, lon: number, height: number) => ({ x: lon, y: height, z: lat }) };

  let grid: {
    isInitialized: () => boolean;
    registerTower: ReturnType<typeof vi.fn>;
    registerTowerIncremental: ReturnType<typeof vi.fn>;
    unregisterTower: ReturnType<typeof vi.fn>;
    encodeLosMask: ReturnType<typeof vi.fn>;
    applyLosMask: ReturnType<typeof vi.fn>;
  };
  let towerManager: {
    getAll: () => Tower[];
    refreshSelectionViz: ReturnType<typeof vi.fn>;
    onTowerUnregistered: ReturnType<typeof vi.fn>;
  };
  let towers: Tower[];
  let engine: ThreeTilesEngine;
  let bus: GameEventBus;
  let resolved: Extract<GameEvent, { type: 'tower:los-resolved' }>[];
  let registry: TowerLosRegistry;

  /** One frame of the game loop: GameStateManager.update drains the queue. */
  const runFrames = () => registry.drainLosQueue();
  const tower = (lon = 0, lat = 0) => {
    const t = new Tower({ lat, lon, height: 0 }, 'archer');
    towers.push(t);
    return t;
  };
  const cell = (x: number, z: number) =>
    ({ x, z, towerVisibility: new Map(), airVisibility: new Map() }) as unknown as RouteCell;
  const gameState = () => ({ towerManager, getEventBus: () => bus }) as unknown as GameStateManager;
  const attach = () => registry.attach(engine, gameState());
  const maskOf = (range: number, ground: boolean, air: boolean): LosMask =>
    ({ range, ground, air, bits: new Uint8Array([range & 0xff]) });

  beforeEach(() => {
    // The queue is drained by the game loop, never from a frame callback:
    // a hidden tab runs the loop from the heartbeat worker without frames.
    vi.stubGlobal('requestAnimationFrame', () => {
      throw new Error('no frame callbacks');
    });

    grid = {
      isInitialized: () => true,
      registerTower: vi.fn(() => [cell(0, 0)]),
      registerTowerIncremental: vi.fn(() => []),
      unregisterTower: vi.fn(),
      encodeLosMask: vi.fn((_id: string, _x: number, _z: number, range: number, ground: boolean, air: boolean) =>
        maskOf(range, ground, air)),
      applyLosMask: vi.fn(() => [cell(1, 1), cell(2, 2)]),
    };
    bus = new GameEventBus();
    resolved = [];
    bus.on('tower:los-resolved', (event) => resolved.push(event));
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

  it('keeps the answers of a placement as a mask on the tower and announces it', () => {
    attach();
    const t = tower(5, 7);
    registry.register(t, t.position, 'archer');

    expect(grid.encodeLosMask).toHaveBeenCalledWith(t.id, 5, 7, TOWER_TYPES.archer.range, true, true);
    expect(t.losMask).toEqual(maskOf(TOWER_TYPES.archer.range, true, true));
    expect(resolved).toEqual([{ type: 'tower:los-resolved', towerId: t.id, mask: t.losMask, reason: 'place' }]);
  });

  it('takes a new mask after a range upgrade, at the new range', () => {
    attach();
    const t = tower(5, 7);
    registry.register(t, t.position, 'archer');
    t.combat.range = 45;
    registry.recompute(t);

    expect(t.losMask?.range).toBe(45);
    expect(resolved.map((e) => e.reason)).toEqual(['place', 'upgrade']);
    expect(resolved[1].mask).toBe(t.losMask);
  });

  it('registers a tower from a mask without the cube and announces nothing', () => {
    attach();
    const t = tower(5, 7);
    const mask = maskOf(30, true, true);
    const mapper = engine.getTowerShadowMapper() as unknown as { update: ReturnType<typeof vi.fn> };

    registry.registerFromMask(t, mask);

    expect(grid.applyLosMask).toHaveBeenCalledWith(t.id, 5, 7, mask);
    expect(mapper.update).not.toHaveBeenCalled();
    expect(grid.registerTower).not.toHaveBeenCalled();
    expect(t.visibleCells).toHaveLength(2);
    expect(t.losReady).toBe(true);
    expect(t.losMask).toBe(mask);
    expect(resolved).toEqual([]);
  });

  it('drops the mask when the tower is unregistered', () => {
    attach();
    const t = tower();
    registry.register(t, t.position, 'archer');
    registry.unregister(t);
    expect(t.losMask).toBeNull();
  });

  it('runs a scheduled recompute on the next drain, unless the tower was unregistered', () => {
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

  it('drains one tower per call, oldest first, each with a retrofit mask', () => {
    attach();
    const first = tower();
    const second = tower(50, 0);
    registry.scheduleRecompute(first);
    registry.scheduleRecompute(second);

    runFrames();
    expect(grid.registerTowerIncremental.mock.calls.map(([id]) => id)).toEqual([first.id]);
    runFrames();
    runFrames();
    expect(grid.registerTowerIncremental.mock.calls.map(([id]) => id)).toEqual([first.id, second.id]);
    expect(resolved.map((e) => [e.towerId, e.reason])).toEqual([[first.id, 'retrofit'], [second.id, 'retrofit']]);
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
    registry.attach(blocked, gameState());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    registry.scheduleRecompute(tower());

    runFrames();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no LOS blocker group'));

    // Still queued: the next drain tries it again
    runFrames();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('drops the queue on detach', () => {
    attach();
    registry.scheduleRecompute(tower());
    registry.detach();
    attach();
    runFrames();

    expect(grid.registerTowerIncremental).not.toHaveBeenCalled();
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
