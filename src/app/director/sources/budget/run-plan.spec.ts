import { describe, expect, it } from 'vitest';
import { RUN_PLAN, RUN_PLAN_REPEAT, RUN_PLAN_RULES, planBaseGold, planLeakScale, planRowForWave } from './run-plan';
import { ENEMY_TYPES, type EnemyTypeId } from '../../../configs/enemy-types.config';
import { waveGold } from '../../../configs/campaign.config';

describe('run plan', () => {
  it('has one row per wave from 1, every enemy known, every count positive', () => {
    RUN_PLAN.forEach((row, i) => {
      expect(row.wave).toBe(i + 1);
      expect(row.spawnDelay).toBeGreaterThanOrEqual(0);
      expect(row.strength).toBeGreaterThan(0);
      for (const [type, count] of Object.entries(row.enemies)) {
        expect(ENEMY_TYPES[type as EnemyTypeId], `${row.wave} ${type}`).toBeDefined();
        expect(count).toBeGreaterThan(0);
      }
    });
  });

  it('has a boss every ten waves and nowhere else', () => {
    for (const row of RUN_PLAN) expect(row.boss === true, `wave ${row.wave}`).toBe(row.wave % 10 === 0);
  });

  it('repeats the last rows past the end', () => {
    const last = RUN_PLAN.length;
    expect(planRowForWave(last + 1)).toBe(RUN_PLAN[last - RUN_PLAN_REPEAT]);
    expect(planRowForWave(last + RUN_PLAN_REPEAT)).toBe(RUN_PLAN[last - 1]);
    expect(planRowForWave(last + RUN_PLAN_REPEAT + 1)).toBe(RUN_PLAN[last - RUN_PLAN_REPEAT]);
    expect(planRowForWave(0)).toBeNull();
  });

  it('makes a leak dearer steadily, without steps', () => {
    expect(planLeakScale(1)).toBe(1);
    for (let w = 2; w <= 120; w++) {
      expect(planLeakScale(w)).toBeGreaterThanOrEqual(planLeakScale(w - 1));
      expect(planLeakScale(w) - planLeakScale(w - 1)).toBeLessThan(0.1);
    }
    expect(planLeakScale(31)).toBeCloseTo(2, 0);
  });

  it('marks the plan boss waves, not the campaign cadence', () => {
    expect(RUN_PLAN_RULES.isBoss(35)).toBe(false);
    expect(RUN_PLAN_RULES.isBoss(40)).toBe(true);
  });

  it('pays gold on a smooth curve times the row strength', () => {
    for (let w = 1; w <= 90; w++) {
      const row = planRowForWave(w)!;
      const base = planBaseGold(w);
      expect(RUN_PLAN_RULES.gold(w).kill, `wave ${w}`).toBe(Math.round(base.kill * row.strength));
    }
  });

  it('takes the campaign peaks out and keeps the rest of its table', () => {
    expect(planBaseGold(9)).toEqual(waveGold(9, false));
    expect(planBaseGold(21)).toEqual(waveGold(21, false));
    expect(planBaseGold(20).kill).toBeLessThan(waveGold(20, false).kill);
    expect(planBaseGold(30).kill).toBeLessThan(waveGold(30, false).kill);
    for (const w of [10, 20]) {
      expect(planBaseGold(w).kill).toBeGreaterThan(planBaseGold(w - 1).kill);
      expect(planBaseGold(w).kill).toBeLessThan(planBaseGold(w + 1).kill);
    }
    expect(planBaseGold(30).kill).toBeCloseTo(planBaseGold(29).kill * 1.2, -1);
  });

  it('tapers past the campaign from the smooth last wave, no boss bonus of its own', () => {
    const w30 = planBaseGold(30).kill;
    expect(planBaseGold(31).kill).toBeCloseTo(w30 * 0.85, -1);
    expect(planBaseGold(40).kill).toBeLessThan(planBaseGold(39).kill);
    expect(RUN_PLAN_RULES.gold(40).kill).toBe(Math.round(planBaseGold(40).kill * 1.3));
  });

  it('names each wave and its enemy mix in advance', () => {
    expect(RUN_PLAN_RULES.name(30)).toBe(RUN_PLAN[29].name);
    const mix = RUN_PLAN_RULES.enemyMix(7)!;
    expect(mix.reduce((sum, [, share]) => sum + share, 0)).toBeCloseTo(1);
  });
});
