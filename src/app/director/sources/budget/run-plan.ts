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
import { waveGold } from '../../../configs/campaign.config';
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
 * double around W31 and about 2.3 times at W60, where today's steps put 2 and
 * 3. Continuous instead of steps (User, 2026-09-28); how steep is for the bot
 * measurement to settle.
 */
export const LEAK_GROWTH = 0.2125;

export function planLeakScale(wave: number): number {
  const first = budgetSeconds(1);
  const scale = 1 + (LEAK_GROWTH * (budgetSeconds(Math.max(1, wave)) - first)) / first;
  return Math.round(scale * 100) / 100;
}

export const RUN_PLAN_RULES: WaveRules = {
  leakScale: planLeakScale,
  gold: (wave) => waveGold(wave, planRowForWave(wave)?.boss === true),
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
