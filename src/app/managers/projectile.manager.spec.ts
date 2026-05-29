import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('three', async () => {
  const mod = await import('@/test/mocks/three.mock');
  return {
    ...mod,
    InstancedMesh: class {},
  };
});

import { ProjectileManager } from './projectile.manager';
import { GameEventBus } from '../game-engine';
import { Tower } from '../entities/tower.entity';
import { Enemy } from '../entities/enemy.entity';
import type { GeoPosition } from '../models/game.types';
import type { ThreeTilesEngine } from '../three-engine';

const createMockTilesEngine = () => ({
  projectiles: {
    create: vi.fn(),
    update: vi.fn(),
    updateWithRotation: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  },
  effects: {
    spawnConfigurableTrailAtGeo: vi.fn(),
  },
  trailStreaks: {
    create: vi.fn(),
    pushPosition: vi.fn(),
    remove: vi.fn(),
    updateAll: vi.fn(),
  },
  sync: {
    geoToLocalSimple: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
    geoToLocalSimpleInto: vi.fn((_lat: number, _lon: number, _height: number, target: { x: number; y: number; z: number }) => {
      if (target) { target.x = 0; target.y = 0; target.z = 0; }
      return target;
    }),
  },
  spatialAudio: {
    registerSound: vi.fn(),
  },
});

describe('ProjectileManager', () => {
  let eventBus: GameEventBus;
  let tilesEngine: ReturnType<typeof createMockTilesEngine>;
  let manager: ProjectileManager;

  beforeEach(() => {
    eventBus = new GameEventBus();
    tilesEngine = createMockTilesEngine();
    manager = new ProjectileManager(eventBus);
    manager.initialize(tilesEngine as unknown as ThreeTilesEngine);
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

    expect(tilesEngine.projectiles.create).toHaveBeenCalledWith(
      projectile.id,
      projectile.typeConfig.id,
      tower.position.lat,
      tower.position.lon,
      spawnHeight,
      projectile.direction
    );
    expect(manager.getAll()).toHaveLength(1);
    expect(eventBus.getQueueSize()).toBe(2); // audio event + muzzle flash deferred
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
    expect(tilesEngine.projectiles.remove).toHaveBeenCalledWith(projectile.id);
  });

  it('updates in-flight projectile with rotation for arc trajectory', () => {
    const tower = new Tower({ lat: 0, lon: 0, height: 2 }, 'archer');
    const enemy = new Enemy('zombie', [
      { lat: 0.01, lon: 0, height: 0 },
      { lat: 0.02, lon: 0, height: 0 },
    ]);

    const projectile = manager.spawn(tower, enemy);

    manager.update(16);

    expect(tilesEngine.projectiles.updateWithRotation).toHaveBeenCalledWith(
      projectile.id,
      projectile.position.lat,
      projectile.position.lon,
      projectile.flightHeight,
      projectile.direction
    );
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
    expect(tilesEngine.projectiles.remove).toHaveBeenCalledWith(projectile.id);
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
    expect(tilesEngine.projectiles.remove).toHaveBeenCalledWith(projectile.id);
  });
});
