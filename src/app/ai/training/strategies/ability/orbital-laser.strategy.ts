/**
 * Orbital Laser Strategy
 *
 * Priority: 93, under the other abilities.
 *
 * Fires when: a wave runs, the laser is ready (researched, charged) and an
 * enemy in the second half of its route (path progress from 0.5) has at
 * least MIN_COVERED enemies behind it on the same route within the beam's
 * reach (72 m): the beam lands next to the aim and burns back toward the
 * spawn, through the column behind it.
 * Aims at: that enemy, the one with the most behind it; at most
 * MAX_AIM_CANDIDATES candidates, ties keep the first. The AbilityManager
 * snaps the aim to the route.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { ABILITIES, abilityBeamReachM } from '../../../../configs/abilities.config';
import type { Enemy } from '../../../../entities/enemy.entity';
import { MAX_AIM_CANDIDATES, enemiesFromProgress } from './ability-aim';

const LASER = ABILITIES['orbital-laser'];
const REACH_M = LASER.effect.kind === 'beam' ? abilityBeamReachM(LASER.effect) : 0;

export class OrbitalLaserStrategy extends BaseStrategy {
  /** Leaders count from this path progress on */
  static readonly FROM_PROGRESS = 0.5;
  /** Fewer enemies than this on the stretch the beam would burn and the charge is kept */
  static readonly MIN_COVERED = 10;

  constructor(private readonly gameState: GameStateManager) {
    super('OrbitalLaser', 93);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.phase !== 'wave') return false;
    if (this.gameState.abilityManager.checkUse(LASER.id) !== null) return false;
    return this.aim() !== null;
  }

  execute(_state: GameStateSnapshot): TowerAction | null {
    const aim = this.aim();
    if (!aim) return null;
    return {
      type: 'use-ability',
      abilityId: LASER.id,
      position: { x: aim.leader.position.lon, z: aim.leader.position.lat },
      confidence: 0.85,
      reason: `Orbital laser down the route through ${aim.covered} enemies`,
    };
  }

  /** The leader with the most enemies on the stretch behind it, or null while none has enough. */
  private aim(): { leader: Enemy; covered: number } | null {
    const leaders = enemiesFromProgress(this.gameState, OrbitalLaserStrategy.FROM_PROGRESS);
    if (leaders.length === 0) return null;
    const alive = this.gameState.enemyManager.getAlive();
    const stride = Math.ceil(leaders.length / MAX_AIM_CANDIDATES);
    let best: { leader: Enemy; covered: number } | null = null;
    for (let i = 0; i < leaders.length; i += stride) {
      const leader = leaders[i];
      const path = leader.movement.path;
      const front = leader.movement.getDistanceAlongPath();
      let covered = 0;
      for (const enemy of alive) {
        if (enemy.movement.path !== path) continue;
        const behind = front - enemy.movement.getDistanceAlongPath();
        if (behind >= 0 && behind <= REACH_M) covered++;
      }
      if (best === null || covered > best.covered) best = { leader, covered };
    }
    return best && best.covered >= OrbitalLaserStrategy.MIN_COVERED ? best : null;
  }
}
