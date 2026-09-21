import { describe, it, expect } from 'vitest';
import {
  CAMPAIGN,
  waveGold,
  endgameHpMultiplier,
  enemyBaseDamageForWave,
  templateForWave,
  templateObjectForWave,
  isBossWave,
  CAMPAIGN_LENGTH,
  campaignIntensity,
} from './campaign.config';
import { TEMPLATES } from '../director/templates';

describe('campaign.config', () => {
  // ===================================================================
  // CAMPAIGN data integrity
  // ===================================================================
  describe('CAMPAIGN data', () => {
    it('has 30 entries', () => {
      expect(CAMPAIGN.length).toBe(30);
    });

    it('every entry has a non-empty template id, positive killGold, positive completionGold', () => {
      for (const entry of CAMPAIGN) {
        expect(entry.template).toBeTruthy();
        expect(entry.killGold).toBeGreaterThan(0);
        expect(entry.completionGold).toBeGreaterThan(0);
      }
    });

    it('gold budgets trend upward over the 30 waves (boss bonus dips allowed)', () => {
      // Boss waves (W10/W20/W30) get a bonus peak, so the wave AFTER a boss
      // can be lower than the boss wave itself. Verify the trend by comparing
      // each wave to the wave two before — that absorbs single-step boss dips.
      for (let i = 2; i < CAMPAIGN.length; i++) {
        expect(CAMPAIGN[i].killGold).toBeGreaterThan(CAMPAIGN[i - 2].killGold);
        expect(CAMPAIGN[i].completionGold).toBeGreaterThan(CAMPAIGN[i - 2].completionGold);
      }
      // And the final wave is much bigger than the first.
      expect(CAMPAIGN[29].killGold).toBeGreaterThan(CAMPAIGN[0].killGold * 100);
    });

    it('wave 1 is zombie_horde and wave 10 is boss_herbert', () => {
      expect(CAMPAIGN[0].template).toBe('zombie_horde');
      expect(CAMPAIGN[9].template).toBe('boss_herbert');
    });
  });

  // ===================================================================
  // waveGold
  // ===================================================================
  describe('waveGold()', () => {
    it('wave 0 and negative wave numbers return { kill: 0, complete: 0 }', () => {
      expect(waveGold(0)).toEqual({ kill: 0, complete: 0 });
      expect(waveGold(-5)).toEqual({ kill: 0, complete: 0 });
    });

    it('wave 1 returns first campaign entry values', () => {
      const w1 = CAMPAIGN[0];
      expect(waveGold(1)).toEqual({ kill: w1.killGold, complete: w1.completionGold });
    });

    it('wave 30 returns last campaign entry values', () => {
      const w30 = CAMPAIGN[29];
      expect(waveGold(30)).toEqual({ kill: w30.killGold, complete: w30.completionGold });
    });

    it('mid-campaign wave 10 returns the boss_herbert entry values', () => {
      // Wave 10 = boss_herbert (BOSS 1, bonus peak in the rebalanced campaign)
      const w10 = CAMPAIGN[9];
      expect(waveGold(10)).toEqual({ kill: w10.killGold, complete: w10.completionGold });
    });

    it('income tapers past the campaign instead of restarting it', () => {
      // It used to loop: wave 31 dropped from 180,000 gold back to 200 and
      // climbed all over again. Incoherent mid-run, and across 100 waves it
      // paid out 2.64M against a design roster costing 1.39M — enough for a
      // defense to finish its build-out and keep going.
      const w30 = waveGold(30);
      const w31 = waveGold(31);
      const w1 = CAMPAIGN[0];
      expect(w31.kill).toBeLessThan(w30.kill);
      expect(w31.kill).toBeGreaterThan(w1.killGold);
    });

    it('income decreases monotonically past the campaign, boss waves aside', () => {
      const waves = [31, 32, 33, 34, 41, 61, 101].map((w) => waveGold(w).kill);
      for (let i = 1; i < waves.length; i++) {
        expect(waves[i]).toBeLessThanOrEqual(waves[i - 1]);
      }
    });

    it('boss waves past the campaign pay double', () => {
      expect(waveGold(40).kill).toBe(waveGold(41).kill * 2);
      expect(waveGold(40).complete).toBe(waveGold(41).complete * 2);
      expect(waveGold(36)).toEqual(waveGold(37));
    });

    it('income settles on a sustain floor rather than reaching zero', () => {
      const late = waveGold(101);
      expect(late.kill).toBeGreaterThan(0);
      expect(waveGold(201).kill).toBe(late.kill);
    });

    it('a 100-wave run funds the design roster without doubling it', () => {
      // The roster — one of each tower plus three archers, every upgrade track
      // maxed, all research — costs about 1.39M. The run should pay for it with
      // a working reserve, not for two of them.
      let total = 0;
      for (let w = 1; w <= 100; w++) {
        const g = waveGold(w);
        total += g.kill + g.complete;
      }
      expect(total).toBeGreaterThan(1_400_000);
      expect(total).toBeLessThan(1_800_000);
    });
  });

  // ===================================================================
  // isBossWave
  // ===================================================================
  describe('isBossWave()', () => {
    it('every 10th wave inside the campaign, every 5th after it', () => {
      const bosses = Array.from({ length: 60 }, (_, i) => i + 1).filter(isBossWave);
      expect(bosses).toEqual([10, 20, 30, 35, 40, 45, 50, 55, 60]);
      expect(isBossWave(0)).toBe(false);
    });

    it('agrees with the campaign pins', () => {
      for (let w = 1; w <= CAMPAIGN_LENGTH; w++) {
        const bossOnly = TEMPLATES.find((t) => t.id === templateForWave(w))!.bossOnly;
        expect(isBossWave(w), `wave ${w}`).toBe(bossOnly);
      }
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

    it('returns null past the scripted run so the AI picks for itself', () => {
      // The campaign used to loop mod-30. It no longer does: the designer
      // owns content through wave 30, and from wave 31 the Wave Director's
      // template head chooses under the normal availability mask. Gold budget
      // and the AI-off static fallback still loop — those need a value at every
      // wave number and are asserted separately.
      expect(CAMPAIGN_LENGTH).toBe(30);
      expect(templateForWave(31)).toBeNull();
      expect(templateForWave(32)).toBeNull();
      expect(templateForWave(60)).toBeNull();
    });

    it('templateObjectForWave is null past the scripted run too', () => {
      expect(templateObjectForWave(31)).toBeNull();
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

describe('the campaign intensity', () => {
  it('is 1 where a wave says nothing', () => {
    expect(campaignIntensity(1)).toBe(1);
  });

  it('is 1 outside the campaign', () => {
    expect(campaignIntensity(0)).toBe(1);
    expect(campaignIntensity(CAMPAIGN_LENGTH + 1)).toBe(1);
  });

  it('carries what a wave asks for', () => {
    // W25 ended 38 of 85 expert runs before it was lowered
    expect(campaignIntensity(25)).toBeCloseTo(0.75);
    expect(campaignIntensity(26)).toBeCloseTo(0.6);
  });

  it('stays inside its bounds, whatever a wave writes', () => {
    const wild = [...CAMPAIGN];
    expect(Math.min(...wild.map((w) => w.intensity ?? 1))).toBeGreaterThanOrEqual(0.25);
    expect(Math.max(...wild.map((w) => w.intensity ?? 1))).toBeLessThanOrEqual(2);
  });
});
