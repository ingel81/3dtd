/**
 * The contract every wave source implements: what the next wave is, what the
 * waves after it will roughly be, and what a finished wave taught it.
 *
 * Only types live here. The implementations sit under `sources/`, one folder
 * each, and `WaveDirector` is the single Angular service that talks to
 * whichever one a run plays. Measuring stays outside: the state snapshot, the
 * defense analysis and the run log are the same for every source, which is
 * what makes two of them comparable at all (docs/WAVE_SOURCE_PLAN.md).
 *
 * A source is a plain class, no Angular. Everything it needs comes in through
 * the request, so it is testable without an injector and a decorator can wrap
 * it (`withDifficulty`, `withSafetyNet`).
 */

import type { ArmorType } from '../configs/combat/combat.types';
import type { GameStateSnapshot } from './models/game-state-snapshot';
import type { WaveConfig } from './models/wave-config';
import type { WaveResult } from './models/wave-result';
import type { DecisionExplanation } from './wave-explanation';

/**
 * The sources a run can play.
 *
 * Grows with every implementation under `sources/`; the registry maps each id
 * to its factory, so an id without an implementation cannot be configured.
 */
export type WaveSourceId = 'adaptive' | 'table';

/**
 * When a source commits the next wave.
 *
 * `wave-end` writes it down as soon as the previous wave is over, so the
 * preview reads exactly what will come. `wave-start` decides on the button,
 * which means the preview can only name the menu, not the dish; the adaptive
 * source works that way because its size depends on the defense as it stands
 * when the wave starts.
 */
export type WavePlanTiming = 'wave-end' | 'wave-start';

export interface WavePlanRequest {
  /**
   * The wave to plan, absolute. Passed rather than derived: with `wave-end`
   * timing `state.waveNumber` is the wave that just finished, so the old
   * `state.waveNumber + 1` convention is no longer unambiguous.
   */
  readonly wave: number;
  readonly state: GameStateSnapshot;
  /** The run's `director` stream (GameRng), so the same seed plans the same waves. */
  readonly random: () => number;
}

export interface WavePeekRequest {
  readonly fromWave: number;
  readonly count: number;
  /**
   * Only what a preview needs, not a whole snapshot: the wave panel calls
   * `peek` inside an Angular `computed` that depends on tower count, upgrades
   * and research, and a snapshot as input would rebuild the whole defense
   * analysis on every tower placed.
   *
   * Deliberately only the DPS. A source that wants to know whether the defense
   * can answer air or ethereal gets those flags added here when it exists;
   * deriving them in the panel would be a second copy of the rule the defense
   * analyzer already owns (docs/WAVE_SOURCE_PLAN.md, R10).
   */
  readonly defense: {
    readonly totalDps: number;
  };
}

/** A wave, ready to ship. */
export interface PlannedWave {
  readonly wave: number;
  /** Boss variant already applied; the source owns that substitution. */
  readonly config: WaveConfig;
  readonly explanation: DecisionExplanation | null;
  /** What the run log writes for this wave. */
  readonly log: WaveLogFields;
}

/**
 * Numbers a planned wave hands to the run log.
 *
 * The three named fields are the ones the log format already knows, so its
 * readers and the Python report keep working. A source that has no such
 * number leaves it out, exactly as a wave from the debug panel does. Anything
 * else goes into `diagnostics`, which the log stores as it comes.
 */
export interface WaveLogFields {
  readonly survivableCount?: number | null;
  readonly pressureMultiplier?: number;
  readonly targetPressure?: number;
  readonly diagnostics?: Readonly<Record<string, number | string | boolean | null>>;
}

/**
 * Facts about a coming wave. Labels, icons and tooltips stay in the UI: a
 * source must not own the game's copy.
 */
export interface WavePeekFacts {
  readonly wave: number;
  readonly name: string;
  /** Is this the wave, or only what is on the menu? */
  readonly known: boolean;
  readonly boss: boolean;
  readonly air: boolean;
  /** Armor types in the wave, in the order the wave sends them. */
  readonly armors: readonly ArmorType[];
  /** HP each armor type brings, so the UI can answer "weak to". */
  readonly hpByArmor: readonly (readonly [ArmorType, number])[];
  /**
   * Enemy count: what the wave can hold, or null when the source does not
   * know yet. `hi` is what it would send against the defense in the request,
   * `max` what the wave could hold at best; the UI words the difference.
   */
  readonly count: { readonly lo: number; readonly hi: number; readonly max: number } | null;
  /** Enemy types with their share of the wave. */
  readonly enemies: readonly (readonly [string, number])[];
  /** What the source wants to add, e.g. "template is picked at wave start". */
  readonly note: string;
  readonly description: string;
}

export interface WaveSource {
  readonly id: WaveSourceId;
  /** For the debug window and the run log. */
  readonly name: string;
  readonly plansAt: WavePlanTiming;

  /** The wave `request.wave`, ready to ship. */
  plan(request: WavePlanRequest): PlannedWave;

  /**
   * The `count` waves from `fromWave` on, without committing anything.
   *
   * Side-effect free and stable: two calls between waves give the same answer,
   * and calling it never changes what `plan` will do. It may read the source's
   * own state; it must not touch the game's. The wave panel calls it from a
   * `computed` and relies on both.
   */
  peek(request: WavePeekRequest): WavePeekFacts[];

  /** A wave finished. An adaptive source learns from it, a table ignores it. */
  onWaveResult(result: WaveResult): void;

  /** Drop everything that belongs to one run. */
  reset(): void;
}
