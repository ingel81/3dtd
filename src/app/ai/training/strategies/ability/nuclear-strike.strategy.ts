/**
 * Nuclear Strike Strategy
 *
 * Priority: 97, above every other strategy: a charge is worth most in the
 * few decisions where a wave is about to break through, and a placement or
 * upgrade can wait for the next one.
 *
 * Fires when: a wave runs, the strike is ready (researched, charged) and at
 * least MIN_FINAL_STRETCH_ENEMIES enemies stand in the last fifth of their
 * route (PLAYER_AGENCY_CONCEPT.md, section 7).
 * Aims at: the final-stretch enemy with the most other final-stretch enemies
 * within the strike radius. The AbilityManager snaps the aim to the route,
 * as it does for a click.
 *
 * Reads the enemies from the game state rather than the snapshot: the
 * snapshot carries no positions, and it goes to the training backend as is.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { ABILITIES } from '../../../../configs/abilities.config';
import { geoDistanceFast } from '../../../../utils/geo-utils';
import type { Enemy } from '../../../../entities/enemy.entity';

const NUKE = ABILITIES['nuclear-strike'];

export class NuclearStrikeStrategy extends BaseStrategy {
  /** Path progress from which an enemy stands in the last fifth of its route */
  static readonly FINAL_STRETCH = 0.8;
  /** "Many": fewer than this in the last fifth and the charge is kept */
  static readonly MIN_FINAL_STRETCH_ENEMIES = 10;
  /**
   * Candidate centres per decision, spread evenly over the final-stretch
   * enemies. Counting all pairs of a mega swarm (1500 skeletons) would cost
   * two million distance checks per decision; this keeps it near 72k.
   */
  static readonly MAX_CANDIDATES = 48;

  constructor(private readonly gameState: GameStateManager) {
    super('NuclearStrike', 97);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.phase !== 'wave') return false;
    if (this.gameState.abilityManager.checkUse(NUKE.id) !== null) return false;
    return this.finalStretch().length >= NuclearStrikeStrategy.MIN_FINAL_STRETCH_ENEMIES;
  }

  execute(_state: GameStateSnapshot): TowerAction | null {
    const stretch = this.finalStretch();
    if (stretch.length < NuclearStrikeStrategy.MIN_FINAL_STRETCH_ENEMIES) return null;

    const { center, covered } = this.densestCenter(stretch);
    return {
      type: 'use-ability',
      abilityId: NUKE.id,
      position: { x: center.position.lon, z: center.position.lat },
      confidence: 0.9,
      reason: `Nuclear strike on ${covered} of ${stretch.length} enemies in the last fifth of the route`,
    };
  }

  /** Alive enemies in the last fifth of their route, in manager order. */
  private finalStretch(): Enemy[] {
    const stretch: Enemy[] = [];
    for (const enemy of this.gameState.enemyManager.getAlive()) {
      if (enemy.movement.getPathProgress() >= NuclearStrikeStrategy.FINAL_STRETCH) {
        stretch.push(enemy);
      }
    }
    return stretch;
  }

  /** The candidate that has the most of `stretch` within the strike radius; ties keep the first. */
  private densestCenter(stretch: readonly Enemy[]): { center: Enemy; covered: number } {
    const stride = Math.ceil(stretch.length / NuclearStrikeStrategy.MAX_CANDIDATES);
    let center = stretch[0];
    let covered = -1;
    for (let i = 0; i < stretch.length; i += stride) {
      const candidate = stretch[i];
      let count = 0;
      for (const other of stretch) {
        if (geoDistanceFast(candidate.position, other.position) <= NUKE.radiusM) count++;
      }
      if (count > covered) {
        center = candidate;
        covered = count;
      }
    }
    return { center, covered };
  }
}
