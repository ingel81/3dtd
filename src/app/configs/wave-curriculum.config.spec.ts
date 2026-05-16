import { describe, it, expect } from 'vitest';
import {
  WAVE_CURRICULUM,
  goldBudgetForWave,
  endgameHpMultiplier,
  enemyBaseDamageForWave,
  templateForWave,
  templateObjectForWave,
} from './wave-curriculum.config';
import { TEMPLATES } from '../ai/core/templates';

describe('wave-curriculum.config', () => {
  // ===================================================================
  // WAVE_CURRICULUM data integrity
  // ===================================================================
  describe('WAVE_CURRICULUM data', () => {
    it('has 30 entries', () => {
      expect(WAVE_CURRICULUM.length).toBe(30);
    });

    it('every entry has a non-empty template id, positive goldKill, positive goldComplete', () => {
      for (const entry of WAVE_CURRICULUM) {
        expect(entry.template).toBeTruthy();
        expect(entry.goldKill).toBeGreaterThan(0);
        expect(entry.goldComplete).toBeGreaterThan(0);
      }
    });

    it('gold budgets are strictly increasing across the 30 waves', () => {
      for (let i = 1; i < WAVE_CURRICULUM.length; i++) {
        expect(WAVE_CURRICULUM[i].goldKill).toBeGreaterThan(WAVE_CURRICULUM[i - 1].goldKill);
        expect(WAVE_CURRICULUM[i].goldComplete).toBeGreaterThan(WAVE_CURRICULUM[i - 1].goldComplete);
      }
    });

    it('wave 1 is zombie_horde and wave 10 is boss_herbert', () => {
      expect(WAVE_CURRICULUM[0].template).toBe('zombie_horde');
      expect(WAVE_CURRICULUM[9].template).toBe('boss_herbert');
    });
  });

  // ===================================================================
  // goldBudgetForWave
  // ===================================================================
  describe('goldBudgetForWave()', () => {
    it('wave 0 and negative wave numbers return { kill: 0, complete: 0 }', () => {
      expect(goldBudgetForWave(0)).toEqual({ kill: 0, complete: 0 });
      expect(goldBudgetForWave(-5)).toEqual({ kill: 0, complete: 0 });
    });

    it('wave 1 returns first curriculum entry values', () => {
      const w1 = WAVE_CURRICULUM[0];
      expect(goldBudgetForWave(1)).toEqual({ kill: w1.goldKill, complete: w1.goldComplete });
    });

    it('wave 30 returns last curriculum entry values', () => {
      const w30 = WAVE_CURRICULUM[29];
      expect(goldBudgetForWave(30)).toEqual({ kill: w30.goldKill, complete: w30.goldComplete });
    });

    it('mid-curriculum wave 10 returns expected values', () => {
      // Wave 10 is boss_herbert: goldKill: 125, goldComplete: 60
      expect(goldBudgetForWave(10)).toEqual({ kill: 125, complete: 60 });
    });

    it('wave 31 extrapolates linearly beyond the 30-entry curriculum', () => {
      const last = WAVE_CURRICULUM[29];
      const w31 = goldBudgetForWave(31);
      expect(w31.kill).toBe(last.goldKill + 50);
      expect(w31.complete).toBe(last.goldComplete + 30);
    });

    it('wave 35 extrapolates correctly (5 extra waves)', () => {
      const last = WAVE_CURRICULUM[29];
      const w35 = goldBudgetForWave(35);
      expect(w35.kill).toBe(last.goldKill + 5 * 50);
      expect(w35.complete).toBe(last.goldComplete + 5 * 30);
    });

    it('extrapolated budgets are strictly larger than wave 30 values', () => {
      const w30 = goldBudgetForWave(30);
      const w50 = goldBudgetForWave(50);
      expect(w50.kill).toBeGreaterThan(w30.kill);
      expect(w50.complete).toBeGreaterThan(w30.complete);
    });
  });

  // ===================================================================
  // endgameHpMultiplier
  // ===================================================================
  describe('endgameHpMultiplier()', () => {
    it('waves 1-20 return 1.0 (no bonus)', () => {
      for (const w of [1, 5, 10, 15, 19, 20]) {
        expect(endgameHpMultiplier(w)).toBe(1.0);
      }
    });

    it('wave 21 starts the ramp: 1.0 + 0.05*(21-20) = 1.05', () => {
      expect(endgameHpMultiplier(21)).toBeCloseTo(1.05, 5);
    });

    it('wave 30 delivers 1.0 + 0.05*10 = 1.5', () => {
      expect(endgameHpMultiplier(30)).toBeCloseTo(1.5, 5);
    });

    it('wave 50 delivers 1.0 + 0.05*30 = 2.5', () => {
      expect(endgameHpMultiplier(50)).toBeCloseTo(2.5, 5);
    });

    it('wave 80 delivers exactly the cap of 4.0', () => {
      expect(endgameHpMultiplier(80)).toBe(4.0);
    });

    it('wave 100 is capped at 4.0 (does not exceed cap)', () => {
      expect(endgameHpMultiplier(100)).toBe(4.0);
    });
  });

  // ===================================================================
  // enemyBaseDamageForWave
  // ===================================================================
  describe('enemyBaseDamageForWave()', () => {
    it('waves 1-10 return 1', () => {
      for (const w of [1, 5, 10]) {
        expect(enemyBaseDamageForWave(w)).toBe(1);
      }
    });

    it('wave 11 returns 2', () => {
      expect(enemyBaseDamageForWave(11)).toBe(2);
    });

    it('wave 20 returns 2', () => {
      expect(enemyBaseDamageForWave(20)).toBe(2);
    });

    it('wave 21 returns 3', () => {
      expect(enemyBaseDamageForWave(21)).toBe(3);
    });

    it('wave 30 returns 3', () => {
      expect(enemyBaseDamageForWave(30)).toBe(3);
    });

    it('wave 31 returns 4', () => {
      expect(enemyBaseDamageForWave(31)).toBe(4);
    });

    it('damage steps up by 1 every 10 waves after wave 10', () => {
      // Verify step boundaries: 11→2, 21→3, 31→4, 41→5, 51→6
      const expected: [number, number][] = [
        [11, 2], [21, 3], [31, 4], [41, 5], [51, 6],
      ];
      for (const [wave, dmg] of expected) {
        expect(enemyBaseDamageForWave(wave)).toBe(dmg);
      }
    });

    // NOTE: wave 0 / negative not specified in the function docs. Observed behaviour: ≥1.
    // Function uses `if (waveNum < 11) return 1`, so 0 and negative → 1.
    it('wave 0 returns 1 (robustness)', () => {
      expect(enemyBaseDamageForWave(0)).toBe(1);
    });
  });

  // ===================================================================
  // templateForWave
  // ===================================================================
  describe('templateForWave()', () => {
    it('wave 0 and negative wave numbers return null', () => {
      expect(templateForWave(0)).toBeNull();
      expect(templateForWave(-1)).toBeNull();
    });

    it('wave 1 returns zombie_horde', () => {
      expect(templateForWave(1)).toBe('zombie_horde');
    });

    it('wave 30 returns boss_herbert', () => {
      expect(templateForWave(30)).toBe('boss_herbert');
    });

    it('wave 31 loops back to wave 1 template (zombie_horde)', () => {
      expect(templateForWave(31)).toBe(templateForWave(1));
    });

    it('wave 32 loops back to wave 2 template', () => {
      expect(templateForWave(32)).toBe(templateForWave(2));
    });

    it('wave 60 (30+30) maps to wave 30 template', () => {
      expect(templateForWave(60)).toBe(templateForWave(30));
    });

    it('all 30 waves return non-null non-empty strings', () => {
      for (let w = 1; w <= 30; w++) {
        const t = templateForWave(w);
        expect(t).toBeTruthy();
        expect(typeof t).toBe('string');
      }
    });
  });

  // ===================================================================
  // templateObjectForWave
  // ===================================================================
  describe('templateObjectForWave()', () => {
    it('wave 0 returns null', () => {
      expect(templateObjectForWave(0)).toBeNull();
    });

    it('wave 1 returns a Template object with id matching templateForWave(1)', () => {
      const obj = templateObjectForWave(1);
      expect(obj).not.toBeNull();
      expect(obj!.id).toBe(templateForWave(1));
    });

    it('every wave 1-30 returns a Template whose id matches templateForWave()', () => {
      for (let w = 1; w <= 30; w++) {
        const obj = templateObjectForWave(w);
        expect(obj).not.toBeNull();
        expect(obj!.id).toBe(templateForWave(w));
      }
    });

    it('returned Template objects are found in TEMPLATES array', () => {
      for (let w = 1; w <= 30; w++) {
        const obj = templateObjectForWave(w);
        expect(TEMPLATES.find(t => t.id === obj!.id)).toBeDefined();
      }
    });
  });
});
