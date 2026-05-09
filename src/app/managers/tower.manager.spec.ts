import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return {
    ...mod,
    InstancedMesh: class {},
  };
});

import { TowerManager } from './tower.manager';
import { GameEventBus } from '../game-engine';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';
import type { OsmStreetService, StreetNetwork } from '../services/osm-street.service';
import type { ThreeTilesEngine } from '../three-engine';
import type { InstancedMesh } from 'three';

const basePosition: GeoPosition = { lat: 0, lon: 0, height: 0 };
const spawnPoints: GeoPosition[] = [{ lat: 0.01, lon: 0, height: 0 }];

const createMockTilesEngine = () => ({
  towers: {
    create: vi.fn(),
    select: vi.fn(),
    deselect: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  },
  effects: {
    spawnTowerInnerFire: vi.fn(),
    stopTowerInnerFire: vi.fn(),
    stopAllTowerFires: vi.fn(),
  },
  sync: {
    geoToLocalSimple: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
  },
  spatialAudio: {
    registerSound: vi.fn(),
  },
});

const createOsmService = () => ({
  findNearestStreetPoint: vi.fn(() => ({ distance: 10, position: { lat: 0, lon: 0 } })),
});

describe('TowerManager', () => {
  let eventBus: GameEventBus;
  let tilesEngine: ReturnType<typeof createMockTilesEngine>;
  let osmService: ReturnType<typeof createOsmService>;
  let manager: TowerManager;

  beforeEach(() => {
    eventBus = new GameEventBus();
    tilesEngine = createMockTilesEngine();
    osmService = createOsmService();
    manager = new TowerManager(eventBus, osmService as unknown as OsmStreetService);
    manager.initializeWithContext(
      tilesEngine as unknown as ThreeTilesEngine,
      {} as unknown as StreetNetwork,
      basePosition,
      spawnPoints
    );
  });

  it('places a tower, creates renderer and emits event', () => {
    const placedSpy = vi.fn();
    const audioSpy = vi.fn();
    eventBus.on('tower:placed', placedSpy);
    eventBus.on('audio:play', audioSpy);

    const position: GeoPosition = { lat: 1, lon: 2, height: 5 };
    const tower = manager.placeTower(position, 'fire', 0.5) as Tower;

    expect(tower).toBeTruthy();
    expect(tower.position).toEqual(position);
    expect(tilesEngine.towers.create).toHaveBeenCalledWith(
      tower.id,
      'fire',
      position.lat,
      position.lon,
      position.height,
      0.5
    );
    expect(tilesEngine.effects.spawnTowerInnerFire).toHaveBeenCalledWith(
      tower.id,
      { x: 0, y: 0, z: 0 },
      tower.typeConfig.heightOffset - 1.5,
      0.5
    );
    expect(placedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tower,
        position,
        cost: tower.typeConfig.cost,
      })
    );
    expect(audioSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audio:play',
        sound: 'tower-placed',
        lat: position.lat,
        lon: position.lon,
        height: position.height,
      })
    );
  });

  it('sells a tower, emits refund event and removes tower', () => {
    const soldSpy = vi.fn();
    eventBus.on('tower:sold', soldSpy);

    const position: GeoPosition = { lat: 0.001, lon: 0.001, height: 2 };
    const tower = manager.placeTower(position, 'ice') as Tower;

    const expectedRefund = tower.getSellValue();
    const refund = manager.sell(tower);

    expect(refund).toBe(expectedRefund);
    expect(soldSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tower,
        refund: expectedRefund,
      })
    );
    expect(manager.getById(tower.id)).toBeNull();
    expect(tilesEngine.towers.remove).toHaveBeenCalledWith(tower.id);
  });

  it('selects and deselects towers and emits events', () => {
    const selectedSpy = vi.fn();
    const deselectedSpy = vi.fn();
    eventBus.on('tower:selected', selectedSpy);
    eventBus.on('tower:deselected', deselectedSpy);

    const tower1 = manager.placeTower({ lat: 0.002, lon: 0, height: 1 }, 'ice') as Tower;
    const tower2 = manager.placeTower({ lat: 0.003, lon: 0, height: 1 }, 'ice') as Tower;
    tower1.losVisualization = { visible: false } as unknown as InstancedMesh;
    tower2.losVisualization = { visible: false } as unknown as InstancedMesh;

    manager.selectTower(tower1.id);
    expect(tower1.selected).toBe(true);
    expect(tower1.losVisualization?.visible).toBe(true);
    expect(tilesEngine.towers.select).toHaveBeenCalledWith(tower1.id);
    expect(selectedSpy).toHaveBeenCalledWith(expect.objectContaining({ tower: tower1 }));

    manager.selectTower(tower2.id);
    expect(tower1.selected).toBe(false);
    expect(tower1.losVisualization?.visible).toBe(false);
    expect(tilesEngine.towers.deselect).toHaveBeenCalledWith(tower1.id);
    expect(tower2.selected).toBe(true);
    expect(tower2.losVisualization?.visible).toBe(true);

    manager.deselectAll();
    expect(tower2.selected).toBe(false);
    expect(deselectedSpy).toHaveBeenCalledTimes(1);
  });

  it('getAll/getById return expected towers', () => {
    const t1 = manager.placeTower({ lat: 0.01, lon: 0.01, height: 1 }, 'ice') as Tower;
    const t2 = manager.placeTower({ lat: 0.02, lon: 0.02, height: 1 }, 'ice') as Tower;

    const all = manager.getAll();
    expect(all).toHaveLength(2);
    expect(all.map(t => t.id)).toEqual([t1.id, t2.id]);
    expect(manager.getById(t1.id)).toBe(t1);
  });

  it('tower targeting selects by strategy (ice uses "first" — furthest along path)', () => {
    const tower = manager.placeTower({ lat: 0, lon: 0, height: 0 }, 'ice') as Tower;
    expect(tower.targetingStrategy).toBe('first');

    const pathA: GeoPosition[] = [
      { lat: 0.00005, lon: 0, height: 0 },
      { lat: 0.00010, lon: 0, height: 0 },
    ];
    const pathB: GeoPosition[] = [
      { lat: 0.00004, lon: 0, height: 0 },
      { lat: 0.00010, lon: 0, height: 0 },
    ];

    const enemyA = new Enemy('zombie', pathA);
    const enemyB = new Enemy('zombie', pathB);
    // Advance enemyB further along its path via move() (update() is a no-op)
    for (let i = 0; i < 20; i++) {
      enemyB.movement.move(0.1, 1.0);
    }

    // Verify enemyB actually has higher progress
    const progressA = enemyA.movement.getPathProgress();
    const progressB = enemyB.movement.getPathProgress();
    expect(progressB).toBeGreaterThan(progressA);

    const target = tower.findTarget([enemyA, enemyB], false);
    // enemyB traveled further along its path, so 'first' strategy picks it
    expect(target).toBe(enemyB);
  });

  it('tower targeting selects lowest HP enemy when strategy is "lowest-hp"', () => {
    const tower = manager.placeTower({ lat: 0, lon: 0, height: 0 }, 'magic') as Tower;
    // Override strategy for this test
    tower.targetingStrategy = 'lowest-hp';

    const pathA: GeoPosition[] = [
      { lat: 0.00005, lon: 0, height: 0 },
      { lat: 0.00006, lon: 0, height: 0 },
    ];
    const pathB: GeoPosition[] = [
      { lat: 0.00004, lon: 0, height: 0 },
      { lat: 0.00005, lon: 0, height: 0 },
    ];

    const enemyA = new Enemy('zombie', pathA);
    const enemyB = new Enemy('zombie', pathB);
    enemyA.health.takeDamage(10); // higher HP remaining
    enemyB.health.takeDamage(40); // lower HP remaining

    const target = tower.findTarget([enemyA, enemyB], false);
    expect(target).toBe(enemyB);
  });
});
