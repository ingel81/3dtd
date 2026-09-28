import { describe, it, expect } from 'vitest';
import { CAMPAIGN, waveGold, enemyBaseDamageForWave } from './campaign.config';

describe('campaign.config', () => {
  // ===================================================================
  // CAMPAIGN data integrity
  // ===================================================================
  describe('CAMPAIGN data', () => {
    it('has 30 entries', () => {
      expect(CAMPAIGN.length).toBe(30);
    });

    it('every entry has positive killGold and positive completionGold', () => {
      for (const entry of CAMPAIGN) {
        expect(entry.killGold).toBeGreaterThan(0);
        expect(entry.completionGold).toBeGreaterThan(0);
      }
    });

    it('gold budgets trend upward over the 30 waves (boss bonus dips allowed)', () => {
      // Boss waves (W10/W20/W30) get a bonus peak, so the wave AFTER a boss
      // can be lower than the boss wave itself. Verify the trend by comparing
      // each wave to the wave two before, which absorbs single-step boss dips.
      for (let i = 2; i < CAMPAIGN.length; i++) {
        expect(CAMPAIGN[i].killGold).toBeGreaterThan(CAMPAIGN[i - 2].killGold);
        expect(CAMPAIGN[i].completionGold).toBeGreaterThan(CAMPAIGN[i - 2].completionGold);
      }
      // And the final wave is much bigger than the first.
      expect(CAMPAIGN[29].killGold).toBeGreaterThan(CAMPAIGN[0].killGold * 100);
    });
  });

  // ===================================================================
  // waveGold
  // ===================================================================
  describe('waveGold()', () => {
    it('wave 0 and negative wave numbers return { kill: 0, complete: 0 }', () => {
      expect(waveGold(0, false)).toEqual({ kill: 0, complete: 0 });
      expect(waveGold(-5, false)).toEqual({ kill: 0, complete: 0 });
    });

    it('wave 1 returns first campaign entry values', () => {
      const w1 = CAMPAIGN[0];
      expect(waveGold(1, false)).toEqual({ kill: w1.killGold, complete: w1.completionGold });
    });

    it('wave 30 returns last campaign entry values', () => {
      const w30 = CAMPAIGN[29];
      expect(waveGold(30, true)).toEqual({ kill: w30.killGold, complete: w30.completionGold });
    });

    it('inside the campaign the boss bonus is authored, not multiplied', () => {
      const w10 = CAMPAIGN[9];
      expect(waveGold(10, true)).toEqual({ kill: w10.killGold, complete: w10.completionGold });
      expect(waveGold(10, false)).toEqual(waveGold(10, true));
    });

    it('income tapers past the campaign instead of restarting it', () => {
      // It used to loop: wave 31 dropped from 180,000 gold back to 200 and
      // climbed all over again. Incoherent mid-run, and across 100 waves it
      // paid out 2.64M against a design roster costing 1.39M, enough for a
      // defense to finish its build-out and keep going.
      const w30 = waveGold(30, true);
      const w31 = waveGold(31, false);
      const w1 = CAMPAIGN[0];
      expect(w31.kill).toBeLessThan(w30.kill);
      expect(w31.kill).toBeGreaterThan(w1.killGold);
    });

    it('income decreases monotonically past the campaign, boss waves aside', () => {
      const waves = [31, 32, 33, 34, 41, 61, 101].map((w) => waveGold(w, false).kill);
      for (let i = 1; i < waves.length; i++) {
        expect(waves[i]).toBeLessThanOrEqual(waves[i - 1]);
      }
    });

    it('boss waves past the campaign pay double', () => {
      // On the sustain floor, where the taper no longer tells neighbours apart
      expect(waveGold(100, true).kill).toBe(waveGold(101, false).kill * 2);
      expect(waveGold(100, true).complete).toBe(waveGold(101, false).complete * 2);
      expect(waveGold(101, false)).toEqual(waveGold(102, false));
    });

    it('income settles on a sustain floor rather than reaching zero', () => {
      const late = waveGold(101, false);
      expect(late.kill).toBeGreaterThan(0);
      expect(waveGold(201, false).kill).toBe(late.kill);
    });

    it('a 100-wave run funds the design roster without doubling it', () => {
      // The roster (one of each tower plus three archers, every upgrade track
      // maxed, all research) costs about 1.39M. The run should pay for it with
      // a working reserve, not for two of them. Boss waves every tenth.
      let total = 0;
      for (let w = 1; w <= 100; w++) {
        const g = waveGold(w, w % 10 === 0);
        total += g.kill + g.complete;
      }
      expect(total).toBeGreaterThan(1_400_000);
      expect(total).toBeLessThan(1_800_000);
    });
  });

  // ===================================================================
  // enemyBaseDamageForWave
  // ===================================================================
  describe('enemyBaseDamageForWave()', () => {
    it('waves 1-30 return 1', () => {
      for (const w of [1, 5, 10, 20, 30]) {
        expect(enemyBaseDamageForWave(w)).toBe(1);
      }
    });

    it('wave 31 returns 2', () => {
      expect(enemyBaseDamageForWave(31)).toBe(2);
    });

    it('wave 61 returns 3', () => {
      expect(enemyBaseDamageForWave(61)).toBe(3);
    });

    it('damage steps up by 1 every 30 waves', () => {
      // Flacher als die alten 10 Wellen, damit die Auflösung des HP-Budgets
      // im Spätspiel nicht kollabiert: bei Welle 40 kostete ein einzelner
      // Durchbruch vorher rund 17 % der Rest-HP
      // (docs/DRAMA_CONTROLLER_PLAN.md).
      const expected: [number, number][] = [
        [30, 1], [31, 2], [60, 2], [61, 3], [91, 4],
      ];
      for (const [wave, dmg] of expected) {
        expect(enemyBaseDamageForWave(wave)).toBe(dmg);
      }
    });

    it('wave 0 returns 1 (robustness)', () => {
      expect(enemyBaseDamageForWave(0)).toBe(1);
    });
  });
});
