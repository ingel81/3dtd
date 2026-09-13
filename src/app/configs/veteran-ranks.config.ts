/**
 * Tower veterans: ranks a tower earns with its kills. Cosmetic only, nothing
 * in combat, economy or the wave director reads them.
 *
 * A kill is a killing blow: it counts for the tower whose hit took the
 * enemy's last HP (DamageApplicationService, `CombatComponent.kills`). Splash,
 * chain jumps, beam ticks and damage over time count for the tower they came
 * from; an ability's strike and a sold tower's late projectile count for none.
 *
 * The rank is derived from the kill count wherever it is shown and has no
 * state of its own: whatever restores or replays the kills restores the rank.
 * An upgrade keeps it, selling takes it away with the tower.
 *
 * Thresholds, set against the training logs of 2026-08-28 (strategist bot,
 * about 500 runs per wave, median kills of the whole defense): 6 in W1, 117
 * by W10 with up to 10 towers, 171 by W18, then the W19 swarm alone about
 * 3,000, 4,257 by W30 with 20 towers. Blooded comes in the first waves,
 * Veteran for the early towers around W10, Elite hardly before the W19 swarm,
 * Champion and Legend only for the towers that carry the swarms.
 */

export type VeteranMetal = 'silver' | 'gold';

export interface VeteranRank {
  /** 1 to VETERAN_RANKS.length; 0 (no rank) has no entry */
  level: number;
  name: string;
  /** Kills from which the tower holds this rank */
  minKills: number;
  /** Chevrons of the insignia, 0 to 3 */
  chevrons: number;
  /** A star instead of chevrons */
  star: boolean;
  metal: VeteranMetal;
}

/** Ascending by minKills and level. */
export const VETERAN_RANKS: readonly VeteranRank[] = [
  { level: 1, name: 'Blooded', minKills: 10, chevrons: 1, star: false, metal: 'silver' },
  { level: 2, name: 'Veteran', minKills: 50, chevrons: 2, star: false, metal: 'silver' },
  { level: 3, name: 'Elite', minKills: 150, chevrons: 3, star: false, metal: 'silver' },
  { level: 4, name: 'Champion', minKills: 400, chevrons: 3, star: false, metal: 'gold' },
  { level: 5, name: 'Legend', minKills: 1000, chevrons: 0, star: true, metal: 'gold' },
];

/** Name of a tower below the first rank */
export const RECRUIT_NAME = 'Recruit';

/** Rank level for a kill count, 0 below the first rank. */
export function veteranLevel(kills: number): number {
  let level = 0;
  for (const rank of VETERAN_RANKS) {
    if (kills < rank.minKills) break;
    level = rank.level;
  }
  return level;
}

/** The rank of a level, null for 0 and for levels past the top. */
export function veteranRank(level: number): VeteranRank | null {
  return level >= 1 ? (VETERAN_RANKS[level - 1] ?? null) : null;
}
