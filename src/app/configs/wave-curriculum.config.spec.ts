import { describe, it, expect } from 'vitest';
import {
  WAVE_CURRICULUM,
  STATIC_WAVE_PROFILES,
  goldBudgetForWave,
  endgameHpMultiplier,
  enemyBaseDamageForWave,
  templateForWave,
  templateObjectForWave,
  staticWaveProfileForWave,
  staticWaveResolvedFor,
} from './wave-curriculum.config';
import { TEMPLATES } from '../ai/core/templates';
import { ENEMY_TYPES } from './enemy-types.config';

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

    it('gold budgets trend upward over the 30 waves (boss bonus dips allowed)', () => {
      // Boss waves (W10/W20/W30) get a bonus peak, so the wave AFTER a boss
      // can be lower than the boss wave itself. Verify the trend by comparing
      // each wave to the wave two before — that absorbs single-step boss dips.
      for (let i = 2; i < WAVE_CURRICULUM.length; i++) {
        expect(WAVE_CURRICULUM[i].goldKill).toBeGreaterThan(WAVE_CURRICULUM[i - 2].goldKill);
        expect(WAVE_CURRICULUM[i].goldComplete).toBeGreaterThan(WAVE_CURRICULUM[i - 2].goldComplete);
      }
      // And the final wave is much bigger than the first.
      expect(WAVE_CURRICULUM[29].goldKill).toBeGreaterThan(WAVE_CURRICULUM[0].goldKill * 100);
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

    it('mid-curriculum wave 10 returns the boss_herbert entry values', () => {
      // Wave 10 = boss_herbert (BOSS 1, bonus peak in the rebalanced curriculum)
      const w10 = WAVE_CURRICULUM[9];
      expect(goldBudgetForWave(10)).toEqual({ kill: w10.goldKill, complete: w10.goldComplete });
    });

    it('wave 31 loops to wave 1 budget (templateForWave also loops mod 30)', () => {
      const w1 = WAVE_CURRICULUM[0];
      const w31 = goldBudgetForWave(31);
      expect(w31.kill).toBe(w1.goldKill);
      expect(w31.complete).toBe(w1.goldComplete);
    });

    it('wave 35 = wave 5 budget (loop continuation)', () => {
      const w5 = WAVE_CURRICULUM[4];
      const w35 = goldBudgetForWave(35);
      expect(w35.kill).toBe(w5.goldKill);
      expect(w35.complete).toBe(w5.goldComplete);
    });

    it('wave 60 = wave 30 budget (full loop), boss-bonus peak repeats', () => {
      const w30 = goldBudgetForWave(30);
      const w60 = goldBudgetForWave(60);
      expect(w60).toEqual(w30);
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

  // ===================================================================
  // STATIC_WAVE_PROFILES data integrity (multi-group native)
  // ===================================================================
  describe('STATIC_WAVE_PROFILES data', () => {
    it('has 30 entries', () => {
      expect(STATIC_WAVE_PROFILES.length).toBe(30);
    });

    it('every profile has wave === index+1, at least 1 group, positive counts', () => {
      STATIC_WAVE_PROFILES.forEach((p, i) => {
        expect(p.wave).toBe(i + 1);
        expect(p.groups.length).toBeGreaterThan(0);
        for (const g of p.groups) {
          expect(g.count).toBeGreaterThan(0);
          expect(g.hpMult).toBeGreaterThan(0);
          expect(ENEMY_TYPES[g.enemyType]).toBeDefined();
        }
        expect(p.spawnDelayMs).toBeGreaterThan(0);
      });
    });

    it('boss waves (W10/W20/W30) carry herbert + support groups', () => {
      for (const waveNum of [10, 20, 30]) {
        const p = STATIC_WAVE_PROFILES[waveNum - 1];
        const types = p.groups.map(g => g.enemyType);
        expect(types).toContain('herbert');
        // Boss waves are multi-group (boss + support), not solo Herbert
        expect(p.groups.length).toBeGreaterThan(1);
        expect(p.pattern).toBe('clustered');
      }
    });

    it('mixed-template waves expose multiple groups (W12 dragon_elite, W16 chaos_wave)', () => {
      const w12 = STATIC_WAVE_PROFILES[11];
      const w12Types = w12.groups.map(g => g.enemyType);
      expect(w12Types).toContain('dragon');
      expect(w12Types).toContain('hornet');

      const w16 = STATIC_WAVE_PROFILES[15];
      expect(w16.groups.length).toBe(4); // chaos_wave 4-mix
    });
  });

  // ===================================================================
  // staticWaveProfileForWave / staticWaveResolvedFor
  // ===================================================================
  describe('staticWaveProfileForWave()', () => {
    it('wave 0 and negative wave numbers return null', () => {
      expect(staticWaveProfileForWave(0)).toBeNull();
      expect(staticWaveProfileForWave(-1)).toBeNull();
    });

    it('wave 1 returns first profile', () => {
      expect(staticWaveProfileForWave(1)).toBe(STATIC_WAVE_PROFILES[0]);
    });

    it('wave 31 loops to wave 1 profile (mod-30)', () => {
      expect(staticWaveProfileForWave(31)).toBe(STATIC_WAVE_PROFILES[0]);
    });

    it('wave 60 loops to wave 30 profile (full loop)', () => {
      expect(staticWaveProfileForWave(60)).toBe(STATIC_WAVE_PROFILES[29]);
    });
  });

  describe('staticWaveResolvedFor()', () => {
    it('wave 0 returns null', () => {
      expect(staticWaveResolvedFor(0)).toBeNull();
    });

    it('single-group profile resolves to 1-entry AIWaveConfig', () => {
      const resolved = staticWaveResolvedFor(1);
      expect(resolved).not.toBeNull();
      expect(resolved!.enemies.length).toBe(1);
      expect(resolved!.enemies[0].type).toBe('zombie');
      expect(resolved!.enemies[0].count).toBe(20);
      expect(resolved!.totalCount).toBe(20);
    });

    it('multi-group profile (W10 boss) resolves to multi-entry AIWaveConfig with totalCount = sum', () => {
      const resolved = staticWaveResolvedFor(10);
      expect(resolved).not.toBeNull();
      expect(resolved!.enemies.length).toBeGreaterThan(1);
      const types = resolved!.enemies.map(e => e.type);
      expect(types).toContain('herbert');
      const expectedTotal = STATIC_WAVE_PROFILES[9].groups.reduce((s, g) => s + g.count, 0);
      expect(resolved!.totalCount).toBe(expectedTotal);
    });

    it('endgame HP ramp is baked into each group healthMultiplier post-W20', () => {
      // W30 boss: profile.hpMult 35 × endgameHpMultiplier(30)=1.5 = 52.5
      const resolved = staticWaveResolvedFor(30);
      expect(resolved).not.toBeNull();
      const boss = resolved!.enemies.find(e => e.type === 'herbert');
      expect(boss).toBeDefined();
      expect(boss!.healthMultiplier).toBeCloseTo(35 * endgameHpMultiplier(30), 5);
    });

    it('W1-20 see no endgame HP ramp (multiplier × 1.0)', () => {
      const resolved = staticWaveResolvedFor(1);
      const g = resolved!.enemies[0];
      // W1 zombie hpMult 0.8 × endgameHpMultiplier(1)=1.0 = 0.8
      expect(g.healthMultiplier).toBeCloseTo(0.8, 5);
    });

    it('W31 loops to W1 resolved shape (multi-group inclusive for boss loops)', () => {
      const w1 = staticWaveResolvedFor(1);
      const w31 = staticWaveResolvedFor(31);
      expect(w1).not.toBeNull();
      expect(w31).not.toBeNull();
      expect(w31!.enemies.length).toBe(w1!.enemies.length);
      expect(w31!.totalCount).toBe(w1!.totalCount);
      // Endgame ramp still flat at W31 (ramp starts post-W20 but loops at W31 mod 30=1 in template; ramp is per-wave-num, not per-profile)
      expect(w31!.enemies[0].healthMultiplier).toBeCloseTo(0.8 * endgameHpMultiplier(31), 5);
    });

    it('spawn pattern from profile is passed through to AIWaveConfig', () => {
      // W10 boss has pattern 'clustered'
      expect(staticWaveResolvedFor(10)!.pattern).toBe('clustered');
      // W6 spider is single-group with no pattern → undefined
      expect(staticWaveResolvedFor(6)!.pattern).toBeUndefined();
    });
  });
});
