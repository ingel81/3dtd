import { describe, it, expect, vi } from 'vitest';

vi.mock('three', () => ({
  Vector3: class {
    x = 0; y = 0; z = 0;
    constructor(x?: number, y?: number, z?: number) {
      this.x = x ?? 0;
      this.y = y ?? 0;
      this.z = z ?? 0;
    }
  },
}));

import { Projectile } from './projectile.entity';
import { Enemy } from './enemy.entity';
import { ComponentType } from '../core/component';
import { TransformComponent, CombatComponent, MovementComponent, RenderComponent } from '../game-components';
import { getProjectileType } from '../configs/projectile-types.config';
import { DEFAULT_AIM_OFFSET_Y } from '../utils/enemy-aim.util';

const targetPath = [
  { lat: 0.001, lon: 0, height: 0 },
  { lat: 0.002, lon: 0, height: 0 },
];

describe('Projectile entity', () => {
  it('constructs with correct components', () => {
    const enemy = new Enemy('zombie', targetPath);
    const projectile = new Projectile({ lat: 0, lon: 0, height: 0 }, enemy, 'arrow', 10, 1, 'tower-1');

    expect(projectile.getComponent(ComponentType.TRANSFORM)).toBeInstanceOf(TransformComponent);
    expect(projectile.getComponent(ComponentType.COMBAT)).toBeInstanceOf(CombatComponent);
    expect(projectile.getComponent(ComponentType.MOVEMENT)).toBeInstanceOf(MovementComponent);
    expect(projectile.getComponent(ComponentType.RENDER)).toBeInstanceOf(RenderComponent);
  });

  it('sets projectile type config from config', () => {
    const enemy = new Enemy('zombie', targetPath);
    const projectile = new Projectile({ lat: 0, lon: 0, height: 0 }, enemy, 'arrow', 10, 1, 'tower-1');

    expect(projectile.typeConfig).toBe(getProjectileType('arrow'));
    expect(projectile.movement.speedMps).toBe(getProjectileType('arrow').speed);
  });

  it('calculates initial movement direction towards target', () => {
    const enemy = new Enemy('zombie', targetPath);
    const projectile = new Projectile({ lat: 0, lon: 0, height: 0 }, enemy, 'arrow', 10, 1, 'tower-1');

    const direction = projectile.direction;

    // No VAT bake runs in unit tests → getEnemyAimOffsetY falls back to DEFAULT_AIM_OFFSET_Y.
    const targetHeight = (enemy.transform.terrainHeight ?? 0) + (enemy.typeConfig.heightOffset ?? 0) + DEFAULT_AIM_OFFSET_Y;
    const dy = targetHeight - 1;
    const dz = 0.001 * 100000;
    const length = Math.sqrt(dz * dz + dy * dy);

    expect(direction.dx).toBeCloseTo(0, 5);
    expect(direction.dy).toBeCloseTo(dy / length, 5);
    expect(direction.dz).toBeCloseTo(dz / length, 5);
  });

  it('reflects splash configuration for AoE projectiles', () => {
    const enemy = new Enemy('zombie', targetPath);
    const cannonball = new Projectile({ lat: 0, lon: 0, height: 0 }, enemy, 'cannonball', 10, 1, 'tower-1');
    const iceShard = new Projectile({ lat: 0, lon: 0, height: 0 }, enemy, 'ice-shard', 10, 1, 'tower-1');
    const bullet = new Projectile({ lat: 0, lon: 0, height: 0 }, enemy, 'bullet', 10, 1, 'tower-1');

    expect(cannonball.typeConfig.splashRadius).toBeGreaterThan(0);
    expect(iceShard.typeConfig.splashRadius).toBeGreaterThan(0);
    expect(bullet.typeConfig.splashRadius).toBeUndefined();
  });

  it('updates direction based on target position (east vs west)', () => {
    const eastEnemy = new Enemy('zombie', [
      { lat: 0, lon: 0.001, height: 0 },
      { lat: 0.002, lon: 0.001, height: 0 },
    ]);
    const westEnemy = new Enemy('zombie', [
      { lat: 0, lon: -0.001, height: 0 },
      { lat: 0.002, lon: -0.001, height: 0 },
    ]);

    const eastProjectile = new Projectile({ lat: 0, lon: 0, height: 0 }, eastEnemy, 'bullet', 10, 1, 'tower-1');
    const westProjectile = new Projectile({ lat: 0, lon: 0, height: 0 }, westEnemy, 'bullet', 10, 1, 'tower-1');

    expect(eastProjectile.direction.dx).toBeLessThan(0);
    expect(westProjectile.direction.dx).toBeGreaterThan(0);
  });

  it('reports hit and despawn condition when reaching target', () => {
    const enemy = new Enemy('zombie', targetPath);
    const projectile = new Projectile({ lat: 0, lon: 0, height: 0 }, enemy, 'bullet', 10, 1, 'tower-1');

    const hit = projectile.updateTowardsTarget(100000);
    expect(hit).toBe(true);
    expect(projectile.flightProgress).toBeGreaterThanOrEqual(1);
  });
});
