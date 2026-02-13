import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return {
    ...mod,
  };
});

import { EnemyManager } from './enemy.manager';
import { GameEventBus } from '../game-engine';
import type { GeoPosition } from '../models/game.types';
import type { EntityPoolService } from '../services/entity-pool.service';
import type { GlobalRouteGridService } from '../services/global-route-grid.service';
import { SpatialGridService } from '../services/spatial-grid.service';
import type { ThreeTilesEngine } from '../three-engine';

const createMockTilesEngine = () => ({
  enemies: {
    create: vi.fn(() => Promise.resolve({})),
    startWalkAnimation: vi.fn(),
    playDeathAnimation: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
    update: vi.fn(),
    getSpeedMultiplier: vi.fn(() => 1),
  },
  spatialAudio: null,
  sync: {
    getOrigin: vi.fn(() => ({ height: 0 })),
    geoToLocalSimple: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
    geoToLocalSimpleInto: vi.fn((_lat: number, _lon: number, _h: number, target: unknown) => target),
  },
  getTerrainHeightAtGeo: vi.fn(() => 0),
});

const createGlobalRouteGrid = () => ({
  isInitialized: vi.fn(() => false),
  updateEnemyPosition: vi.fn(),
  removeEnemy: vi.fn(),
  getStats: vi.fn(() => ({ trackedEnemies: 0, occupiedCells: 0 })),
});

describe('EnemyManager', () => {
  let eventBus: GameEventBus;
  let tilesEngine: ReturnType<typeof createMockTilesEngine>;
  let globalRouteGrid: ReturnType<typeof createGlobalRouteGrid>;
  let manager: EnemyManager;

  beforeEach(() => {
    eventBus = new GameEventBus();
    tilesEngine = createMockTilesEngine();
    globalRouteGrid = createGlobalRouteGrid();
    manager = new EnemyManager(
      eventBus,
      {} as unknown as EntityPoolService,
      globalRouteGrid as unknown as GlobalRouteGridService,
      new SpatialGridService()
    );
    manager.initialize(tilesEngine as unknown as ThreeTilesEngine);
  });

  it('spawns enemies with correct type and stats', () => {
    const spawnedSpy = vi.fn();
    eventBus.on('enemy:spawned', spawnedSpy);

    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 2 },
      { lat: 0.001, lon: 0, height: 2 },
    ];

    const enemy = manager.spawn(path, 'zombie');
    expect(enemy.typeConfig.id).toBe('zombie');
    expect(enemy.health.maxHp).toBe(enemy.typeConfig.baseHp);
    expect(manager.getAll()).toHaveLength(1);
    expect(manager.getAliveCount()).toBe(1);
    expect(spawnedSpy).toHaveBeenCalledWith(expect.objectContaining({ enemy }));
  });

  it('applies health override on spawn', () => {
    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 2 },
      { lat: 0.001, lon: 0, height: 2 },
    ];

    const enemy = manager.spawn(path, 'zombie', undefined, false, 200);
    expect(enemy.health.maxHp).toBe(200);
    expect(enemy.health.hp).toBe(200);
  });

  it('kills enemy, emits event and removes immediately without death animation', () => {
    const diedSpy = vi.fn();
    eventBus.on('enemy:died', diedSpy);

    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];

    const enemy = manager.spawn(path, 'tank');
    manager.kill(enemy);

    expect(diedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        enemy,
        credits: 1,
      })
    );
    expect(manager.getById(enemy.id)).toBeNull();
    expect(tilesEngine.enemies.remove).toHaveBeenCalledWith(enemy.id);
    expect(manager.getAliveCount()).toBe(0);
  });

  it('emits reached-base event and removes enemy when path ends', () => {
    const reachedSpy = vi.fn();
    eventBus.on('enemy:reached-base', reachedSpy);

    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];

    const enemy = manager.spawn(path, 'zombie');
    vi.spyOn(enemy.movement, 'move').mockReturnValue('reached_end');

    manager.update(16, 1);

    expect(reachedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        enemy,
        damage: expect.any(Number),
      })
    );
    expect(manager.getById(enemy.id)).toBeNull();
    expect(tilesEngine.enemies.remove).toHaveBeenCalledWith(enemy.id);
  });

  it('getAlive returns only living enemies', () => {
    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];

    const enemy1 = manager.spawn(path, 'zombie');
    const enemy2 = manager.spawn(path, 'zombie');

    enemy1.health.takeDamage(enemy1.health.hp);

    const alive = manager.getAlive();
    expect(alive).toEqual([enemy2]);
  });

  it('removes expired status effects during update', () => {
    const path: GeoPosition[] = [
      { lat: 0, lon: 0, height: 0 },
      { lat: 0.001, lon: 0, height: 0 },
    ];

    const enemy = manager.spawn(path, 'zombie');
    const removeSpy = vi.spyOn(enemy.movement, 'removeExpiredEffects');

    manager.update(16, 2);
    expect(removeSpy).toHaveBeenCalledWith(2);
  });

  it('ignores debug spawn with invalid path', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    eventBus.emit({
      type: 'debug:spawn-enemy',
      enemyType: 'zombie',
      path: [{ lat: 0, lon: 0, height: 0 }],
      count: 1,
    });

    expect(manager.getAll()).toHaveLength(0);
    expect(tilesEngine.enemies.create).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
