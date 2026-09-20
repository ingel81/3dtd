import { beforeEach, describe, it, expect, vi } from 'vitest';

// Angular Injectable must be a no-op — EconomyService uses no inject(), so we
// can construct it directly once the decorator is stripped.
vi.mock('@angular/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@angular/core');
  return {
    ...actual,
    Injectable: () => (target: unknown) => target,
  };
});

import { EconomyService, skippedWavesGold, waveGoldTotal } from './economy.service';
import { GAME_BALANCE } from '../configs/game-balance.config';
import { waveGold } from '../configs/campaign.config';

// ---------------------------------------------------------------------------
// Helpers — derive expected values from real config so tests stay aligned with
// balance changes without becoming implementation copies.
// ---------------------------------------------------------------------------

function perfectBonus(base: number): number {
  return Math.round(base * GAME_BALANCE.economy.perfectBonusRatio);
}

function closeCallBonus(base: number): number {
  return Math.round(base * GAME_BALANCE.economy.closeCallBonusRatio);
}

function comboBonus(base: number, streak: number): number {
  const mul = Math.min(
    GAME_BALANCE.economy.comboBonusMax,
    streak * GAME_BALANCE.economy.comboBonusPerStreak,
  );
  return Math.round(base * mul);
}

function comebackBonus(hpLost: number): number {
  return Math.min(
    GAME_BALANCE.economy.comebackBonusCap,
    Math.round(hpLost * GAME_BALANCE.economy.comebackBonusSlope),
  );
}

// Shorthand: wave n base completion credit
function waveBase(wave: number): number {
  return waveGold(wave).complete;
}

