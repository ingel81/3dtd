/**
 * Frost Bomb Strategy
 *
 * Priority: 96, right under the nuclear strike: both spend a charge when a
 * wave presses, the strike takes the moment first.
 *
 * Fires when: a wave runs, the frost bomb is ready (researched, charged) and
 * a group of at least MIN_CLUSTER enemies stands within the bomb's radius
 * somewhere in the second half of the route (path progress from 0.5). A
 * frozen group stands in the towers' fire for 3 s longer.
 * Aims at: the enemy of the second half with the most others within the
 * radius (densestCenter). The AbilityManager snaps the aim to the route.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { ABILITIES } from '../../../../configs/abilities.config';
import { DecisionAim, densestCenter, enemiesFromProgress } from './ability-aim';

const FROST = ABILITIES['frost-bomb'];

export class FrostBombStrategy extends BaseStrategy {
  /** Path progress from which an enemy counts: the second half of its route */
  static readonly FROM_PROGRESS = 0.5;
  /** Fewer than this within the radius of one spot and the charge is kept */
  static readonly MIN_CLUSTER = 8;

  private readonly decision = new DecisionAim<ReturnType<typeof densestCenter>>();

  constructor(private readonly gameState: GameStateManager) {
    super('FrostBomb', 96);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.phase !== 'wave') return false;
    if (this.gameState.abilityManager.checkUse(FROST.id) !== null) return false;
    return this.decision.find(state, () => this.aim()) !== null;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const aim = this.decision.take(state, () => this.aim());
    if (!aim) return null;
    return {
      type: 'use-ability',
      abilityId: FROST.id,
      position: { x: aim.center.position.lon, z: aim.center.position.lat },
      confidence: 0.85,
      reason: `Frost bomb on ${aim.covered} enemies in the second half of the route`,
    };
  }

  /** The densest spot of the second half, or null while no group is big enough. */
  private aim() {
    const candidates = enemiesFromProgress(this.gameState, FrostBombStrategy.FROM_PROGRESS);
    if (candidates.length < FrostBombStrategy.MIN_CLUSTER) return null;
    const aim = densestCenter(candidates, FROST.radiusM);
    return aim.covered >= FrostBombStrategy.MIN_CLUSTER ? aim : null;
  }
}
