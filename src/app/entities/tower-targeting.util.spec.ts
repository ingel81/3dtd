import { describe, it, expect } from 'vitest';
import { canTargetAirEffective } from './tower-targeting.util';

/**
 * canTargetAirEffective is a pure function over TOWER_TYPES + the
 * `aa-retrofit` research flag. Two independent inputs:
 *  - the static `canTargetAir` flag in the tower config (baseline)
 *  - `airTargetingUnlocked`, which whitelists `dual-gatling` only.
 */
describe('canTargetAirEffective', () => {
  // ────────────────────────────────────────────────────────────────
  // Baseline: static canTargetAir flag
  // ────────────────────────────────────────────────────────────────
  describe('towers with static canTargetAir: true', () => {
    // archer / rocket / ice / lightning carry canTargetAir: true in config.
    for (const id of ['archer', 'rocket', 'ice', 'lightning'] as const) {
      it(`${id} can target air regardless of research state`, () => {
        expect(canTargetAirEffective(id, false)).toBe(true);
        expect(canTargetAirEffective(id, true)).toBe(true);
      });
    }
  });

  describe('ground-only towers stay ground-only', () => {
    // cannon/magic/tentacle have no canTargetAir flag; fire/poison set it
    // explicitly to false. None are in the aa-retrofit whitelist.
    for (const id of ['cannon', 'magic', 'tentacle', 'fire', 'poison'] as const) {
      it(`${id} cannot target air even with research unlocked`, () => {
        expect(canTargetAirEffective(id, false)).toBe(false);
        expect(canTargetAirEffective(id, true)).toBe(false);
      });
    }
  });

  // ────────────────────────────────────────────────────────────────
  // aa-retrofit research: whitelists dual-gatling
  // ────────────────────────────────────────────────────────────────
  describe('aa-retrofit research', () => {
    it('dual-gatling is ground-only until air targeting is unlocked', () => {
      expect(canTargetAirEffective('dual-gatling', false)).toBe(false);
    });

    it('dual-gatling gains air targeting once research is unlocked', () => {
      expect(canTargetAirEffective('dual-gatling', true)).toBe(true);
    });

    it('research does not retrofit non-whitelisted ground towers', () => {
      // cannon is not in AA_RETROFIT_TOWERS — unlocking research is a no-op.
      expect(canTargetAirEffective('cannon', true)).toBe(false);
    });

    it('research does not change towers that already target air', () => {
      // archer is already air-capable; the whitelist branch is never reached.
      expect(canTargetAirEffective('archer', true)).toBe(true);
    });
  });
});
