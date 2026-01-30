import { describe, it, expect, beforeEach } from 'vitest';
import { CombatComponent } from './combat.component';
import { GameObject } from '../core/game-object';
import { TransformComponent } from './transform.component';
import { ComponentType } from '../core/component';

class TestGameObject extends GameObject {
  constructor() {
    super('tower');
  }
}

describe('CombatComponent', () => {
  let gameObject: TestGameObject;

  beforeEach(() => {
    gameObject = new TestGameObject();
  });

  it('constructs with damage, range, and fireRate from config', () => {
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 2 });

    expect(combat.damage).toBe(10);
    expect(combat.range).toBe(25);
    expect(combat.fireRate).toBe(2);
  });

  it('canFire respects fireRate timing', () => {
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 2 });

    expect(combat.canFire(0)).toBe(false);
    expect(combat.canFire(500)).toBe(true);

    combat.fire(500);
    expect(combat.canFire(750)).toBe(false);
    expect(combat.canFire(1000)).toBe(true);
  });

  it('canFire returns false when fireRate is zero', () => {
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 0 });

    expect(combat.canFire(0)).toBe(false);
    expect(combat.canFire(10000)).toBe(false);
  });

  it('allows zero damage without breaking targeting', () => {
    const combat = new CombatComponent(gameObject, { damage: 0, range: 25, fireRate: 1 });
    expect(combat.damage).toBe(0);
    expect(combat.canFire(1000)).toBe(true);
  });

  it('manages target assignment', () => {
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 2 });
    const target = new TestGameObject();

    expect(combat.hasTarget()).toBe(false);

    combat.setTarget(target);
    expect(combat.hasTarget()).toBe(true);

    combat.clearTarget();
    expect(combat.hasTarget()).toBe(false);
  });

  it('supports multiple targeting ranges (in-range vs out-of-range)', () => {
    const transform = new TransformComponent(gameObject);
    gameObject.addComponent(transform, ComponentType.TRANSFORM);
    transform.setPosition(0, 0, 0);

    const combat = new CombatComponent(gameObject, { damage: 10, range: 1000, fireRate: 1 });

    expect(combat.isInRange({ lat: 0.001, lon: 0, height: 0 })).toBe(true);
    expect(combat.isInRange({ lat: 1, lon: 1, height: 0 })).toBe(false);
  });
});
