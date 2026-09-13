/**
 * EMP Strategy
 *
 * Priority: 94, under the nuclear strike and the frost bomb.
 *
 * Fires when: a wave runs, the EMP is ready (researched, charged) and
 * either at least MIN_MACHINES machines (`mechanical`) stand within its
 * radius around one of them from path progress 0.4 on, where the EMP stops
 * them for 6 s, or at least MIN_CROWD enemies of any kind stand within it
 * in the last 40 % of the route, where even 1.5 s counts.
 * Aims at: the machine with the most machines around it, else the enemy of
 * the crowd with the most others around it (densestCenter). The
 * AbilityManager snaps the aim to the route.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { ABILITIES } from '../../../../configs/abilities.config';
import type { Enemy } from '../../../../entities/enemy.entity';
import { densestCenter, enemiesFromProgress } from './ability-aim';

const EMP = ABILITIES['emp'];

interface EmpAim {
  center: Enemy;
  covered: number;
  machines: boolean;
}

export class EmpStrategy extends BaseStrategy {
  /** Machines count from this path progress on */
  static readonly MACHINES_FROM = 0.4;
  /** Machines within the radius of one spot that are worth the charge */
  static readonly MIN_MACHINES = 3;
  /** Any enemy counts from this path progress on */
  static readonly CROWD_FROM = 0.6;
  /** Enemies within the radius of one spot that are worth the charge without machines */
  static readonly MIN_CROWD = 12;

  constructor(private readonly gameState: GameStateManager) {
    super('Emp', 94);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.phase !== 'wave') return false;
    if (this.gameState.abilityManager.checkUse(EMP.id) !== null) return false;
    return this.aim() !== null;
  }

  execute(_state: GameStateSnapshot): TowerAction | null {
    const aim = this.aim();
    if (!aim) return null;
    return {
      type: 'use-ability',
      abilityId: EMP.id,
      position: { x: aim.center.position.lon, z: aim.center.position.lat },
      confidence: 0.85,
      reason: aim.machines
        ? `EMP on ${aim.covered} machines`
        : `EMP on ${aim.covered} enemies in the last 40% of the route`,
    };
  }

  /** Machines first, then a crowd; null while neither is big enough. */
  private aim(): EmpAim | null {
    const machines = enemiesFromProgress(this.gameState, EmpStrategy.MACHINES_FROM)
      .filter((enemy) => enemy.typeConfig.mechanical);
    if (machines.length >= EmpStrategy.MIN_MACHINES) {
      const aim = densestCenter(machines, EMP.radiusM);
      if (aim.covered >= EmpStrategy.MIN_MACHINES) return { ...aim, machines: true };
    }
    const crowd = enemiesFromProgress(this.gameState, EmpStrategy.CROWD_FROM);
    if (crowd.length < EmpStrategy.MIN_CROWD) return null;
    const aim = densestCenter(crowd, EMP.radiusM);
    return aim.covered >= EmpStrategy.MIN_CROWD ? { ...aim, machines: false } : null;
  }
}
