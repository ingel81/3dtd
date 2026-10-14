import { GAME_BALANCE } from '../../configs/game-balance.config';
import { RESEARCH_TREE } from '../../configs/research/research-tree.config';
import { researchWaitsForWave, type ResearchConfig, type ResearchId } from '../../configs/research/research.types';
import type { WaveRules } from '../../director/wave-rules';

/**
 * Where a run starts when it does not start at wave 1 (the editor's "Test
 * map" from wave N, docs/LEVEL_EDITOR.md): the waves before are counted as
 * played, the player gets the gold a typical player has earned by then and
 * the research that gold bought, and builds the defense on their own. Part of the
 * run rules (RunRules.start) and so of the world key: a replay and the
 * simulation start the same way.
 */
export interface RunStart {
  /** The first wave to play (2 or more) */
  wave: number;
  /** Kill gold of the waves before, for one lane (each lane pays its own) */
  kill: number;
  /** Completion gold and milestone bonuses of the waves before (once per player) */
  complete: number;
  /** The research done at the start, in the order it was picked */
  research: readonly ResearchId[];
  /** What that research cost for one lane (researchCost scales with the lanes) */
  researchCost: number;
}

/** The latest wave a run may start at */
export const MAX_START_WAVE = 200;

/**
 * Share of the earned gold a typical player has put into research by then.
 * The whole tree costs about a quarter of the plan's gold up to W40, where it
 * can first be complete (docs/WAVE_RUN_PLAN.md, 16.4).
 */
export const START_RESEARCH_SHARE = 0.25;

/**
 * The start at `wave` under the wave rules of the run's source, null for
 * wave 1 (or less, or not a whole number). The gold is what the waves before
 * pay a player who kills every enemy: kill gold, completion gold and the
 * milestone bonuses, no skill bonuses (the same sum as the dev wave jump,
 * skippedWavesGold). The research: the cheapest research that is open by
 * `wave` (minWave) and whose prerequisites are done, again and again, while
 * the research stays within START_RESEARCH_SHARE of the kill and completion
 * gold of one lane. What is left is the player's to build with.
 */
export function runStartAt(wave: number, rules: Pick<WaveRules, 'gold'>): RunStart | null {
  if (!Number.isInteger(wave) || wave <= 1) return null;
  const last = Math.min(wave, MAX_START_WAVE) - 1;
  const milestones = GAME_BALANCE.economy.milestoneBonuses;
  let kill = 0;
  let complete = 0;
  for (let w = 1; w <= last; w++) {
    const gold = rules.gold(w);
    kill += gold.kill;
    complete += gold.complete + (milestones[w] ?? 0);
  }

  const allowance = START_RESEARCH_SHARE * (kill + complete);
  const done = new Set<ResearchId>();
  const research: ResearchId[] = [];
  let researchCost = 0;
  const tree = Object.values(RESEARCH_TREE) as ResearchConfig[];
  for (;;) {
    let pick: ResearchConfig | null = null;
    for (const config of tree) {
      if (done.has(config.id) || researchWaitsForWave(config, last + 1) !== null) continue;
      if (!config.prerequisites.every((id) => done.has(id))) continue;
      if (!pick || config.cost < pick.cost) pick = config;
    }
    if (!pick || researchCost + pick.cost > allowance) break;
    done.add(pick.id);
    research.push(pick.id);
    researchCost += pick.cost;
  }
  return { wave: last + 1, kill, complete, research, researchCost };
}

/** A player's credits at such a start with `lanes` lanes, over the start credits of each lane */
export function runStartGold(start: RunStart, lanes: number): number {
  const n = Math.max(1, lanes);
  return Math.max(0, (start.kill - start.researchCost) * n + start.complete);
}
