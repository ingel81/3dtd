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

  it('tracks kill count', () => {
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 2 });
    expect(combat.kills).toBe(0);
    combat.kills++;
    expect(combat.kills).toBe(1);
  });

  it('canFire accounts for timescale', () => {
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 1 });
    // fireRate=1 → 1000ms interval at 1x, 500ms at 2x
    combat.fire(0);
    expect(combat.canFire(400, 2.0)).toBe(false);
    expect(combat.canFire(500, 2.0)).toBe(true);
  });
});
