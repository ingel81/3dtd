import { describe, it, expect, beforeEach } from 'vitest';
import { CombatComponent } from './combat.component';
import { GameObject } from '../core/game-object';

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

  it('manages target assignment', () => {
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 2 });
    const target = new TestGameObject();

    expect(combat.hasTarget()).toBe(false);

    combat.setTarget(target);
    expect(combat.hasTarget()).toBe(true);

    combat.clearTarget();
    expect(combat.hasTarget()).toBe(false);
  });
});
