/**
 * What a planned wave says about itself.
 *
 * These types are shared: the store keeps an explanation
 * (`GameStore.waveExplanation`), the wave debug window shows it, the run log
 * reads the numbers out of it, and every wave source writes one. The sentences
 * themselves belong to whichever source planned the wave, so the sentence
 * builders live with it (`sources/adaptive/decision-explainer.ts`).
 *
 * Nothing in here knows how a wave is decided.
 */

import type { NumberRange } from './templates';

/**
 * How a wave was sized, as the source that planned it recorded the numbers.
 *
 * Written by the adaptive source's `buildWaveConfig`; a source that sizes
 * waves differently fills what applies and leaves the rest at its neutral
 * value (`cap: null`, `endgameHpMult: 1`).
 */
export interface WaveSizing {
  /** The template's designer count range. */
  countRange: NumberRange;
  /** Upper end of the count range after the DPS ramp. */
  dpsScaledMax: number;
  totalDps: number;
  /** Survivability cap at the shipped spawn delay; null means no finite cap. */
  cap: number | null;
  countFactor: number;
  count: number;
  hpMult: number;
  /** Endgame share of `hpMult` (1 through wave 20). */
  endgameHpMult: number;
  spawnDelay: number;
  /** The wave-duration cap compressed the spawn delay. */
  durationCapped: boolean;
}

export interface DecisionExplanation {
  /** One line: wave, template, size, HP. */
  summary: string;
  /** Short sentences, template choice first, then size. */
  reasons: string[];
  /**
   * The numbers the sentences were written from.
   *
   * The run log needs the survivability cap as a number, not as the sentence
   * "Survivability cap holds the count at 5": how often the cap binds is the
   * figure the tuning rounds are judged by, and prose cannot be counted
   * (docs/BALANCING_PLAN.md, Baseline).
   *
   * Optional: an explanation written by hand, as a boss rotation or a test
   * does, has sentences but no numbers behind them.
   */
  sizing?: WaveSizing;
}

/** Plain text for the debug-mode console, same wording as the debug window. */
export function formatExplanation(explanation: DecisionExplanation): string {
  return [explanation.summary, ...explanation.reasons.map((r) => `  - ${r}`)].join('\n');
}
