/** Types the game events share (game-event-bus.ts re-exports them). */
/**
 * Where a gold change came from. Every booking names one, so the run log can
 * split income and spending by source without guessing from the sign
 * (docs/RUN_LOG.md).
 */
export type CreditsSource =
  | 'kill'            // an enemy died and paid its share of the wave budget
  | 'wave-bonus'      // the wave's completion gold, bonuses included
  | 'build'           // a tower was placed
  | 'upgrade'         // a tower was upgraded
  | 'sell'            // a tower was sold
  | 'research'        // a research was started
  | 'research-refund' // a running research was cancelled
  | 'hero'            // the hero was hired or re-armed
  | 'cheat'           // the dev menu handed gold out or took it away
  | 'wave-jump'       // the gold of the waves a dev jump skipped
  | 'gift'            // coop: gold one player sent another
  | 'reset';          // back to the starting gold of a new run

/** What made a tower resolve its line of sight, see `tower:los-resolved`. */
export type LosResolveReason = 'place' | 'upgrade' | 'retrofit';

/** Who killed an enemy. `null` for a death nobody is credited with. */
export type KilledBy =
  | { kind: 'tower'; towerId: string }
  /** `heroId`: which hero (HeroManager.heroId); absent reads as the single player's */
  | { kind: 'hero'; heroId?: string }
  /** `ownerId`: whose ability; absent reads as the first player */
  | { kind: 'ability'; ownerId?: string }
  | { kind: 'debug' };

/** The parts of a wave's completion gold. */
export interface WaveGoldBreakdown {
  base: number;
  perfect: number;
  combo: number;
  closeCall: number;
  comeback: number;
  milestone: number;
}
