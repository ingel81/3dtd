/**
 * What a planned wave says about itself.
 *
 * These types are shared: the store keeps an explanation
 * (`GameStore.waveExplanation`), the wave debug window shows it, the run log
 * writes its sentences, and every wave source writes one. The sentences
 * themselves belong to whichever source planned the wave; the numbers behind
 * them go to the run log through `PlannedWave.log`.
 *
 * Nothing in here knows how a wave is decided.
 */

import type { ArmorType } from '../configs/combat/combat.types';
import type { PressureStep } from './pressure-controller';

export interface DecisionExplanation {
  /** One line: wave, name, size, HP. */
  summary: string;
  /** Short sentences, what the wave is first, then how it was sized. */
  reasons: string[];
  /** The budget source's numbers, for the wave debug window (sources/budget) */
  budget?: BudgetBreakdown;
}

/** One enemy type of a budget wave */
export interface BudgetTypeLine {
  type: string;
  name: string;
  count: number;
  armor: ArmorType;
  hpMult: number;
  /** Its own limit (time under fire), null when the defense cannot hurt it */
  limit: number | null;
  /** shared: the wave's factor; limit: held at its own limit; boss: held up by the boss floor; unhurt: the row's strength */
  state: 'shared' | 'limit' | 'boss' | 'unhurt';
}

/** How the budget source sized a wave: the loop, the budget, what the defense can take, each type */
export interface BudgetBreakdown {
  /** The plan row the wave plays and its strength */
  row: number;
  strength: number;
  /** The pressure loop's R and its stops */
  regulator: number;
  regulatorMin: number;
  regulatorMax: number;
  /** Share of the HP this wave may cost */
  targetPressure: number;
  /** S · strength · R, seconds of defense damage */
  budget: number;
  /** Seconds the defense has while the wave is on the route */
  window: number;
  /** What the cap left of the budget, leaks included */
  delivered: number;
  capped: boolean;
  types: BudgetTypeLine[];
  /** What the loop read after the last wave and what it did */
  loop: LoopReading;
}

/** What the pressure loop measured after the last wave and what it did with R (E113) */
export interface LoopReading {
  /** Share of the HP the last waves cost, smoothed; null while it still counts its first waves */
  measured: number | null;
  /** Share the last wave alone cost; null when that wave said nothing */
  lastWave: number | null;
  /** The share it compared against */
  target: number;
  /** Waves counted, and how many it needs before it moves */
  samples: number;
  minSamples: number;
  step: PressureStep;
  /** The factor the last wave moved R by, 1 without a step */
  change: number;
}

/** 0.042 as "4.2 %" */
function percent(share: number): string {
  return `${Math.round(share * 1000) / 10} %`;
}

/**
 * The pressure loop in plain words for the wave debug window (E113): what it
 * measured (how much HP the last waves cost against the target) and what it
 * does with the budget (up or down by how much, or why it holds).
 */
export function loopSentences(b: BudgetBreakdown): { measured: string; response: string } {
  const loop = b.loop;
  const r = `×${b.regulator}`;
  const stop = b.regulator <= b.regulatorMin ? ' (its lowest)' : b.regulator >= b.regulatorMax ? ' (its highest)' : '';
  if (loop.measured === null) {
    return {
      measured: `Still counting: ${loop.samples} of ${loop.minSamples} waves measured, the first wave is skipped.`,
      response: `The budget stays at ${r} until then.`,
    };
  }
  const last = loop.lastWave === null ? '' : `; the last wave alone ${percent(loop.lastWave)}`;
  const measured = `The last waves cost ${percent(loop.measured)} of the HP on average, the target is ${percent(loop.target)}${last}.`;
  const change = `×${Math.round(loop.change * 100) / 100}`;
  switch (loop.step) {
    case 'opened':
      return { measured, response: `Too easy: the budget goes up ${change} to ${r}${stop}.` };
    case 'closed':
      return { measured, response: `Too hard: the budget goes down ${change} to ${r}${stop}.` };
    case 'blocked':
      return { measured, response: `Too easy, but every enemy type was already at its limit, so more budget would not make the wave harder: it stays at ${r}${stop}.` };
    default:
      return { measured, response: `Close enough to the target: the budget stays at ${r}${stop}.` };
  }
}

/** Plain text for the debug-mode console, same wording as the debug window. */
export function formatExplanation(explanation: DecisionExplanation): string {
  return [explanation.summary, ...explanation.reasons.map((r) => `  - ${r}`)].join('\n');
}
