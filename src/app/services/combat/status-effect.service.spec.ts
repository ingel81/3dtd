import { describe, it, expect, beforeEach, vi } from 'vitest';

// Injectable decorator → no-op so providedIn doesn't pull in the real
// platform. The service has no inject() of its own, so `new` works directly.
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
  };
});

import { StatusEffectService } from './status-effect.service';
import type { StatusEffectType } from '../../models/status-effects';

interface AppliedEffect {
  type: StatusEffectType;
  value: number;
  duration: number;
  startTime: number;
  sourceId: string;
}

/** Minimal Enemy stub — only the `movement` surface the service touches. */
function makeEnemy() {
  const statusEffects: AppliedEffect[] = [];
  return {
    movement: {
      statusEffects,
      applyStatusEffect(e: AppliedEffect) { statusEffects.push(e); },
      removeExpiredEffects: vi.fn(),
    },
  };
}

describe('StatusEffectService', () => {
  let service: StatusEffectService;
  let enemy: ReturnType<typeof makeEnemy>;
  let clock: number;

  beforeEach(() => {
    service = new StatusEffectService();
    enemy = makeEnemy();
    clock = 0;
  });

  // ────────────────────────────────────────────────────────────────
  // Game-clock provider
  // ────────────────────────────────────────────────────────────────
  describe('game-clock provider', () => {
    it('defaults startTime to 0 before a provider is wired', () => {
      service.applySlow(enemy as never, 0.5, 1000, 'ice-1');
      expect(enemy.movement.statusEffects[0].startTime).toBe(0);
    });

    it('stamps startTime with the current game-clock value', () => {
      service.setGameClockProvider(() => clock);
      clock = 4200;
      service.applySlow(enemy as never, 0.5, 1000, 'ice-1');
      expect(enemy.movement.statusEffects[0].startTime).toBe(4200);
    });

    it('reads the clock fresh on every apply call', () => {
      service.setGameClockProvider(() => clock);
      clock = 100;
      service.applyPoison(enemy as never, 5, 2000, 'p-1');
      clock = 900;
      service.applyPoison(enemy as never, 5, 2000, 'p-2');
      expect(enemy.movement.statusEffects[0].startTime).toBe(100);
      expect(enemy.movement.statusEffects[1].startTime).toBe(900);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // apply* — delegation shape
  // ────────────────────────────────────────────────────────────────
  describe('applySlow / applyPoison / applyEffect', () => {
    it('applySlow forwards a slow effect with the given parameters', () => {
      service.applySlow(enemy as never, 0.4, 1500, 'ice-tower');
      expect(enemy.movement.statusEffects[0]).toMatchObject({
        type: 'slow', value: 0.4, duration: 1500, sourceId: 'ice-tower',
      });
    });

    it('applyPoison forwards a poison effect with the DoT value', () => {
      service.applyPoison(enemy as never, 12, 3000, 'poison-tower');
      expect(enemy.movement.statusEffects[0]).toMatchObject({
        type: 'poison', value: 12, duration: 3000, sourceId: 'poison-tower',
      });
    });

    it('applyEffect forwards an arbitrary effect type verbatim', () => {
      service.applyEffect(enemy as never, 'freeze' as StatusEffectType, 1, 800, 'src');
      expect(enemy.movement.statusEffects[0]).toMatchObject({
        type: 'freeze', value: 1, duration: 800, sourceId: 'src',
      });
    });
  });

  // ────────────────────────────────────────────────────────────────
  // removeExpired
  // ────────────────────────────────────────────────────────────────
  describe('removeExpired', () => {
    it('delegates to movement.removeExpiredEffects with the current clock', () => {
      service.setGameClockProvider(() => clock);
      clock = 7777;
      service.removeExpired(enemy as never);
      expect(enemy.movement.removeExpiredEffects).toHaveBeenCalledWith(7777);
    });
  });

  // ────────────────────────────────────────────────────────────────
  // hasActiveEffect — own logic: now - startTime < duration
  // ────────────────────────────────────────────────────────────────
  describe('hasActiveEffect', () => {
    beforeEach(() => {
      service.setGameClockProvider(() => clock);
    });

    it('returns true while an effect is within its duration', () => {
      clock = 0;
      service.applySlow(enemy as never, 0.5, 1000, 'ice-1');
      clock = 500;
      expect(service.hasActiveEffect(enemy as never, 'slow')).toBe(true);
    });

    it('returns false once the effect has expired', () => {
      clock = 0;
      service.applySlow(enemy as never, 0.5, 1000, 'ice-1');
      clock = 1500;
      expect(service.hasActiveEffect(enemy as never, 'slow')).toBe(false);
    });

    it('treats the exact duration boundary as expired (strict <)', () => {
      clock = 0;
      service.applySlow(enemy as never, 0.5, 1000, 'ice-1');
      clock = 1000;
      expect(service.hasActiveEffect(enemy as never, 'slow')).toBe(false);
    });

    it('returns false when no effect of the queried type exists', () => {
      clock = 0;
      service.applySlow(enemy as never, 0.5, 1000, 'ice-1');
      expect(service.hasActiveEffect(enemy as never, 'poison')).toBe(false);
    });

    it('returns false on an enemy with no effects at all', () => {
      expect(service.hasActiveEffect(enemy as never, 'slow')).toBe(false);
    });

    it('matches an active effect among several of mixed types', () => {
      clock = 0;
      service.applySlow(enemy as never, 0.5, 500, 'ice-1');   // expires at 500
      service.applyPoison(enemy as never, 5, 4000, 'p-1');    // expires at 4000
      clock = 1000;
      expect(service.hasActiveEffect(enemy as never, 'slow')).toBe(false);
      expect(service.hasActiveEffect(enemy as never, 'poison')).toBe(true);
    });
  });
});
