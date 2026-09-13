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
 * within the strike radius (densestCenter). The AbilityManager snaps the aim
 * to the route, as it does for a click.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { ABILITIES } from '../../../../configs/abilities.config';
import { densestCenter, enemiesFromProgress } from './ability-aim';

const NUKE = ABILITIES['nuclear-strike'];

export class NuclearStrikeStrategy extends BaseStrategy {
  /** Path progress from which an enemy stands in the last fifth of its route */
  static readonly FINAL_STRETCH = 0.8;
  /** "Many": fewer than this in the last fifth and the charge is kept */
  static readonly MIN_FINAL_STRETCH_ENEMIES = 10;

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

    const { center, covered } = densestCenter(stretch, NUKE.radiusM);
    return {
      type: 'use-ability',
      abilityId: NUKE.id,
      position: { x: center.position.lon, z: center.position.lat },
      confidence: 0.9,
      reason: `Nuclear strike on ${covered} of ${stretch.length} enemies in the last fifth of the route`,
    };
  }

  /** Alive enemies in the last fifth of their route, in manager order. */
  private finalStretch() {
    return enemiesFromProgress(this.gameState, NuclearStrikeStrategy.FINAL_STRETCH);
  }
}
