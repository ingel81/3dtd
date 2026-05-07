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

  it('canFire starts true and respects game-time cooldown after fire()', () => {
    // fireRate=2 → 500ms cooldown between shots (game-time)
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 2 });

    expect(combat.canFire()).toBe(true);

    combat.fire();
    expect(combat.canFire()).toBe(false);

    combat.update(250); // half cooldown elapsed
    expect(combat.canFire()).toBe(false);

    combat.update(300); // cooldown fully elapsed (+50 excess)
    expect(combat.canFire()).toBe(true);
  });

  it('canFire returns false when fireRate is zero', () => {
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 0 });

    expect(combat.canFire()).toBe(false);
    combat.update(10000);
    expect(combat.canFire()).toBe(false);
  });

  it('allows zero damage without breaking targeting', () => {
    const combat = new CombatComponent(gameObject, { damage: 0, range: 25, fireRate: 1 });
    expect(combat.damage).toBe(0);
    expect(combat.canFire()).toBe(true);
  });

  it('tracks kill count', () => {
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 2 });
    expect(combat.kills).toBe(0);
    combat.kills++;
    expect(combat.kills).toBe(1);
  });

  it('cooldown is stable across timescales (deltaTime is caller-scaled)', () => {
    // fireRate=1 → 1000ms cooldown in game-time regardless of wall-clock timescale.
    // Caller passes already-scaled deltaTime, so at 75x a single frame advances
    // ~1200ms game-time and the cooldown clears in one frame.
    const combatA = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 1 });
    combatA.fire();
    combatA.update(1200); // one frame at 75x (16ms real × 75)
    expect(combatA.canFire()).toBe(true);

    const combatB = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 1 });
    combatB.fire();
    combatB.update(16); // one frame at 1x
    expect(combatB.canFire()).toBe(false); // still 984ms cooldown
    combatB.update(1000);
    expect(combatB.canFire()).toBe(true);
  });

  it('single-shot per fire(): cooldown resets to full interval', () => {
    // With fixed-timestep sub-stepping (engine), the renderer never invokes
    // fire() multiple times per frame — each sub-step is small enough that
    // at most 1 shot fires per call. Hard reset matches 1× behavior.
    const combat = new CombatComponent(gameObject, { damage: 10, range: 25, fireRate: 2 });
    combat.update(60_000); // long frame
    expect(combat.canFire()).toBe(true);
    combat.fire();
    expect(combat.canFire()).toBe(false);
    // No second shot until next 500ms elapse, no matter how big the previous gap was
    combat.update(499);
    expect(combat.canFire()).toBe(false);
    combat.update(2);
    expect(combat.canFire()).toBe(true);
  });
});
