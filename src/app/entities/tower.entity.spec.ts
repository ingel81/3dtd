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
  InstancedMesh: class {},
}));

import { Tower } from './tower.entity';
import { TransformComponent, CombatComponent, RenderComponent } from '../game-components';
import { ComponentType } from '../core/component';
import { getTowerType } from '../configs/tower-types.config';
import { Enemy } from './enemy.entity';

const position = { lat: 10, lon: 20, height: 5 };

describe('Tower entity', () => {
  it('constructs a tower with correct type and position', () => {
    const tower = new Tower(position, 'archer');

    expect(tower.type).toBe('tower');
    expect(tower.transform.position).toEqual(position);
  });

  it('has Transform, Combat, and Render components', () => {
    const tower = new Tower(position, 'archer');

    expect(tower.getComponent(ComponentType.TRANSFORM)).toBeInstanceOf(TransformComponent);
    expect(tower.getComponent(ComponentType.COMBAT)).toBeInstanceOf(CombatComponent);
    expect(tower.getComponent(ComponentType.RENDER)).toBeInstanceOf(RenderComponent);
  });

  it('typeConfig matches tower-types.config values', () => {
    const tower = new Tower(position, 'archer');
    const config = getTowerType('archer');

    expect(tower.typeConfig).toBe(config);
    expect(tower.combat.damage).toBe(config.damage);
    expect(tower.combat.range).toBe(config.range);
    expect(tower.combat.fireRate).toBe(config.fireRate);
  });

  it('creates different tower types correctly (archer, cannon, fire)', () => {
    const archer = new Tower(position, 'archer');
    const cannon = new Tower(position, 'cannon');
    const fire = new Tower(position, 'fire');

    expect(archer.typeConfig.id).toBe('archer');
    expect(cannon.typeConfig.id).toBe('cannon');
    expect(fire.typeConfig.id).toBe('fire');

    expect(archer.combat.damage).toBe(getTowerType('archer').damage);
    expect(cannon.combat.damage).toBe(getTowerType('cannon').damage);
    expect(fire.combat.range).toBe(getTowerType('fire').range);
  });

  it('supports upgrade logic (canUpgrade/applyUpgrade)', () => {
    const tower = new Tower(position, 'archer');
    const baseFireRate = tower.combat.fireRate;

    expect(tower.canUpgrade('speed')).toBe(true);
    expect(tower.applyUpgrade('speed')).toBe(true);
    expect(tower.combat.fireRate).toBeCloseTo(baseFireRate * 2, 5);

    expect(tower.canUpgrade('speed')).toBe(false);
    expect(tower.applyUpgrade('speed')).toBe(false);
  });

  it('tracks upgrade costs for sell-refund calculations', () => {
    const tower = new Tower(position, 'cannon');
    const speedUpgrade = getTowerType('cannon').upgrades.find(u => u.id === 'speed')!;
    const damageUpgrade = getTowerType('cannon').upgrades.find(u => u.id === 'damage')!;

    expect(tower.applyUpgrade('speed')).toBe(true);
    expect(tower.applyUpgrade('damage')).toBe(true);
    expect(tower.applyUpgrade('damage')).toBe(true);

    const expectedTotal =
      speedUpgrade.cost +
      damageUpgrade.cost +
      Math.round(damageUpgrade.cost * Math.pow(damageUpgrade.costScaling ?? 1, 1));

    expect(tower.getTotalUpgradeCost()).toBe(expectedTotal);

    const refundEstimate = tower.typeConfig.sellValue + tower.getTotalUpgradeCost();
    expect(refundEstimate).toBe(tower.typeConfig.sellValue + expectedTotal);
  });

  it('findTarget respects range and target type (air vs ground)', () => {
    const tower = new Tower(position, 'rocket');

    const closeEnemy = new Enemy('zombie', [
      { lat: position.lat, lon: position.lon, height: 0 },
      { lat: position.lat + 0.0001, lon: position.lon + 0.0001, height: 0 },
    ]);

    const farEnemy = new Enemy('zombie', [
      { lat: position.lat + 1, lon: position.lon + 1, height: 0 },
      { lat: position.lat + 1.0001, lon: position.lon + 1.0001, height: 0 },
    ]);

    const airEnemy = new Enemy('bat', [
      { lat: position.lat, lon: position.lon, height: 0 },
      { lat: position.lat + 0.0001, lon: position.lon, height: 0 },
    ]);

    expect(tower.findTarget([farEnemy])).toBeNull();
    expect(tower.findTarget([closeEnemy])).toBeNull();
    expect(tower.findTarget([airEnemy, closeEnemy])).toBe(airEnemy);
  });

  it('supports different tower archetypes (sniper/aoe/beam)', () => {
    const sniper = new Tower(position, 'rocket');
    const aoe = new Tower(position, 'cannon');
    const beam = new Tower(position, 'fire');

    expect(sniper.typeConfig.range).toBeGreaterThan(aoe.typeConfig.range);
    expect(aoe.typeConfig.projectileType).toBe('cannonball');
    expect(beam.typeConfig.attackType).toBe('beam');
  });
});
