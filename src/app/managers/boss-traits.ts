/**
 * What makes a boss more than a body with many HP (EnemyTypeConfig.traits):
 * a rage once it is badly hurt, a regeneration between the towers. Ticked by
 * EnemyManager in every sub-step, game time only, so coop and replays play it
 * alike; its state is plain fields on the enemy, so wave snapshots carry it.
 */

import type { Enemy } from '../entities/enemy.entity';

export interface BossTraits {
  /**
   * Below `belowHp` of its max HP, for the rest of its life: `speed` times
   * as fast, takes `damageTaken` of the damage the towers deal.
   */
  readonly rage?: { readonly belowHp: number; readonly speed: number; readonly damageTaken: number };
  /**
   * After `quietMs` of game time without losing HP it heals `perSecond` of
   * its max HP a second: a gap between the towers lets it recover.
   */
  readonly regen?: { readonly perSecond: number; readonly quietMs: number };
}

/** What a tick did that the world should see. */
export type BossTraitChange = 'enraged' | null;

/**
 * One sub-step of `enemy`'s traits. `halted`: frozen or stunned, the
 * regeneration waits like the walk. Returns 'enraged' in the sub-step the
 * rage begins.
 */
export function tickBossTraits(enemy: Enemy, traits: BossTraits, deltaMs: number, halted: boolean): BossTraitChange {
  const health = enemy.health;
  let change: BossTraitChange = null;

  const rage = traits.rage;
  if (rage && !enemy.enraged && health.hp < health.maxHp * rage.belowHp) {
    enemy.enraged = true;
    enemy.damageTaken = rage.damageTaken;
    enemy.movement.speedMps *= rage.speed;
    change = 'enraged';
  }

  const regen = traits.regen;
  if (regen) {
    if (health.hp < enemy.regenSeenHp) enemy.regenQuietMs = 0;
    else if (!halted) enemy.regenQuietMs += deltaMs;
    if (enemy.regenQuietMs >= regen.quietMs && health.hp < health.maxHp) {
      health.heal((health.maxHp * regen.perSecond * deltaMs) / 1000);
    }
    enemy.regenSeenHp = health.hp;
  }
  return change;
}
