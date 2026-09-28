import { describe, expect, it } from 'vitest';
import { RUN_PLAN, RUN_PLAN_REPEAT, RUN_PLAN_RULES, planLeakScale, planRowForWave } from './run-plan';
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

  it('pays boss gold on the plan boss waves, not on the campaign cadence', () => {
    expect(RUN_PLAN_RULES.gold(35)).toEqual(waveGold(35, false));
    expect(RUN_PLAN_RULES.gold(40)).toEqual(waveGold(40, true));
    expect(RUN_PLAN_RULES.isBoss(35)).toBe(false);
    expect(RUN_PLAN_RULES.isBoss(40)).toBe(true);
  });

  it('names each wave and its enemy mix in advance', () => {
    expect(RUN_PLAN_RULES.name(30)).toBe(RUN_PLAN[29].name);
    const mix = RUN_PLAN_RULES.enemyMix(7)!;
    expect(mix.reduce((sum, [, share]) => sum + share, 0)).toBeCloseTo(1);
  });
});
