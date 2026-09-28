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

import { CAMPAIGN_WAVE_RULES } from '../configs/campaign-wave-rules';

export interface WaveGold {
  /** Gold the wave's kills pay in total */
  readonly kill: number;
  /** Gold for finishing the wave, before bonuses */
  readonly complete: number;
}

export interface WaveRules {
  /** Scale on what one leak costs the HQ at `wave` (the enemy type's leak damage times this). */
  leakScale(wave: number): number;
  gold(wave: number): WaveGold;
  /** For the music and the debug window. */
  isBoss(wave: number): boolean;
  /** Enemy types and shares of `wave` when the source fixes them in advance, else null. */
  enemyMix(wave: number): readonly (readonly [string, number])[] | null;
  /** Name of `wave` when the source fixes it in advance, else null. */
  name(wave: number): string | null;
}

let active: WaveRules | null = null;

/**
 * The rules of the run's source. `WaveDirector` sets them when a run starts;
 * before that (specs, the landing screen) the campaign's, which both of
 * today's sources play.
 */
export function waveRules(): WaveRules {
  return active ?? CAMPAIGN_WAVE_RULES;
}

export function setActiveWaveRules(rules: WaveRules): void {
  active = rules;
}

/** Whether `wave` brings air units, from the enemy mix the source fixes in advance. */
export function waveHasAir(wave: number, isAir: (enemyId: string) => boolean): boolean {
  const mix = waveRules().enemyMix(wave);
  return !!mix && mix.some(([id]) => isAir(id));
}
