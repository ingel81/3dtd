/**
 * Wave mutators: a blood moon wave changes how its enemies come, not only
 * how the night looks. One mutator a wave, by a fixed rotation over the blood
 * moon waves (W14 Swift, W21 Swarm, W28 Regeneration, W35 Bounty, W42 Swift,
 * ...), so both coop clients and every replay agree without drawing anything.
 *
 * The wave source says whether its waves have them (`WaveRules.mutator`): the
 * run plan does, the wave table does not. Where each one takes effect:
 * - swift: the budget source's plan (speed of every group, less budget)
 * - swarm: the run plan's counts (planEnemies), the budget stays
 * - regen: the EnemyManager heals every living enemy of the wave, as the
 *   Regen trait of a type (EnemyTypeConfig.regenPerSecond) does
 * - bounty: the run plan's gold for the wave's kills
 */

import { BLOOD_MOON_FIRST_WAVE, BLOOD_MOON_INTERVAL, isBloodMoonWave } from './blood-moon.config';

export type WaveMutatorId = 'swift' | 'swarm' | 'regen' | 'bounty';

export interface WaveMutator {
  readonly id: WaveMutatorId;
  /** Short, for the tag in the wave preview and the banner */
  readonly name: string;
  /** One sentence for the tooltip */
  readonly description: string;
  /** Factor on the wave's budget (its HP against the defense), 1 when absent */
  readonly budget?: number;
  /** Factor on every enemy's speed */
  readonly speed?: number;
  /** Factor on the wave's counts */
  readonly count?: number;
  /** Share of its max HP every living enemy heals a second, as the Regen trait (regenPerSecond) */
  readonly regenPerSecond?: number;
  /** Factor on the gold the wave's kills pay */
  readonly killGold?: number;
}

/**
 * The budget factors keep a mutator wave about as costly as its row: faster
 * enemies spend less time under fire, so they get less HP; healing enemies
 * take longer to kill, so they get less HP too. Swarm spreads the same budget
 * over more bodies; bounty only pays.
 */
export const WAVE_MUTATORS: Readonly<Record<WaveMutatorId, WaveMutator>> = {
  swift: {
    id: 'swift',
    name: 'Swift',
    description: 'Enemies move 25 % faster and come with less HP.',
    speed: 1.25,
    budget: 0.8,
  },
  swarm: {
    id: 'swarm',
    name: 'Swarm',
    description: 'Half as many enemies again, the same HP for the whole wave.',
    count: 1.5,
  },
  regen: {
    id: 'regen',
    name: 'Regeneration',
    description: 'Enemies heal 2 % of their max HP a second unless they burn, and come with less HP.',
    regenPerSecond: 0.02,
    budget: 0.85,
  },
  bounty: {
    id: 'bounty',
    name: 'Bounty',
    description: 'Kills pay double gold.',
    killGold: 2,
  },
};

/** The order the blood moon waves go through */
export const BLOOD_MOON_MUTATORS: readonly WaveMutatorId[] = ['swift', 'swarm', 'regen', 'bounty'];

/** The mutator of a blood moon wave by the rotation, null on any other wave. */
export function bloodMoonMutator(wave: number): WaveMutatorId | null {
  if (!isBloodMoonWave(wave)) return null;
  const index = (wave - BLOOD_MOON_FIRST_WAVE) / BLOOD_MOON_INTERVAL;
  return BLOOD_MOON_MUTATORS[index % BLOOD_MOON_MUTATORS.length];
}
