import { releasedResearch } from '../../configs/release';
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
 * Share of the earned gold a typical player has put into research by then:
 * five human runs (2026-09-22 to 2026-10-04, solo and coop, at today's
 * prices) had spent a median third of the plan's gold on research at W5 to
 * W30, from a quarter to half. At a third the whole tree is bought by W40.
 */
export const START_RESEARCH_SHARE = 1 / 3;

/**
 * The order players research in: each research by the median wave it was
 * done in those runs (the gate Biology with its first tower). Research the
 * runs did not have (newer than them) comes after, the cheapest first.
 */
export const START_RESEARCH_ORDER: readonly ResearchId[] = [
  'gatling-tech', // W4
  'aa-retrofit', // W6
  'ice-magic', // W7
  'siege-engineering', // W9
  'biology', // W10
  'toxic-compounds', // W10
  'rocketry', // W11
  'arcane-studies', // W12
  'advanced-weaponry', // W13
  'storm-mastery', // W15
  'tentacle-biology', // W16
  'fire-alchemy', // W17
  'mercenary-contract', // W17
  'master-engineering', // W18
  'nuclear-strike', // W19
  'chaos-rift', // W21
  'frost-bomb', // W21
  'orbital-laser', // W23
  'emp', // W23
  'advanced-engineering', // W24
  'transcendent-tech', // W32 in the runs, open from W38 today
];

/**
 * The start at `wave` under the wave rules of the run's source, null for
 * wave 1 (or less, or not a whole number). The gold is what the waves before
 * pay a player who kills every enemy: kill gold, completion gold and the
 * milestone bonuses, no skill bonuses (the same sum as the dev wave jump,
 * skippedWavesGold). The research: down START_RESEARCH_ORDER, what is open by
 * `wave` (minWave) and whose prerequisites are done, while the research stays
 * within START_RESEARCH_SHARE of the kill and completion gold of one lane; it
 * stops at the first one it cannot pay, as a player saves for the next. What
 * is left is the player's to build with.
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
  for (const config of researchOrder()) {
    if (researchWaitsForWave(config, last + 1) !== null) continue;
    if (!config.prerequisites.every((id) => done.has(id))) continue;
    if (researchCost + config.cost > allowance) break;
    done.add(config.id);
    research.push(config.id);
    researchCost += config.cost;
  }
  return { wave: last + 1, kill, complete, research, researchCost };
}

/** The whole tree in START_RESEARCH_ORDER, the research it leaves out after it by cost */
function researchOrder(): ResearchConfig[] {
  // This build's research: an unreleased tower's or path's is no part of a start (configs/release.ts)
  const tree = releasedResearch();
  const ranked = START_RESEARCH_ORDER.map((id) => RESEARCH_TREE[id]).filter((c): c is ResearchConfig => !!c);
  const rest = tree.filter((c) => !START_RESEARCH_ORDER.includes(c.id)).sort((x, y) => x.cost - y.cost);
  return [...ranked, ...rest];
}

/** A player's credits at such a start with `lanes` lanes, over the start credits of each lane */
export function runStartGold(start: RunStart, lanes: number): number {
  const n = Math.max(1, lanes);
  return Math.max(0, (start.kill - start.researchCost) * n + start.complete);
}
