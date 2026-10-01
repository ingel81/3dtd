/**
 * The run plan: one row per wave, W1 to W60, then rows 31 to 60 again, with
 * more enemies as the budget curve rises (planEnemies).
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
import { CAMPAIGN, goldTaper, waveGold } from '../../../configs/campaign.config';
import { baseBudgetSeconds, budgetSeconds } from './budget';
import { ENEMY_TYPES, leakDamageOf, lineageBodies, lineageLeakDamage, type EnemyTypeId } from '../../../configs/enemy-types.config';
import { WAVE_MUTATORS, bloodMoonMutator, type WaveMutator } from '../../../configs/wave-mutators.config';

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

/**
 * Past the plan the last this-many rows repeat, while the budget curve keeps
 * rising: rows 31 to 60, all three late bosses with their breathers.
 */
export const RUN_PLAN_REPEAT = 30;

/**
 * Most enemies one lane's wave brings, split children counted, a limit for
 * the frame rate. Above it the counts shrink and the budget puts the rest
 * into HP. At least what the plan's largest row has (skeletons of W48).
 */
export const MAX_BODIES_PER_LANE = 2500;

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
  const first = baseBudgetSeconds(1);
  const scale = 1 + (LEAK_GROWTH * (baseBudgetSeconds(Math.max(1, wave)) - first)) / first;
  return Math.round(scale * 100) / 100;
}

/**
 * Most HQ HP the bodies of one wave cost if every one of them gets through,
 * before the wave's scale (planLeakScale). A wave that brings more shares it
 * out: each of its leaks costs that much less. Every wave, every type.
 *
 * Without it a swarm carried 2000 to 3500 HP of leaks against an HQ of 350
 * (the human run of 2026-10-01, W19 to W54), so a defense a few per cent too
 * weak for it lost a third of its HQ in one wave, and the loop could only
 * keep such waves well under the edge: 37 waves without a loss, then the end.
 * A boss (isBoss) is neither counted nor shared: it costs what it costs.
 */
export const WAVE_LEAK_POTENTIAL = 40;

/** What all bodies of `wave` but its bosses cost the HQ at the wave's scale 1: each type's leak damage (split tree, a worm once) times its count. */
export function waveLeakPotential(wave: number): number {
  return Object.entries(planEnemies(wave)).reduce((sum, [type, count]) => {
    const id = type as EnemyTypeId;
    if (ENEMY_TYPES[id]?.isBoss) return sum;
    return sum + count * (ENEMY_TYPES[id]?.chain ? leakDamageOf(id) : lineageLeakDamage(id));
  }, 0);
}

/**
 * What one leak of `wave` costs per point of a type's leak damage: the curve's
 * scale, for a crowded wave its share of WAVE_LEAK_POTENTIAL. A boss pays the
 * curve's scale whole.
 */
export function waveLeakScale(wave: number, enemyType?: string): number {
  if (enemyType !== undefined && ENEMY_TYPES[enemyType as EnemyTypeId]?.isBoss) return planLeakScale(wave);
  const potential = waveLeakPotential(wave);
  const share = potential > WAVE_LEAK_POTENTIAL ? WAVE_LEAK_POTENTIAL / potential : 1;
  return Math.round(planLeakScale(wave) * share * 1000) / 1000;
}

/** Campaign waves whose gold was a boss peak; the plan's curve runs smooth through them. */
const CAMPAIGN_GOLD_PEAKS: ReadonlySet<number> = new Set([10, 20, 30]);

/** Growth of the campaign's gold per wave over W21 to W29, the line the last wave keeps to. */
const LATE_GOLD_GROWTH = 1.1;

interface WaveGold { kill: number; complete: number }

const scaleGold = (gold: WaveGold, k: number): WaveGold => ({
  kill: Math.round(gold.kill * k),
  complete: Math.round(gold.complete * k),
});

/** The campaign's gold at `wave` (1 to 30) with its boss peaks taken out */
function smoothCampaignGold(wave: number): WaveGold {
  if (!CAMPAIGN_GOLD_PEAKS.has(wave)) return waveGold(wave, false);
  if (wave === CAMPAIGN.length) return scaleGold(waveGold(wave - 1, false), LATE_GOLD_GROWTH);
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
  if (wave <= CAMPAIGN.length) return smoothCampaignGold(wave);
  return scaleGold(smoothCampaignGold(CAMPAIGN.length), goldTaper(wave));
}

/**
 * The enemies of wave `wave`: its row's counts times how far the budget curve
 * has risen since the row's own wave, S(N) / S(row), which is 1 inside the
 * plan, and times the count of the wave's mutator (Swarm). A chain (Skarnax)
 * stays one: its length is the route's. The same rule for every row; over
 * MAX_BODIES_PER_LANE the counts shrink back.
 */
export function planEnemies(wave: number): Readonly<Record<string, number>> {
  const row = planRowForWave(wave);
  if (!row) return {};
  const mutator = planMutator(wave);
  const growth = (budgetSeconds(wave) / budgetSeconds(row.wave)) * (mutator?.count ?? 1);
  const grows = (type: string) => !ENEMY_TYPES[type as EnemyTypeId]?.chain;
  const bodies = Object.entries(row.enemies)
    .filter(([type]) => grows(type))
    .reduce((sum, [type, count]) => sum + count * growth * lineageBodies(type as EnemyTypeId), 0);
  const scale = growth * Math.min(1, bodies > 0 ? MAX_BODIES_PER_LANE / bodies : 1);
  const out: Record<string, number> = {};
  for (const [type, count] of Object.entries(row.enemies)) {
    out[type] = grows(type) ? Math.max(1, Math.round(count * scale)) : count;
  }
  return out;
}

/** The mutator of `wave` in the run plan: the blood moon's (configs/wave-mutators.config.ts). */
export function planMutator(wave: number): WaveMutator | null {
  const id = bloodMoonMutator(wave);
  return id ? WAVE_MUTATORS[id] : null;
}

/** The plan's gold for `wave`: the smooth curve times the row's strength, the kills times the mutator's bounty. */
function planGold(wave: number): WaveGold {
  // The same rule as the HP: a boss row of strength 1.3 pays 1.3 times, a breather 0.7
  const gold = scaleGold(planBaseGold(wave), planRowForWave(wave)?.strength ?? 1);
  const bounty = planMutator(wave)?.killGold ?? 1;
  return bounty === 1 ? gold : { kill: Math.round(gold.kill * bounty), complete: gold.complete };
}

export const RUN_PLAN_RULES: WaveRules = {
  leakScale: waveLeakScale,
  gold: planGold,
  isBoss: (wave) => planRowForWave(wave)?.boss === true,
  enemyMix: (wave) => {
    const row = planRowForWave(wave);
    if (!row) return null;
    const entries = Object.entries(row.enemies);
    const total = entries.reduce((sum, [, count]) => sum + count, 0);
    return total > 0 ? entries.map(([type, count]) => [type, count / total] as const) : null;
  },
  name: (wave) => planRowForWave(wave)?.name ?? null,
  mutator: bloodMoonMutator,
};
