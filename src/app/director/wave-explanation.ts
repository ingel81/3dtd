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
  /** shared: the wave's factor; limit: held at its own limit; unhurt: the row's strength */
  state: 'shared' | 'limit' | 'unhurt';
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
}

/** Plain text for the debug-mode console, same wording as the debug window. */
export function formatExplanation(explanation: DecisionExplanation): string {
  return [explanation.summary, ...explanation.reasons.map((r) => `  - ${r}`)].join('\n');
}
