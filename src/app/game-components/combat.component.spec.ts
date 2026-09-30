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
  describe('holds its rate at any sub-step length (TODO E86)', () => {
    /** A unit that fires whenever it can, as a tower with a target: shots in `seconds` at `stepsPerSecond` */
    function shots(fireRate: number, stepsPerSecond: number, seconds = 10): number {
      const combat = new CombatComponent(gameObject, { damage: 1, range: 1, fireRate });
      const stepMs = 1000 / stepsPerSecond;
      let fired = 0;
      for (let step = 0; step < seconds * stepsPerSecond; step++) {
        combat.update(stepMs);
        if (combat.canFire()) {
          combat.fire();
          fired++;
        }
      }
      return fired;
    }

    it('fires rate times ten shots in ten seconds, at 60 and at 30 sub-steps a second', () => {
      for (const rate of [0.33, 0.5, 1, 1.5, 3, 5, 7.3, 11.9, 15.2, 25]) {
        for (const stepsPerSecond of [60, 30]) {
          const fired = shots(rate, stepsPerSecond);
          // The first shot goes at once; after it one per interval, none lost to the sub-step's length
          expect(fired, `${rate}/s at ${stepsPerSecond} steps`).toBeGreaterThanOrEqual(Math.floor(rate * 10));
          expect(fired, `${rate}/s at ${stepsPerSecond} steps`).toBeLessThanOrEqual(Math.floor(rate * 10) + 1);
        }
      }
    });

    it('fires no more than once a sub-step, however high the rate', () => {
      expect(shots(100, 30, 1)).toBe(30);
    });

    it('saves up nothing while it does not fire: after a wait the next shot, then a whole interval', () => {
      const combat = new CombatComponent(gameObject, { damage: 1, range: 1, fireRate: 5 });
      combat.fire();
      // The cooldown of 200 ms runs out in the seventh sub-step of 33.3 ms; nobody to shoot at for a second
      for (let step = 0; step < 30; step++) combat.update(1000 / 30);
      expect(combat.canFire()).toBe(true);
      expect(combat.cooldownRemaining).toBe(0);
      combat.fire();
      expect(combat.cooldownRemaining).toBe(200);
      let steps = 0;
      while (!combat.canFire()) {
        combat.update(1000 / 30);
        steps++;
      }
      expect(steps).toBe(6);
    });
  });
});
