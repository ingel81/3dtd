/**
 * The run plan: one row per wave, W1 to W60, then the last ten again.
 *
 * A row fixes what a wave is: which enemies and how many, how far apart they
 * spawn, and how hard it should be (`strength`, 1 normal, 0.7 a breather after
 * a boss, 1.3 a boss wave). How much HP they get is not in the row: the budget
 * step fills that in against the defense (budget.ts). A boss wave is a row like
 * any other (docs/WAVE_RUN_PLAN.md, sections 9 to 11).
 */

import rawPlan from './run-plan.json';
import type { SpawnPattern } from '../../spawn-schedule-builder';
import type { WaveRules } from '../../wave-rules';
import { CAMPAIGN_LENGTH, goldTaper, waveGold } from '../../../configs/campaign.config';
import { budgetSeconds } from './budget';

export interface RunPlanRow {
  readonly wave: number;
  readonly name: string;
  /** Enemy type to count, absolute. */
  readonly enemies: Readonly<Record<string, number>>;
  /** 1 normal, below 1 a breather, above 1 demanding. Scales the budget. */
  readonly strength: number;
  readonly spawnDelay: number;
  readonly spawnDelayVariation?: number;
  readonly pattern?: SpawnPattern;
  /** Boss music, boss gold. */
  readonly boss?: boolean;
  readonly note?: string;
}

export const RUN_PLAN: readonly RunPlanRow[] = rawPlan as unknown as RunPlanRow[];

/** Past the plan the last this-many rows repeat, while the budget curve keeps rising. */
export const RUN_PLAN_REPEAT = 10;

/** The row that plays wave `wave`, null below wave 1. */
export function planRowForWave(wave: number): RunPlanRow | null {
  if (wave < 1) return null;
  const last = RUN_PLAN.length;
  if (wave <= last) return RUN_PLAN[wave - 1];
  const loopStart = last - RUN_PLAN_REPEAT;
  return RUN_PLAN[loopStart + ((wave - last - 1) % RUN_PLAN_REPEAT)];
}

/**
 * How fast a leak's cost grows with the budget curve: at 0.2125 a leak costs
 * 2.04 times at W31 and 2.18 at W60, levelling off near 2.2 as the curve does,
 * where the campaign steps to 2 at W31 and 3 at W61. Continuous instead of
 * steps (User, 2026-09-28); how steep is for the bot measurement to settle.
 */
export const LEAK_GROWTH = 0.2125;

export function planLeakScale(wave: number): number {
  const first = budgetSeconds(1);
  const scale = 1 + (LEAK_GROWTH * (budgetSeconds(Math.max(1, wave)) - first)) / first;
  return Math.round(scale * 100) / 100;
}

/** Campaign waves whose gold was a boss peak; the plan's curve runs smooth through them. */
const CAMPAIGN_GOLD_PEAKS: ReadonlySet<number> = new Set([10, 20, 30]);

/** Growth of the campaign's gold per wave over W21 to W29, the line the last wave keeps to. */
const LATE_GOLD_GROWTH = 1.2;

type WaveGold = { kill: number; complete: number };

const scaleGold = (gold: WaveGold, k: number): WaveGold => ({
  kill: Math.round(gold.kill * k),
  complete: Math.round(gold.complete * k),
});

/** The campaign's gold at `wave` (1 to 30) with its boss peaks taken out */
function smoothCampaignGold(wave: number): WaveGold {
  if (!CAMPAIGN_GOLD_PEAKS.has(wave)) return waveGold(wave, false);
  if (wave === CAMPAIGN_LENGTH) return scaleGold(waveGold(wave - 1, false), LATE_GOLD_GROWTH);
  const before = waveGold(wave - 1, false);
  const after = waveGold(wave + 1, false);
  return {
    kill: Math.round(Math.sqrt(before.kill * after.kill)),
    complete: Math.round(Math.sqrt(before.complete * after.complete)),
  };
}

/**
 * The plan's gold curve for a wave of strength 1: the campaign's table
 * without its boss peaks (W10 and W20 the geometric mean of their neighbours,
 * W30 on the growth line of W21 to W29), past it the campaign's taper from
 * there. One smooth curve; a row's strength scales it (RUN_PLAN_RULES.gold).
 */
export function planBaseGold(wave: number): WaveGold {
  if (wave < 1) return { kill: 0, complete: 0 };
  if (wave <= CAMPAIGN_LENGTH) return smoothCampaignGold(wave);
  return scaleGold(smoothCampaignGold(CAMPAIGN_LENGTH), goldTaper(wave));
}

export const RUN_PLAN_RULES: WaveRules = {
  leakScale: planLeakScale,
  // The same rule as the HP: a boss row of strength 1.3 pays 1.3 times, a breather 0.7
  gold: (wave) => scaleGold(planBaseGold(wave), planRowForWave(wave)?.strength ?? 1),
  isBoss: (wave) => planRowForWave(wave)?.boss === true,
  enemyMix: (wave) => {
    const row = planRowForWave(wave);
    if (!row) return null;
    const entries = Object.entries(row.enemies);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    return total > 0 ? entries.map(([type, count]) => [type, count / total] as const) : null;
  },
  name: (wave) => planRowForWave(wave)?.name ?? null,
};
