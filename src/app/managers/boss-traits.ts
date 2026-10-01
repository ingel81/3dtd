/**
 * What makes a boss more than a body with many HP (EnemyTypeConfig.traits):
 * a rage once it is badly hurt. Ticked by EnemyManager in every sub-step,
 * game time only, so coop and replays play it alike; its state is plain
 * fields on the enemy, so wave snapshots carry it. (The Ooze's second phase
 * is its split, splitOnDeath.)
 */

import type { Enemy } from '../entities/enemy.entity';

export interface BossTraits {
  /**
   * Below `belowHp` of its max HP, for the rest of its life: `speed` times
   * as fast, takes `damageTaken` of the damage the towers deal.
   */
  readonly rage?: { readonly belowHp: number; readonly speed: number; readonly damageTaken: number };
}

/** What a tick did that the world should see. */
export type BossTraitChange = 'enraged' | null;

/** One sub-step of `enemy`'s traits. Returns 'enraged' in the sub-step the rage begins. */
export function tickBossTraits(enemy: Enemy, traits: BossTraits): BossTraitChange {
  const health = enemy.health;
  const rage = traits.rage;
  if (rage && !enemy.enraged && health.hp < health.maxHp * rage.belowHp) {
    enemy.enraged = true;
    enemy.damageTaken = rage.damageTaken;
    enemy.movement.speedMps *= rage.speed;
    return 'enraged';
  }
  return null;
}
