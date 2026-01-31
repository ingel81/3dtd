import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { Enemy } from './enemy.entity';
import { TransformComponent, HealthComponent, RenderComponent, MovementComponent, AudioComponent } from '../game-components';
import { ComponentType } from '../core/component';
import { getEnemyType } from '../models/enemy-types';
import { StatusEffect } from '../models/status-effects';

const path = [
  { lat: 0, lon: 0, height: 0 },
  { lat: 0.001, lon: 0.001, height: 0 },
];

describe('Enemy entity', () => {
  let nowSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    nowSpy = vi.spyOn(performance, 'now').mockReturnValue(1000);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('constructs an enemy with correct type and path', () => {
    const enemy = new Enemy('zombie', path);

    expect(enemy.type).toBe('enemy');
    expect(enemy.movement.path).toEqual(path);
  });

  it('has Transform, Health, Render, Movement, and Audio components', () => {
    const enemy = new Enemy('zombie', path);

    expect(enemy.getComponent(ComponentType.TRANSFORM)).toBeInstanceOf(TransformComponent);
    expect(enemy.getComponent(ComponentType.HEALTH)).toBeInstanceOf(HealthComponent);
    expect(enemy.getComponent(ComponentType.RENDER)).toBeInstanceOf(RenderComponent);
    expect(enemy.getComponent(ComponentType.MOVEMENT)).toBeInstanceOf(MovementComponent);
    expect(enemy.getComponent(ComponentType.AUDIO)).toBeInstanceOf(AudioComponent);
  });

  it('sets HP from config baseHp', () => {
    const enemy = new Enemy('zombie', path);
    const config = getEnemyType('zombie');

    expect(enemy.health.maxHp).toBe(config.baseHp);
    expect(enemy.health.hp).toBe(config.baseHp);
  });

  it('sets speed from config or override', () => {
    const enemyDefault = new Enemy('zombie', path);
    const enemyOverride = new Enemy('zombie', path, 12);

    expect(enemyDefault.movement.speedMps).toBe(getEnemyType('zombie').baseSpeed);
    expect(enemyOverride.movement.speedMps).toBe(12);
  });

  it('applies and clears status effects via MovementComponent', () => {
    const enemy = new Enemy('zombie', path);

    const slow: StatusEffect = {
      type: 'slow',
      value: 0.5,
      duration: 1000,
      startTime: 1000,
    };

    enemy.movement.applyStatusEffect(slow);
    expect(enemy.movement.isSlowed()).toBe(true);

    // Add a burn effect as well
    enemy.movement.applyStatusEffect({
      type: 'burn',
      value: 5,
      duration: 500,
      startTime: 1000,
      sourceId: 'tower-1',
    });

    expect(enemy.movement.statusEffects.length).toBe(2);

    // Expire effects
    nowSpy.mockReturnValue(3000);
    enemy.movement.removeExpiredEffects();
    expect(enemy.movement.isSlowed()).toBe(false);
  });

  it('supports different enemy archetypes (flyer, boss, armored)', () => {
    const flyer = new Enemy('bat', path);
    const boss = new Enemy('herbert', path);
    const armored = new Enemy('tank', path);

    expect(flyer.typeConfig.isAirUnit).toBe(true);
    expect(boss.typeConfig.baseHp).toBeGreaterThanOrEqual(500);
    expect(boss.typeConfig.immunityPercent).toBeGreaterThanOrEqual(0);
    expect(armored.typeConfig.canBleed).toBe(false);
    expect(armored.health.maxHp).toBeGreaterThan(flyer.health.maxHp);
  });

  it('replaces slow effects instead of stacking and keeps burn effects by source', () => {
    const enemy = new Enemy('zombie', path);

    enemy.movement.applyStatusEffect({
      type: 'slow',
      value: 0.3,
      duration: 1000,
      startTime: 1000,
    });

    enemy.movement.applyStatusEffect({
      type: 'slow',
      value: 0.6,
      duration: 2000,
      startTime: 1200,
    });

    expect(enemy.movement.statusEffects.length).toBe(1);
    expect(enemy.movement.getSlowMultiplier()).toBeCloseTo(1 - 0.6, 5);

    enemy.movement.applyStatusEffect({
      type: 'burn',
      value: 3,
      duration: 1000,
      startTime: 1200,
      sourceId: 'tower-a',
    });
    enemy.movement.applyStatusEffect({
      type: 'burn',
      value: 3,
      duration: 1000,
      startTime: 1200,
      sourceId: 'tower-b',
    });

    expect(enemy.movement.statusEffects.length).toBe(3);
  });

  it('moves along the path and reports when it reaches the end', () => {
    const enemy = new Enemy('zombie', path, 10);

    const resultStart = enemy.movement.move(1000);
    expect(resultStart).toBe('moving');
    expect(enemy.transform.position.lat).not.toBe(path[0].lat);

    let resultEnd: 'moving' | 'reached_end' = 'moving';
    for (let i = 0; i < 500; i++) {
      resultEnd = enemy.movement.move(200);
      if (resultEnd === 'reached_end') break;
    }

    expect(resultEnd).toBe('reached_end');
  });

  it('health calculations do not drop below zero even for heavy hits', () => {
    const enemy = new Enemy('tank', path);

    const wasKilled = enemy.health.takeDamage(enemy.health.maxHp * 10);
    expect(wasKilled).toBe(true);
    expect(enemy.health.hp).toBe(0);
  });
});
