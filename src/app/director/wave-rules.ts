/**
 * The per-wave numbers the game reads by wave number: what a leak costs, the
 * gold, whether it is a boss wave and, where the source fixes it in advance,
 * what the wave brings.
 *
 * They belong to the wave source, not to the game: swapping the source must
 * swap them too (docs/WAVE_RUN_PLAN.md, section 12). Every source hands its
 * rules over with `WaveSource.rules`; `WaveDirector` makes the rules of the
 * run's source the active ones, and managers, UI and bots read them here.
 *
 * Plain functions of the wave number, no state: the preview, the economy and
 * the leak all ask for waves other than the current one, and both coop clients
 * must get the same answer.
 */

import { RUN_PLAN_RULES } from './sources/budget/run-plan';
import { WAVE_MUTATORS, type WaveMutator, type WaveMutatorId } from '../configs/wave-mutators.config';

export interface WaveGold {
  /** Gold the wave's kills pay in total */
  readonly kill: number;
  /** Gold for finishing the wave, before bonuses */
  readonly complete: number;
}

export interface WaveRules {
  /**
   * Scale on what one leak of `enemyType` costs the HQ at `wave` (the type's
   * leak damage times this). Without a type: the scale of the wave's
   * regular enemies.
   */
  leakScale(wave: number, enemyType?: string): number;
  gold(wave: number): WaveGold;
  /** For the music and the debug window. */
  isBoss(wave: number): boolean;
  /** Enemy types and shares of `wave` when the source fixes them in advance, else null. */
  enemyMix(wave: number): readonly (readonly [string, number])[] | null;
  /** Name of `wave` when the source fixes it in advance, else null. */
  name(wave: number): string | null;
  /** What changes how the enemies of `wave` come (configs/wave-mutators.config.ts), null for nothing. */
  mutator(wave: number): WaveMutatorId | null;
  /** Whether `wave` brings camouflaged enemies (Enemy.camo), as far as the source fixes it; absent for never */
  camo?(wave: number): boolean;
}

let active: WaveRules | null = null;

/**
 * The rules of the run's source. `WaveDirector` sets them when a run starts;
 * before that (specs, the landing screen) the run plan's, the default
 * source's (configs/director.config.ts).
 */
export function waveRules(): WaveRules {
  return active ?? RUN_PLAN_RULES;
}

export function setActiveWaveRules(rules: WaveRules): void {
  active = rules;
}

/** The mutator of `wave` under the run's rules, null for none. */
export function waveMutator(wave: number): WaveMutator | null {
  const id = waveRules().mutator(wave);
  return id ? WAVE_MUTATORS[id] : null;
}

/** Whether `wave` brings air units, from the enemy mix the source fixes in advance. */
export function waveHasAir(wave: number, isAir: (enemyId: string) => boolean): boolean {
  const mix = waveRules().enemyMix(wave);
  return !!mix && mix.some(([id]) => isAir(id));
}