describe('EconomyService', () => {
  let service: EconomyService;

  beforeEach(() => {
    service = new EconomyService();
  });

  // -------------------------------------------------------------------------
  // reset()
  // -------------------------------------------------------------------------
  describe('reset()', () => {
    it('initialises with streak 0', () => {
      expect(service.perfectStreak).toBe(0);
    });

    it('resets perfectStreak to 0 after accumulated streak', () => {
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 1, perfect: true, closeCall: false, hpLost: 0 }));
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 2, perfect: true, closeCall: false, hpLost: 0 }));
      expect(service.perfectStreak).toBe(2);

      service.reset();
      expect(service.perfectStreak).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Base bonus only (no perfect, no extras)
  // -------------------------------------------------------------------------
  describe('the parts of the gold', () => {
    it('names every bonus on its own, so the run log can split them', () => {
      const base = waveBase(10);
      const breakdown = service.computeWaveCompletionBonus({
        wave: 10, perfect: true, closeCall: false, hpLost: 0,
      });

      expect(breakdown).toEqual({
        base,
        perfect: perfectBonus(base),
        combo: comboBonus(base, 1),
        closeCall: 0,
        comeback: 0,
        milestone: GAME_BALANCE.economy.milestoneBonuses[10] ?? 0,
      });
      expect(waveGoldTotal(breakdown)).toBe(
        base + perfectBonus(base) + comboBonus(base, 1) + (GAME_BALANCE.economy.milestoneBonuses[10] ?? 0),
      );
    });
  });

  describe('computeWaveCompletionBonus() — base only', () => {
    it('returns the campaign completion budget for a plain non-perfect wave', () => {
      const base = waveBase(1); // 15
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 1,
        perfect: false,
        closeCall: false,
        hpLost: 0,
      }));
      // No bonuses, no streak after non-perfect
      expect(result).toBe(base);
    });

    it('uses waveGold().complete as the base for any wave number', () => {
      const base5 = waveBase(5); // 30
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 5,
        perfect: false,
        closeCall: false,
        hpLost: 0,
      }));
      expect(result).toBe(base5);
    });
  });

  // -------------------------------------------------------------------------
  // Perfect-Wave bonus
  // -------------------------------------------------------------------------
  describe('perfect-wave bonus', () => {
    it('adds perfectBonus on top of base for a perfect wave', () => {
      const base = waveBase(1); // 15
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 1,
        perfect: true,
        closeCall: false,
        hpLost: 0,
      }));
      // streak becomes 1 after this call → comboBonus(base, 1)
      const expected = base + perfectBonus(base) + comboBonus(base, 1);
      expect(result).toBe(expected);
    });

    it('does NOT add perfectBonus when perfect is false', () => {
      const base = waveBase(2); // 18
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 2,
        perfect: false,
        closeCall: false,
        hpLost: 0,
      }));
      // no perfect, no combo (streak stays 0)
      expect(result).toBe(base);
    });
  });

  // -------------------------------------------------------------------------
  // Combo-streak accumulation
  // -------------------------------------------------------------------------
  describe('combo-streak accumulation', () => {
    it('increments streak with each consecutive perfect wave', () => {
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 1, perfect: true, closeCall: false, hpLost: 0 }));
      expect(service.perfectStreak).toBe(1);
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 2, perfect: true, closeCall: false, hpLost: 0 }));
      expect(service.perfectStreak).toBe(2);
    });

    it('adds increasing comboBonus over consecutive perfect waves', () => {
      // wave 1: streak becomes 1
      const r1 = waveGoldTotal(service.computeWaveCompletionBonus({ wave: 1, perfect: true, closeCall: false, hpLost: 0 }));
      const b1 = waveBase(1);
      expect(r1).toBe(b1 + perfectBonus(b1) + comboBonus(b1, 1));

      // wave 2: streak becomes 2
      const r2 = waveGoldTotal(service.computeWaveCompletionBonus({ wave: 2, perfect: true, closeCall: false, hpLost: 0 }));
      const b2 = waveBase(2);
      expect(r2).toBe(b2 + perfectBonus(b2) + comboBonus(b2, 2));
    });

    it('caps combo multiplier at comboBonusMax (streaks ≥ 6)', () => {
      // Advance streak to 6 via waves 1-6
      for (let w = 1; w <= 5; w++) {
        waveGoldTotal(service.computeWaveCompletionBonus({ wave: w, perfect: true, closeCall: false, hpLost: 0 }));
      }
      expect(service.perfectStreak).toBe(5);

      // wave 6: streak becomes 6 → multiplier = min(0.30, 6*0.05) = 0.30
      const b6 = waveBase(6);
      const result = waveGoldTotal(service.computeWaveCompletionBonus({ wave: 6, perfect: true, closeCall: false, hpLost: 0 }));
      const expected = b6 + perfectBonus(b6) + comboBonus(b6, 6);
      expect(result).toBe(expected);

      // wave 7: streak = 7 but cap still 0.30
      const b7 = waveBase(7);
      const resultW7 = waveGoldTotal(service.computeWaveCompletionBonus({ wave: 7, perfect: true, closeCall: false, hpLost: 0 }));
      // streak 7 → min(0.30, 7*0.05=0.35) = 0.30 — same ratio as streak 6
      expect(resultW7).toBe(b7 + perfectBonus(b7) + comboBonus(b7, 7));
      // Verify the cap is the same value as streak 6 for the same base
      expect(comboBonus(b7, 7)).toBe(comboBonus(b7, 6));
    });

    it('resets streak to 0 after a non-perfect wave', () => {
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 1, perfect: true, closeCall: false, hpLost: 0 }));
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 2, perfect: true, closeCall: false, hpLost: 0 }));
      expect(service.perfectStreak).toBe(2);

      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 3, perfect: false, closeCall: false, hpLost: 0 }));
      expect(service.perfectStreak).toBe(0);
    });

    it('streak-reset non-perfect wave yields no combo bonus', () => {
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 1, perfect: true, closeCall: false, hpLost: 0 }));
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 2, perfect: true, closeCall: false, hpLost: 0 }));

      const base = waveBase(3);
      const result = waveGoldTotal(service.computeWaveCompletionBonus({ wave: 3, perfect: false, closeCall: false, hpLost: 0 }));
      // streak resets → comboMultiplier = min(0.30, 0*0.05) = 0 → comboBonus = 0
      expect(result).toBe(base + comboBonus(base, 0));
      expect(result).toBe(base);
    });

    it('streak restarts from 1 after a non-perfect break', () => {
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 1, perfect: true, closeCall: false, hpLost: 0 }));
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 2, perfect: false, closeCall: false, hpLost: 0 }));
      // now wave 3 perfect → streak should be 1, not 3
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 3, perfect: true, closeCall: false, hpLost: 0 }));
      expect(service.perfectStreak).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // CloseCall bonus
  // -------------------------------------------------------------------------
  describe('closeCall bonus', () => {
    it('adds closeCallBonus on top of base when closeCall is true', () => {
      const base = waveBase(1);
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 1,
        perfect: false,
        closeCall: true,
        hpLost: 0,
      }));
      // non-perfect → no perfect bonus, no combo (streak=0)
      expect(result).toBe(base + closeCallBonus(base));
    });

    it('does not add closeCallBonus when closeCall is false', () => {
      const base = waveBase(1);
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 1,
        perfect: false,
        closeCall: false,
        hpLost: 0,
      }));
      expect(result).toBe(base);
    });

    it('closeCall and perfect bonuses stack independently', () => {
      const base = waveBase(1);
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 1,
        perfect: true,
        closeCall: true,
        hpLost: 0,
      }));
      const expected = base + perfectBonus(base) + closeCallBonus(base) + comboBonus(base, 1);
      expect(result).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // Comeback bonus (hpLost)
  // -------------------------------------------------------------------------
  describe('comeback bonus', () => {
    it('awards comeback bonus proportional to hpLost', () => {
      const base = waveBase(1);
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 1,
        perfect: false,
        closeCall: false,
        hpLost: 10,
      }));
      expect(result).toBe(base + comebackBonus(10));
    });

    it('awards no comeback bonus when hpLost is 0', () => {
      const base = waveBase(1);
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 1,
        perfect: false,
        closeCall: false,
        hpLost: 0,
      }));
      expect(result).toBe(base);
    });

    it('caps comeback bonus at comebackBonusCap even with high hpLost', () => {
      const base = waveBase(1);
      const highHpLost = 9999;
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 1,
        perfect: false,
        closeCall: false,
        hpLost: highHpLost,
      }));
      expect(result).toBe(base + GAME_BALANCE.economy.comebackBonusCap);
    });

    it('comeback and closeCall are independent bonuses', () => {
      const base = waveBase(1);
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 1,
        perfect: false,
        closeCall: true,
        hpLost: 10,
      }));
      expect(result).toBe(base + closeCallBonus(base) + comebackBonus(10));
    });
  });

  // -------------------------------------------------------------------------
  // Milestone bonus
  // -------------------------------------------------------------------------
  describe('milestone bonus', () => {
    it('adds flat milestone bonus on milestone waves (wave 10)', () => {
      const base = waveBase(10);
      const milestone = GAME_BALANCE.economy.milestoneBonuses[10]; // 45
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 10,
        perfect: false,
        closeCall: false,
        hpLost: 0,
      }));
      expect(result).toBe(base + milestone);
    });

    it('adds no milestone bonus on non-milestone waves', () => {
      const wave = 3; // no milestone
      const base = waveBase(wave);
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave,
        perfect: false,
        closeCall: false,
        hpLost: 0,
      }));
      expect(result).toBe(base);
    });

    it('milestone stacks with perfect and combo bonuses', () => {
      const wave = 10;
      const base = waveBase(wave);
      const milestone = GAME_BALANCE.economy.milestoneBonuses[10];
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave,
        perfect: true,
        closeCall: false,
        hpLost: 0,
      }));
      // streak becomes 1
      const expected = base + perfectBonus(base) + milestone + comboBonus(base, 1);
      expect(result).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // Combination scenarios
  // -------------------------------------------------------------------------
  describe('combined bonuses', () => {
    it('all bonuses stack correctly for a perfect, closeCall, milestone wave with hpLost', () => {
      const wave = 10;
      const base = waveBase(wave);
      const milestone = GAME_BALANCE.economy.milestoneBonuses[10];
      // Accumulate a streak of 2 before this wave
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 1, perfect: true, closeCall: false, hpLost: 0 }));
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 2, perfect: true, closeCall: false, hpLost: 0 }));

      // Wave 10 is perfect + closeCall + hpLost (milestone)
      // Note: perfect=true overrides comebackBonus being useful, but both still stack in code
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave,
        perfect: true,
        closeCall: true,
        hpLost: 5,
      }));

      // streak was 2, now becomes 3
      const expected =
        base +
        perfectBonus(base) +
        closeCallBonus(base) +
        milestone +
        comebackBonus(5) +
        comboBonus(base, 3);
      expect(result).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // Robustness — wave 0 / negative wave
  // -------------------------------------------------------------------------
  describe('robustness — edge-case wave numbers', () => {
    it('returns 0 for wave 0 (waveGold(0) returns {complete: 0})', () => {
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 0,
        perfect: true,
        closeCall: true,
        hpLost: 99,
      }));
      // base = 0, perfect*0=0, closeCall*0=0, combo*0=0, comeback = comebackBonus(99) capped
      // milestone[0] = undefined → ?? 0
      const expected = comebackBonus(99); // only comeback (non-zero because hpLost > 0)
      expect(result).toBe(expected);
    });

    it('returns 0 base for negative wave number (no throw)', () => {
      expect(() =>
        waveGoldTotal(service.computeWaveCompletionBonus({ wave: -5, perfect: false, closeCall: false, hpLost: 0 }))
      ).not.toThrow();
    });

    it('handles the tapered budget for waves beyond the campaign', () => {
      const base31 = waveGold(31).complete;
      const result = waveGoldTotal(service.computeWaveCompletionBonus({
        wave: 31,
        perfect: false,
        closeCall: false,
        hpLost: 0,
      }));
      expect(result).toBe(base31); // no extra bonuses
      // Past W30 income tapers toward a sustain floor rather than restarting
      // the campaign, so wave 31 sits below wave 30 and above wave 1.
      expect(base31).toBeLessThan(waveBase(30));
      expect(base31).toBeGreaterThan(waveBase(1));
    });
  });

  // -------------------------------------------------------------------------
  // Gold of the waves a dev jump skips
  // -------------------------------------------------------------------------
  describe('skippedWavesGold() (wave jump)', () => {
    it('pays kill budget, base completion bonus and milestones of every skipped wave', () => {
      let expected = 0;
      for (let w = 1; w <= 13; w++) {
        expected += waveGold(w).kill + waveGold(w).complete;
      }
      expected += GAME_BALANCE.economy.milestoneBonuses[10];
      expect(skippedWavesGold(1, 13)).toBe(expected);
    });

    it('pays no skill bonus and leaves the perfect streak alone', () => {
      waveGoldTotal(service.computeWaveCompletionBonus({ wave: 1, perfect: true, closeCall: false, hpLost: 0 }));
      expect(skippedWavesGold(2, 2)).toBe(waveGold(2).kill + waveBase(2));
      expect(service.perfectStreak).toBe(1);
    });

    it('reads the tapered budget past the campaign', () => {
      const w31to34 = [31, 32, 33, 34].reduce(
        (sum, w) => sum + waveGold(w).kill + waveGold(w).complete, 0);
      expect(skippedWavesGold(31, 34)).toBe(w31to34);
    });

    it('pays nothing for an empty range or waves before 1', () => {
      expect(skippedWavesGold(5, 4)).toBe(0);
      expect(skippedWavesGold(-3, 0)).toBe(0);
    });
  });
});
