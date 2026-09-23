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
    spawnConfigurableTrail: vi.fn(),
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

  it('plays the shots of a manned tower at the listener, the others at the tower', () => {
    const tower = new Tower({ lat: 0, lon: 0, height: 2 }, 'ice');
    const enemy = new Enemy('zombie', [
      { lat: 0.001, lon: 0, height: 0 },
      { lat: 0.002, lon: 0, height: 0 },
    ]);
    const sounds: (boolean | undefined)[] = [];
    eventBus.on('audio:play', (event) => sounds.push(event.atListener));

    manager.spawn(tower, enemy);
    tower.manned = true;
    manager.spawn(tower, enemy);
    manager.fireBlank(tower, { lat: 0.0003, lon: 0, height: 5 }, 0);
    eventBus.processQueue();

    expect(sounds).toEqual([false, true, true]);
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
    expect(tilesEngine.projectiles.remove).toHaveBeenCalledWith(shot.id);
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
    expect(tilesEngine.projectiles.create).toHaveBeenCalledWith(projectile.id, 'hero-round', 0, 0, 3, projectile.direction);

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
    // Visual push moved out of the sub-step: update() simulates only,
    // presentFrame() feeds the renderer once per frame.
    expect(tilesEngine.projectiles.updateWithRotation).not.toHaveBeenCalled();
    manager.presentFrame();

    expect(tilesEngine.projectiles.updateWithRotation).toHaveBeenCalledWith(
      projectile.id,
      projectile.position.lat,
      projectile.position.lon,
      projectile.flightHeight,
      projectile.direction
    );
  });

  it('lays a frame\'s trail particles back along the path instead of stacking them', () => {
    const tower = new Tower({ lat: 0, lon: 0, height: 2 }, 'magic');
    const enemy = new Enemy('zombie', [
      { lat: 0.001, lon: 0, height: 0 },
      { lat: 0.002, lon: 0, height: 0 },
    ]);
    const projectile = manager.spawn(tower, enemy);

    // Three sub-steps at 100 m/s: 4.8 m flown, nine 0.5 m gates.
    manager.update(16);
    manager.update(16);
    manager.update(16);
    manager.presentFrame();

    const calls = tilesEngine.effects.spawnConfigurableTrail.mock.calls;
    expect(calls).toHaveLength(9);
    const { dx, dy, dz } = projectile.direction;
    calls.forEach(([x, y, z], i) => {
      // geoToLocalSimpleInto is mocked to the origin
      expect(x).toBeCloseTo(-dx * 0.5 * i, 5);
      expect(y).toBeCloseTo(-dy * 0.5 * i, 5);
      expect(z).toBeCloseTo(-dz * 0.5 * i, 5);
    });
  });

  it('starts the rocket trail and streak at the nozzle, behind the mesh centre', () => {
    const tower = new Tower({ lat: 0, lon: 0, height: 2 }, 'rocket');
    const enemy = new Enemy('zombie', [
      { lat: 0.001, lon: 0, height: 0 },
      { lat: 0.002, lon: 0, height: 0 },
    ]);
    const projectile = manager.spawn(tower, enemy);

    manager.update(16);
    manager.presentFrame();

    const tail = projectile.typeConfig.tailOffset!;
    const { dx, dy, dz } = projectile.direction;
    const [x, y, z] = tilesEngine.effects.spawnConfigurableTrail.mock.calls[0];
    expect(x).toBeCloseTo(-dx * tail, 5);
    expect(y).toBeCloseTo(-dy * tail, 5);
    expect(z).toBeCloseTo(-dz * tail, 5);
    const streakPos = tilesEngine.trailStreaks.pushPosition.mock.calls[0][1];
    expect(streakPos.z).toBeCloseTo(-dz * tail, 5);
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
