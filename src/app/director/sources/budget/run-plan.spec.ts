import { describe, expect, it } from 'vitest';
import {
  MAX_BODIES_PER_LANE, RUN_PLAN, RUN_PLAN_REPEAT, RUN_PLAN_RULES, WAVE_LEAK_POTENTIAL, planBaseGold, planEnemies, planLeakScale,
  planMutator, planRowForWave, waveLeakPotential, waveLeakScale,
} from './run-plan';
import { WAVE_MUTATORS } from '../../../configs/wave-mutators.config';
import { budgetSeconds } from './budget';
import { ENEMY_TYPES, lineageBodies, type EnemyTypeId } from '../../../configs/enemy-types.config';
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

  it('repeats rows 31 to 60, all three late bosses', () => {
    expect(RUN_PLAN_REPEAT).toBe(30);
    expect(planRowForWave(61)!.wave).toBe(31);
    const bosses = [];
    for (let w = 61; w <= 90; w++) if (planRowForWave(w)!.boss) bosses.push(planRowForWave(w)!.wave);
    expect(bosses).toEqual([40, 50, 60]);
  });

  it('sends the row as it is inside the plan, except where a mutator changes the counts', () => {
    for (const row of RUN_PLAN) {
      if (planMutator(row.wave)?.count) continue;
      expect(planEnemies(row.wave), `wave ${row.wave}`).toEqual(row.enemies);
    }
  });

  it('sends half as many again on a Swarm wave, the blood moon of W21', () => {
    expect(planMutator(21)).toBe(WAVE_MUTATORS.swarm);
    const row = planRowForWave(21)!;
    for (const [type, count] of Object.entries(planEnemies(21))) {
      expect(count).toBe(Math.round(row.enemies[type] * WAVE_MUTATORS.swarm.count!));
    }
  });

  it('pays double kill gold on a Bounty wave, the completion as usual', () => {
    expect(planMutator(35)).toBe(WAVE_MUTATORS.bounty);
    const strength = planRowForWave(35)!.strength;
    expect(RUN_PLAN_RULES.gold(35).kill).toBe(Math.round(Math.round(planBaseGold(35).kill * strength) * 2));
    expect(RUN_PLAN_RULES.gold(35).complete).toBe(Math.round(planBaseGold(35).complete * strength));
  });

  it('names the blood moon mutators as its rules', () => {
    expect([14, 21, 28, 35, 13].map((w) => RUN_PLAN_RULES.mutator(w))).toEqual(['swift', 'swarm', 'regen', 'bounty', null]);
  });

  it('grows the counts past the plan with the budget curve, a chain stays one', () => {
    const at = 61;
    const row = planRowForWave(at)!;
    const growth = budgetSeconds(at) / budgetSeconds(row.wave);
    expect(growth).toBeGreaterThan(1);
    for (const [type, count] of Object.entries(planEnemies(at))) {
      expect(count).toBe(Math.round(row.enemies[type] * growth));
    }
    const worm = RUN_PLAN.find((r) => r.enemies['worm'])!;
    expect(planEnemies(worm.wave + 150)['worm']).toBe(worm.enemies['worm']);
  });

  it('keeps every lane under the body limit', () => {
    for (let w = 1; w <= 400; w++) {
      const bodies = Object.entries(planEnemies(w))
        .filter(([type]) => !ENEMY_TYPES[type as EnemyTypeId].chain)
        .reduce((sum, [type, count]) => sum + count * lineageBodies(type as EnemyTypeId), 0);
      expect(bodies, `wave ${w}`).toBeLessThanOrEqual(MAX_BODIES_PER_LANE * 1.01 + 5);
    }
  });

  it('makes a leak dearer steadily, without steps', () => {
    expect(planLeakScale(1)).toBe(1);
    for (let w = 2; w <= 120; w++) {
      expect(planLeakScale(w)).toBeGreaterThanOrEqual(planLeakScale(w - 1));
      expect(planLeakScale(w) - planLeakScale(w - 1)).toBeLessThan(0.1);
    }
    expect(planLeakScale(31)).toBeCloseTo(2, 0);
  });

  it('shares the leaks of a crowded wave out of WAVE_LEAK_POTENTIAL and leaves a small wave its scale', () => {
    let crowded = 0;
    for (let w = 1; w <= 90; w++) {
      const potential = waveLeakPotential(w);
      expect(RUN_PLAN_RULES.leakScale(w)).toBe(waveLeakScale(w));
      if (potential > WAVE_LEAK_POTENTIAL) {
        crowded++;
        // Every body getting through costs the potential at the curve's scale, no more
        expect(Math.abs((potential * waveLeakScale(w)) / (WAVE_LEAK_POTENTIAL * planLeakScale(w)) - 1)).toBeLessThan(0.02);
      } else {
        expect(waveLeakScale(w)).toBeCloseTo(planLeakScale(w), 2);
      }
    }
    expect(crowded).toBeGreaterThan(0);
  });

  it('marks the plan boss waves, not the campaign cadence', () => {
    expect(RUN_PLAN_RULES.isBoss(35)).toBe(false);
    expect(RUN_PLAN_RULES.isBoss(40)).toBe(true);
  });

  it('pays gold on a smooth curve times the row strength', () => {
    for (let w = 1; w <= 90; w++) {
      const row = planRowForWave(w)!;
      const base = planBaseGold(w);
      const bounty = planMutator(w)?.killGold ?? 1;
      expect(RUN_PLAN_RULES.gold(w).kill, `wave ${w}`).toBe(Math.round(Math.round(base.kill * row.strength) * bounty));
    }
  });

  it('takes the campaign peaks out and keeps the rest of its table', () => {
    expect(planBaseGold(9)).toEqual(waveGold(9, false));
    expect(planBaseGold(21)).toEqual(waveGold(21, false));
    expect(planBaseGold(20).kill).toBeLessThan(waveGold(20, false).kill);
    // W30 has been on the campaign's line since 2026-10-02, no peak to take out
    expect(planBaseGold(30).kill).toBeCloseTo(waveGold(30, false).kill, -2);
    for (const w of [10, 20]) {
      expect(planBaseGold(w).kill).toBeGreaterThan(planBaseGold(w - 1).kill);
      expect(planBaseGold(w).kill).toBeLessThan(planBaseGold(w + 1).kill);
    }
    expect(planBaseGold(30).kill).toBeCloseTo(planBaseGold(29).kill * 1.1, -1);
  });

  it('tapers past the campaign from the smooth last wave, no boss bonus of its own', () => {
    const w30 = planBaseGold(30).kill;
    expect(planBaseGold(31).kill).toBeCloseTo(w30 * 0.9, -1);
    expect(planBaseGold(40).kill).toBeLessThan(planBaseGold(39).kill);
    // The floor: 30 % of the last authored wave from about W42 on
    expect(planBaseGold(60).kill).toBeCloseTo(w30 * 0.3, -1);
    expect(RUN_PLAN_RULES.gold(40).kill).toBe(Math.round(planBaseGold(40).kill * 1.3));
  });

  it('names each wave and its enemy mix in advance', () => {
    expect(RUN_PLAN_RULES.name(30)).toBe(RUN_PLAN[29].name);
    const mix = RUN_PLAN_RULES.enemyMix(7)!;
    expect(mix.reduce((sum, [, share]) => sum + share, 0)).toBeCloseTo(1);
  });
});
