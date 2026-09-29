import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return {
    ...mod,
    InstancedMesh: class {},
  };
});

import { TowerManager } from './tower.manager';
import { GameEventBus } from '../game-engine/game-event-bus';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';
import { createSinkSpy, createTestCoords, type SinkSpy } from '../integration/test-helpers';
import type { SimSink } from '../sim/core/sim-sink';

/** A frame that puts every tower at the origin */
const originSync = {
  getOrigin: () => ({ lat: 0, lon: 0, height: 0 }),
  geoToLocalSimple: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
};

describe('TowerManager', () => {
  let eventBus: GameEventBus;
  let sink: SinkSpy;
  let manager: TowerManager;

  beforeEach(() => {
    eventBus = new GameEventBus();
    sink = createSinkSpy();
    manager = new TowerManager(eventBus, createTestCoords(originSync as never), sink as unknown as SimSink);
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
    expect(sink.towers.create).toHaveBeenCalledWith(
      tower.id,
      'fire',
      position.lat,
      position.lon,
      position.height,
      0.5,
    );
    // No routes, so no guard heading: the aim stays where it was placed
    expect(tower.aim.target).toBe(tower.aim.current);
    expect(sink.effects.spawnTowerInnerFire).toHaveBeenCalledWith(
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

    expect(sink.plinths.create).toHaveBeenCalledTimes(1);
    expect(sink.plinths.create).toHaveBeenCalledWith(
      tower.id, 1, 2, 7, 2.5, tower.typeConfig.footprintRadius, [],
    );
  });

  it('hands the plinth the probes it hangs over a drop at, for its braces (E18)', () => {
    const tower = manager.placeTower({ lat: 1, lon: 2, height: 7 }, 'cannon', 0, 2.5, [3, 4]) as Tower;

    expect(tower.plinthOverhang).toEqual([3, 4]);
    expect(sink.plinths.create).toHaveBeenCalledWith(
      tower.id, 1, 2, 7, 2.5, tower.typeConfig.footprintRadius, [3, 4],
    );
  });

  it('takes the plinth down with its tower', () => {
    const onPlinth = manager.placeTower({ lat: 1, lon: 2, height: 7 }, 'cannon', 0, 2.5) as Tower;
    const flat = manager.placeTower({ lat: 1.001, lon: 2, height: 5 }, 'archer') as Tower;

    manager.sell(flat);
    expect(sink.plinths.remove).not.toHaveBeenCalled();
    manager.sell(onPlinth);
    expect(sink.plinths.remove).toHaveBeenCalledWith(onPlinth.id);

    manager.clear();
    expect(sink.plinths.clear).toHaveBeenCalled();
  });

  it('takes the veteran badge down with its tower', () => {
    const tower = manager.placeTower({ lat: 1, lon: 2, height: 5 }, 'archer') as Tower;
    manager.sell(tower);
    expect(sink.towerBadges.remove).toHaveBeenCalledWith(tower.id);

    manager.clear();
    expect(sink.towerBadges.clear).toHaveBeenCalled();
  });

  it('hands every tower to the searchlights on its foot, and takes the light down with it', () => {
    const tower = manager.placeTower({ lat: 1, lon: 2, height: 7 }, 'cannon', 0, 2.5) as Tower;
    // The foot is the plinth's top, position.height; the renderer skips passive buildings
    expect(sink.searchlights.add).toHaveBeenCalledWith(tower.id, 1, 2, 7, 'cannon');

    manager.sell(tower);
    expect(sink.searchlights.remove).toHaveBeenCalledWith(tower.id);
    manager.clear();
    expect(sink.searchlights.clear).toHaveBeenCalled();
  });

  describe('guard heading', () => {
    // North to south, about 5.6 m east of a tower at (1, 2).
    const southbound = [{ lat: 1.01, lon: 2.00005 }, { lat: 0.99, lon: 2.00005 }];
    const place = () => manager.placeTower({ lat: 1, lon: 2, height: 0 }, 'archer') as Tower;

    it('is computed on placement and the aim turns to it', () => {
      manager.setActiveRoutesGetter(() => [southbound]);
      const tower = place();

      // Entered from the north, slightly east of it.
      expect(tower.guardHeading).toBeGreaterThan(0);
      expect(tower.guardHeading).toBeLessThan(Math.PI / 4);
      expect(tower.aim.target).toBe(tower.guardHeading);
      expect(tower.aim.hasTarget).toBe(false);
      expect(sink.towers.create).toHaveBeenCalledWith(tower.id, 'archer', 1, 2, 0, 0);
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
    expect(sink.towers.remove).toHaveBeenCalledWith(tower.id);
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
