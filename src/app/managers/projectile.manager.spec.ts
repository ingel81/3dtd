import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return {
    ...mod,
    InstancedMesh: class {},
  };
});

import { ProjectileManager } from './projectile.manager';
import { GameEventBus } from '../game-engine/game-event-bus';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';
import { createSinkSpy, type SinkSpy } from '../integration/test-helpers';
import type { SimSink } from '../sim/core/sim-sink';
import { getEnemyAimOffsetY } from '../utils/enemy-aim.util';

describe('ProjectileManager', () => {
  let eventBus: GameEventBus;
  let sink: SinkSpy;
  let manager: ProjectileManager;

  beforeEach(() => {
    eventBus = new GameEventBus();
    sink = createSinkSpy();
    manager = new ProjectileManager(eventBus, sink as unknown as SimSink);
  });

  it('spawns a projectile and creates renderer entity', () => {
    const towerPos: GeoPosition = { lat: 0, lon: 0, height: 2 };
    const tower = new Tower(towerPos, 'ice');
    const enemy = new Enemy('zombie', [
      { lat: 0.001, lon: 0, height: 0 },
      { lat: 0.002, lon: 0, height: 0 },
    ]);

    const projectile = manager.spawn(tower, enemy);

    const spawnHeight = (tower.position.height ?? 0) + tower.typeConfig.heightOffset + tower.typeConfig.shootHeight;

    expect(sink.projectiles.create).toHaveBeenCalledWith(
      projectile.id,
      projectile.typeConfig.id,
      tower.position.lat,
      tower.position.lon,
      spawnHeight,
      projectile.direction
    );
    expect(sink.trailStreaks.create).toHaveBeenCalledWith(projectile.id, projectile.typeConfig.visualType);
    expect(manager.getAll()).toHaveLength(1);
    expect(eventBus.getQueueSize()).toBe(2); // audio event + muzzle flash deferred
  });

  it('leaves the sound and flash of a manned tower\'s shot to the main thread (tower:manual-shot)', () => {
    const tower = new Tower({ lat: 0, lon: 0, height: 2 }, 'ice');
    const enemy = new Enemy('zombie', [
      { lat: 0.001, lon: 0, height: 0 },
      { lat: 0.002, lon: 0, height: 0 },
    ]);
    const shown: string[] = [];
    eventBus.onAny((event) => shown.push(event.type));
    manager.spawn(tower, enemy);
    tower.manned = true;
    manager.spawn(tower, enemy);
    manager.fireBlank(tower, { lat: 0.0003, lon: 0, height: 5 }, 0);
    eventBus.processQueue();

    expect(shown).toEqual(['audio:play', 'vfx:muzzle-flash']);
    expect(manager.getAll()).toHaveLength(3);
  });

  it('flies a free shot of a manned tower to its aim point and removes it there without a hit', () => {
    const tower = new Tower({ lat: 0, lon: 0, height: 2 }, 'ice');
    tower.manned = true;
    const hits = vi.fn();
    eventBus.on('projectile:hit', hits);

    const shot = manager.fireBlank(tower, { lat: 0.0003, lon: 0, height: 5 }, 0);
    expect(shot.targetEnemy).toBeNull();
    for (let i = 0; i < 600 && manager.getAll().length > 0; i++) manager.update(16);

    expect(manager.getAll()).toHaveLength(0);
    expect(sink.projectiles.finish).toHaveBeenCalledWith(shot.id, expect.any(Number), expect.any(Number), expect.any(Number));
    eventBus.processQueue();
    expect(hits).not.toHaveBeenCalled();
  });

  it('flies a shot no tower fires at a body to its aim point', () => {
    const enemy = new Enemy('zombie', [
      { lat: 0.0001, lon: 0, height: 0 },
      { lat: 0.0002, lon: 0, height: 0 },
    ]);
    const aimPoint = { lat: 0.00005, lon: 0, height: 1.8 };
    const projectile = manager.spawnShot({ lat: 0, lon: 0 }, 3, enemy, 'hero-round', 16, 'physical', 'hero', aimPoint);
    expect(projectile.aimPoint).toEqual(aimPoint);
  });

  it('fires a shot no tower fires: hero source, no tower type, sound where it starts, no muzzle flash', () => {
    const enemy = new Enemy('zombie', [
      { lat: 0.0001, lon: 0, height: 0 },
      { lat: 0.0002, lon: 0, height: 0 },
    ]);
    const projectile = manager.spawnShot({ lat: 0, lon: 0 }, 3, enemy, 'hero-round', 16, 'physical', 'hero');

    expect(projectile.sourceTowerId).toBe('hero');
    expect(projectile.sourceTowerType).toBeNull();
    expect(projectile.damage).toBe(16);
    expect(projectile.damageType).toBe('physical');
    expect(sink.projectiles.create).toHaveBeenCalledWith(projectile.id, 'hero-round', 0, 0, 3, projectile.direction);

    const deferred: string[] = [];
    eventBus.onAny((event) => deferred.push(event.type));
    eventBus.processQueue();
    expect(deferred).toEqual(['audio:play']);
  });

  it('moves projectile and emits hit event on impact', () => {
    const hitSpy = vi.fn();
    eventBus.on('projectile:hit', hitSpy);

    const tower = new Tower({ lat: 0, lon: 0, height: 2 }, 'ice');
    const enemy = new Enemy('zombie', [
      { lat: 0.00001, lon: 0, height: 0 },
      { lat: 0.00002, lon: 0, height: 0 },
    ]);

    const projectile = manager.spawn(tower, enemy);

    manager.update(1000);

    expect(hitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectile,
        target: enemy,
        damage: projectile.damage,
      })
    );
    expect(manager.getById(projectile.id)).toBeNull();
    expect(sink.projectiles.finish).toHaveBeenCalledWith(projectile.id, projectile.position.lat, projectile.position.lon, projectile.flightHeight);
    expect(sink.projectiles.remove).not.toHaveBeenCalled();
  });

  it('does not emit hit event when a non-splash target died before impact', () => {
    const hitSpy = vi.fn();
    eventBus.on('projectile:hit', hitSpy);

    // archer → 'arrow' projectile has no splashRadius
    const tower = new Tower({ lat: 0, lon: 0, height: 2 }, 'archer');
    const enemy = new Enemy('zombie', [
      { lat: 0.0005, lon: 0, height: 0 },
      { lat: 0.0006, lon: 0, height: 0 },
    ]);

    const projectile = manager.spawn(tower, enemy);
    enemy.health.takeDamage(enemy.health.hp); // kill target before hit

    manager.update(2000);

    expect(hitSpy).not.toHaveBeenCalled();
    expect(manager.getById(projectile.id)).toBeNull();
    expect(sink.projectiles.finish).toHaveBeenCalledWith(projectile.id, projectile.position.lat, projectile.position.lon, projectile.flightHeight);
    expect(sink.projectiles.remove).not.toHaveBeenCalled();
  });

  it('still emits hit event for a splash projectile when target died before impact', () => {
    // Splash must detonate at the impact point even if the primary target
    // dies mid-flight — otherwise AoE towers lose their area effect in packs.
    const hitSpy = vi.fn();
    eventBus.on('projectile:hit', hitSpy);

    // ice → 'ice-shard' projectile has splashRadius 8
    const tower = new Tower({ lat: 0, lon: 0, height: 2 }, 'ice');
    const enemy = new Enemy('zombie', [
      { lat: 0.0005, lon: 0, height: 0 },
      { lat: 0.0006, lon: 0, height: 0 },
    ]);

    const projectile = manager.spawn(tower, enemy);
    enemy.health.takeDamage(enemy.health.hp); // kill target before hit

    manager.update(2000);

    expect(hitSpy).toHaveBeenCalledTimes(1);
    expect(projectile.targetLost).toBe(true);
    expect(manager.getById(projectile.id)).toBeNull();
    expect(sink.projectiles.finish).toHaveBeenCalledWith(projectile.id, projectile.position.lat, projectile.position.lon, projectile.flightHeight);
    expect(sink.projectiles.remove).not.toHaveBeenCalled();
  });

  describe('a splash shot at an enemy in the air', () => {
    const AIR = ['bat', 'hornet', 'dragon'] as const;
    const SPLASH = ['cannonball', 'rocket', 'flak-shell', 'ice-shard', 'poison-glob'] as const;
    const origin: GeoPosition = { lat: 0, lon: 0, height: 0 };
    const path: GeoPosition[] = [
      { lat: 0.0004, lon: 0, height: 0 },
      { lat: 0.0005, lon: 0, height: 0 },
    ];

    /** Fly the shot to its end; what it reported to the world and the show */
    const land = (enemyType: (typeof AIR)[number], shot: (typeof SPLASH)[number], killFirst: boolean) => {
      const impacts: boolean[] = [];
      manager = new ProjectileManager(eventBus, sink as unknown as SimSink, (_p, air) => impacts.push(air));
      const shown: { height: number; targetLost: boolean }[] = [];
      eventBus.onShow('vfx:projectile-impact', ({ height, targetLost }) => shown.push({ height, targetLost }));
      const enemy = new Enemy(enemyType, path);
      // Where the shot aims on its body, high above the ground
      const airHeight = enemy.transform.terrainHeight + enemy.heightOffset + getEnemyAimOffsetY(enemy);
      const projectile = manager.spawnShot(origin, 2, enemy, shot, 10, 'physical', 'tower-1');
      manager.update(16);
      if (killFirst) enemy.health.takeDamage(enemy.health.hp);
      for (let i = 0; i < 1000 && manager.getById(projectile.id); i++) manager.update(16);
      eventBus.processQueue();
      return { projectile, airHeight, impacts, shown };
    };

    for (const enemyType of AIR) {
      for (const shot of SPLASH) {
        it(`${shot} at a ${enemyType} that died on the way bursts in the air, not on the ground`, () => {
          const { projectile, airHeight, impacts, shown } = land(enemyType, shot, true);
          expect(projectile.targetLost).toBe(true);
          expect(projectile.flightHeight).toBeCloseTo(airHeight, 9);
          expect(impacts).toEqual([true]);
          expect(shown).toHaveLength(1);
          expect(shown[0].height).toBe(projectile.flightHeight);
          expect(sink.projectiles.finish).toHaveBeenCalledWith(
            projectile.id, projectile.position.lat, projectile.position.lon, projectile.flightHeight,
          );
        });
      }

      it(`a rocket hitting a living ${enemyType} bursts at the hit's height`, () => {
        const { projectile, airHeight, impacts, shown } = land(enemyType, 'rocket', false);
        expect(projectile.targetLost).toBe(false);
        expect(projectile.flightHeight).toBeCloseTo(airHeight, 9);
        expect(impacts).toEqual([true]);
        expect(shown[0].height).toBe(projectile.flightHeight);
      });
    }

    it('a cannonball whose ground target died on the way still comes down on the ground', () => {
      const enemy = new Enemy('zombie', path);
      const projectile = manager.spawnShot(origin, 2, enemy, 'cannonball', 10, 'physical', 'tower-1');
      manager.update(16);
      enemy.health.takeDamage(enemy.health.hp);
      for (let i = 0; i < 1000 && manager.getById(projectile.id); i++) manager.update(16);
      expect(projectile.flightHeight).toBe(enemy.transform.terrainHeight + 1);
    });
  });
});
