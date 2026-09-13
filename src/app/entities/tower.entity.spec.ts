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

describe('Tower.findTarget with a body along the route', () => {
  const tower = () => new Tower(position, 'archer');
  /** An ooze whose tip is far away: only bodyDistSq can bring it in range. */
  const ooze = (): Enemy => {
    const enemy = new Enemy('ooze', [{ lat: 11, lon: 20 }, { lat: 12, lon: 20 }]);
    enemy.body = {} as never;
    return enemy;
  };
  /** A zombie `metres` north of the tower. */
  const zombieAt = (metres: number): Enemy =>
    new Enemy('zombie', [
      { lat: position.lat + metres / 111320, lon: position.lon },
      { lat: position.lat + 1, lon: position.lon },
    ]);

  it('measures the body at its aim point and does not ask the LOS predicate', () => {
    const t = tower();
    const target = ooze();
    const losCheck = vi.fn(() => false);
    expect(t.findTarget([target], false, losCheck, () => 100)).toBe(target);
    expect(losCheck).not.toHaveBeenCalled();
  });

  it('is out of reach without an aim point in range and sight', () => {
    const t = tower();
    expect(t.findTarget([ooze()], false, undefined, () => Infinity)).toBeNull();
    expect(t.findTarget([ooze()], false)).toBeNull();
    const far = t.combat.range + 1;
    expect(t.findTarget([ooze()], false, undefined, () => far * far)).toBeNull();
  });

  it('picks the nearer of a body and another enemy by the aim point', () => {
    const t = tower();
    t.targetingStrategy = 'closest';
    const body = ooze();
    const zombie = zombieAt(8);
    expect(t.findTarget([zombie, body], false, undefined, () => 5 * 5)).toBe(body);
    t.clearTarget();
    expect(t.findTarget([zombie, body], false, undefined, () => 12 * 12)).toBe(zombie);
  });

  it('keeps a body target while its aim point stays in range', () => {
    const t = tower();
    const body = ooze();
    expect(t.findTarget([body], false, undefined, () => 25)).toBe(body);
    expect(t.findTarget([], false, undefined, () => 25)).toBe(body);
    expect(t.findTarget([], false, undefined, () => Infinity)).toBeNull();
  });
});

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
    const speedUpgrade = getTowerType('archer').upgrades.find(u => u.id === 'speed')!;

    expect(tower.canUpgrade('speed')).toBe(true);
    expect(tower.applyUpgrade('speed')).toBe(true);
    expect(tower.combat.fireRate).toBeCloseTo(baseFireRate * speedUpgrade.effect.multiplier, 5);

    // Apply remaining levels until maxLevel reached
    for (let i = 1; i < speedUpgrade.maxLevel; i++) {
      expect(tower.applyUpgrade('speed')).toBe(true);
    }
    expect(tower.canUpgrade('speed')).toBe(false);
    expect(tower.applyUpgrade('speed')).toBe(false);
  });

  it('damage grows degressively past L15', () => {
    const tower = new Tower(position, 'archer');
    for (let i = 0; i < 25; i++) expect(tower.applyUpgrade('damage')).toBe(true);
    // Archer ×1,05 bis L15, danach ×1,02: L25 = ×2,53 statt ×3,39.
    expect(tower.combat.damage).toBeCloseTo(25 * Math.pow(1.05, 15) * Math.pow(1.02, 10), 6);
  });

  it('range track ends at L10 with ×1.03 per level', () => {
    const tower = new Tower(position, 'cannon');
    for (let i = 0; i < 10; i++) expect(tower.applyUpgrade('range')).toBe(true);
    expect(tower.canUpgrade('range')).toBe(false);
    expect(tower.applyUpgrade('range')).toBe(false);
    expect(tower.combat.range).toBeCloseTo(tower.typeConfig.range * Math.pow(1.03, 10), 6);
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

    // Sell value is 75% of (cost + total upgrade cost)
    const expectedSellValue = Math.round((tower.typeConfig.cost + expectedTotal) * 0.75);
    expect(tower.getSellValue()).toBe(expectedSellValue);
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

    expect(tower.findTarget([farEnemy], false)).toBeNull();
    expect(tower.findTarget([closeEnemy], false)).toBeNull();
    expect(tower.findTarget([airEnemy, closeEnemy], false)).toBe(airEnemy);
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
