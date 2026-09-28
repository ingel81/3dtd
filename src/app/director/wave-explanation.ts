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

export interface DecisionExplanation {
  /** One line: wave, name, size, HP. */
  summary: string;
  /** Short sentences, what the wave is first, then how it was sized. */
  reasons: string[];
}

/** Plain text for the debug-mode console, same wording as the debug window. */
export function formatExplanation(explanation: DecisionExplanation): string {
  return [explanation.summary, ...explanation.reasons.map((r) => `  - ${r}`)].join('\n');
}
