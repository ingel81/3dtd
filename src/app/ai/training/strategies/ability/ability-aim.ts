/**
 * Aiming helpers of the ability strategies. They read the enemies from the
 * game state rather than the snapshot: the snapshot carries no positions,
 * and it goes to the training backend as is.
 */

import type { GameStateManager } from '../../../../managers/game-state.manager';
import type { Enemy } from '../../../../entities/enemy.entity';
import type { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { geoDistanceFast } from '../../../../utils/geo-utils';

/**
 * The aim of one bot decision. StrategyBot.decideAction calls canExecute and
 * then execute with the same snapshot, and the aim is the costly part of
 * both: canExecute keeps it, execute takes it. Another snapshot (a later
 * decision) aims anew, and execute uses the kept aim up either way.
 */
export class DecisionAim<T> {
  private state: GameStateSnapshot | null = null;
  private aim: T | null = null;

  /** canExecute: aim for `state` and keep the result. */
  find(state: GameStateSnapshot, aim: () => T | null): T | null {
    this.state = state;
    this.aim = aim();
    return this.aim;
  }

  /** execute: the aim kept for `state`, else a fresh one. */
  take(state: GameStateSnapshot, aim: () => T | null): T | null {
    const found = this.state === state ? this.aim : aim();
    this.state = null;
    this.aim = null;
    return found;
  }
}

/**
 * Candidate centres per decision, spread evenly over the enemies. Counting
 * all pairs of a mega swarm (1500 skeletons) would cost two million distance
 * checks per decision; this keeps it near 72k.
 */
export const MAX_AIM_CANDIDATES = 48;

/** Alive enemies with a path progress of at least `progress`, in manager order. */
export function enemiesFromProgress(gameState: GameStateManager, progress: number): Enemy[] {
  const found: Enemy[] = [];
  for (const enemy of gameState.enemyManager.getAlive()) {
    if (enemy.movement.getPathProgress() >= progress) found.push(enemy);
  }
  return found;
}

/**
 * The candidate from `enemies` that has the most of them within `radiusM`
 * (2D); ties keep the first. At most MAX_AIM_CANDIDATES candidates, spread
 * evenly over the list. `enemies` must not be empty.
 */
export function densestCenter(enemies: readonly Enemy[], radiusM: number): { center: Enemy; covered: number } {
  const stride = Math.ceil(enemies.length / MAX_AIM_CANDIDATES);
  let center = enemies[0];
  let covered = -1;
  for (let i = 0; i < enemies.length; i += stride) {
    const candidate = enemies[i];
    let count = 0;
    for (const other of enemies) {
      if (geoDistanceFast(candidate.position, other.position) <= radiusM) count++;
    }
    if (count > covered) {
      center = candidate;
      covered = count;
    }
  }
  return { center, covered };
}
