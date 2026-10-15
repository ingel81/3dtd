import { describe, expect, it } from 'vitest';
import { MAX_START_WAVE, START_RESEARCH_ORDER, START_RESEARCH_SHARE, runStartAt, runStartGold } from './run-start';
import { RUN_PLAN_RULES } from '../../director/sources/budget/run-plan';
import { GAME_BALANCE } from '../../configs/game-balance.config';
import { RESEARCH_TREE } from '../../configs/research/research-tree.config';
import { skippedWavesGold } from '../../services/economy.service';
import { runRulesKey, runRulesOf } from './run-rules';

describe('runStartAt', () => {
  it('starts no run at wave 1', () => {
    expect(runStartAt(1, RUN_PLAN_RULES)).toBeNull();
    expect(runStartAt(0, RUN_PLAN_RULES)).toBeNull();
    expect(runStartAt(2.5, RUN_PLAN_RULES)).toBeNull();
  });

  it('pays the gold of the waves before, as the dev jump does', () => {
    const start = runStartAt(12, RUN_PLAN_RULES)!;
    expect(start.wave).toBe(12);
    expect(start.kill + start.complete).toBe(skippedWavesGold(1, 11));
    expect(start.complete).toBeGreaterThanOrEqual(GAME_BALANCE.economy.milestoneBonuses[10]);
  });

  it('buys open research in the order players pick it within its share of the gold, prerequisites first', () => {
    const start = runStartAt(12, RUN_PLAN_RULES)!;
    expect(start.research.length).toBeGreaterThan(3);
    expect(start.researchCost).toBe(start.research.reduce((sum, id) => sum + RESEARCH_TREE[id].cost, 0));
    expect(start.researchCost).toBeLessThanOrEqual(START_RESEARCH_SHARE * (start.kill + start.complete));
    const done = new Set<string>();
    for (const id of start.research) {
      const config = RESEARCH_TREE[id];
      expect(config.prerequisites.every((p) => done.has(p)), id).toBe(true);
      expect(config.minWave ?? 0).toBeLessThanOrEqual(12);
      done.add(id);
    }
    // Research that opens later is not in it, however much gold there is
    expect(runStartAt(30, RUN_PLAN_RULES)!.research).not.toContain('transcendent-tech');
    expect(runStartAt(2, RUN_PLAN_RULES)!.research.length).toBeLessThan(start.research.length);
  });

  it('has what the human runs had by then: a first tower at W5, the early unlocks at W10, all but the last tier at W30', () => {
    expect(runStartAt(5, RUN_PLAN_RULES)!.research).toEqual(['gatling-tech']);
    expect(runStartAt(10, RUN_PLAN_RULES)!.research).toEqual(['gatling-tech', 'aa-retrofit', 'ice-magic', 'siege-engineering', 'biology']);
    // The runs had 13 to 15 done before W20, 18 to 21 before W30
    expect(runStartAt(20, RUN_PLAN_RULES)!.research).toHaveLength(14);
    const late = runStartAt(30, RUN_PLAN_RULES)!.research;
    expect(late).toHaveLength(Object.keys(RESEARCH_TREE).length - 1);
    expect(late).not.toContain('transcendent-tech');
  });

  it('orders every research of the tree, and only those', () => {
    for (const id of START_RESEARCH_ORDER) expect(RESEARCH_TREE[id], id).toBeDefined();
    // A research the order leaves out still comes, after it
    expect(runStartAt(30, RUN_PLAN_RULES)!.research).toContain('scouting');
  });

  it('gives each lane its kill gold and research bill, the completion gold once', () => {
    const start = runStartAt(20, RUN_PLAN_RULES)!;
    const one = runStartGold(start, 1);
    expect(one).toBe(start.kill + start.complete - start.researchCost);
    expect(runStartGold(start, 3)).toBe(3 * (start.kill - start.researchCost) + start.complete);
  });

  it('holds the wave at MAX_START_WAVE and travels in the run rules and their key', () => {
    expect(runStartAt(MAX_START_WAVE + 50, RUN_PLAN_RULES)!.wave).toBe(MAX_START_WAVE);
    const start = runStartAt(8, RUN_PLAN_RULES)!;
    const rules = runRulesOf({ start });
    expect(rules.start).toEqual(start);
    expect(runRulesKey(rules)).not.toBe(runRulesKey(runRulesOf({})));
    expect(runRulesOf({ start: { ...start, wave: 1 } }).start).toBeNull();
    expect(runRulesOf({ start: { ...start, research: ['no-such-research'] } }).start).toBeNull();
  });
});
