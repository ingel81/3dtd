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
import type { OsmStreetService } from '../services/location/osm-street.service';
import type { ThreeTilesEngine } from '../three-engine';

const createMockTilesEngine = () => ({
  towers: {
    create: vi.fn(),
    select: vi.fn(),
    deselect: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  },
  plinths: {
    create: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  },
  tentacles: {
    create: vi.fn(),
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
    manager = new TowerManager(
      eventBus,
      osmService as unknown as OsmStreetService,
      { airTargetingUnlocked: () => false } as unknown as import('../store/research.store').ResearchStore,
    );
    manager.initialize(tilesEngine as unknown as ThreeTilesEngine);
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
      0.5,
      null, // no routes, so no guard heading
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

  it('keeps the plinth height the tower was placed with, 0 without one', () => {
    const onPlinth = manager.placeTower({ lat: 1, lon: 2, height: 7 }, 'archer', 0, 2.5) as Tower;
    const flat = manager.placeTower({ lat: 1.001, lon: 2, height: 5 }, 'archer') as Tower;

    expect(onPlinth.plinthHeight).toBe(2.5);
    expect(onPlinth.position.height).toBe(7);
    expect(flat.plinthHeight).toBe(0);
  });

  it('puts a plinth under a tower that has one, sized by its footprint', () => {
    const tower = manager.placeTower({ lat: 1, lon: 2, height: 7 }, 'cannon', 0, 2.5) as Tower;
    manager.placeTower({ lat: 1.001, lon: 2, height: 5 }, 'archer');

    expect(tilesEngine.plinths.create).toHaveBeenCalledTimes(1);
    expect(tilesEngine.plinths.create).toHaveBeenCalledWith(
      tower.id, 1, 2, 7, 2.5, tower.typeConfig.footprintRadius,
    );
  });

  it('takes the plinth down with its tower', () => {
    const onPlinth = manager.placeTower({ lat: 1, lon: 2, height: 7 }, 'cannon', 0, 2.5) as Tower;
    const flat = manager.placeTower({ lat: 1.001, lon: 2, height: 5 }, 'archer') as Tower;

    manager.sell(flat);
    expect(tilesEngine.plinths.remove).not.toHaveBeenCalled();
    manager.sell(onPlinth);
    expect(tilesEngine.plinths.remove).toHaveBeenCalledWith(onPlinth.id);

    manager.clear();
    expect(tilesEngine.plinths.clear).toHaveBeenCalled();
  });

  describe('guard heading', () => {
    // North to south, about 5.6 m east of a tower at (1, 2).
    const southbound = [{ lat: 1.01, lon: 2.00005 }, { lat: 0.99, lon: 2.00005 }];
    const place = () => manager.placeTower({ lat: 1, lon: 2, height: 0 }, 'archer') as Tower;

    it('is computed on placement and handed to the renderer', () => {
      manager.setActiveRoutesGetter(() => [southbound]);
      const tower = place();

      // Entered from the north, slightly east of it.
      expect(tower.guardHeading).toBeGreaterThan(0);
      expect(tower.guardHeading).toBeLessThan(Math.PI / 4);
      expect(tilesEngine.towers.create).toHaveBeenCalledWith(
        tower.id, 'archer', 1, 2, 0, 0, tower.guardHeading,
      );
    });

    it('is null when no route reaches the range', () => {
      manager.setActiveRoutesGetter(() => [[{ lat: 1.5, lon: 2 }, { lat: 1.5, lon: 3 }]]);
      expect(place().guardHeading).toBeNull();
    });

    it('follows a range change', () => {
      manager.setActiveRoutesGetter(() => [southbound]);
      const tower = place();
      const before = tower.guardHeading!;

      tower.combat.range *= 2;
      manager.refreshGuardHeading(tower);

      // The wider circle meets the route further north.
      expect(tower.guardHeading!).toBeGreaterThan(0);
      expect(tower.guardHeading!).toBeLessThan(before);
    });

    it('follows a route change', () => {
      let routes = [southbound];
      manager.setActiveRoutesGetter(() => routes);
      const tower = place();

      routes = [[...southbound].reverse()];
      manager.refreshGuardHeadings();

      // Same street walked northwards: the tower now watches the south.
      expect(Math.abs(tower.guardHeading!)).toBeGreaterThan((3 * Math.PI) / 4);
    });
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

    // Phase 4 refactor: per-tower viz mesh is now owned by the grid service
    // (shared single mesh, swapped on selection). The Tower entity no longer
    // carries a `losVisualization` property — the test asserts only the
    // observable selectTower behaviour: tower.selected flag + engine
    // select/deselect + emitted events.

    manager.selectTower(tower1.id);
    expect(tower1.selected).toBe(true);
    expect(tilesEngine.towers.select).toHaveBeenCalledWith(tower1.id);
    expect(selectedSpy).toHaveBeenCalledWith(expect.objectContaining({ tower: tower1 }));

    manager.selectTower(tower2.id);
    expect(tower1.selected).toBe(false);
    expect(tilesEngine.towers.deselect).toHaveBeenCalledWith(tower1.id);
    expect(tower2.selected).toBe(true);

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

  it('tower targeting "last" picks the enemy least far along its path', () => {
    const tower = manager.placeTower({ lat: 0, lon: 0, height: 0 }, 'ice') as Tower;
    tower.targetingStrategy = 'last';

    const path: GeoPosition[] = [
      { lat: 0.00004, lon: 0, height: 0 },
      { lat: 0.00010, lon: 0, height: 0 },
    ];
    const ahead = new Enemy('zombie', path);
    const behind = new Enemy('zombie', path);
    const middle = new Enemy('zombie', path);
    for (let i = 0; i < 20; i++) ahead.movement.move(0.1, 1.0);
    for (let i = 0; i < 5; i++) middle.movement.move(0.1, 1.0);
    for (let i = 0; i < 2; i++) behind.movement.move(0.1, 1.0);
    expect(behind.movement.getPathProgress()).toBeLessThan(middle.movement.getPathProgress());

    // Candidate order must not matter
    expect(tower.findTarget([ahead, middle, behind], false)).toBe(behind);
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
