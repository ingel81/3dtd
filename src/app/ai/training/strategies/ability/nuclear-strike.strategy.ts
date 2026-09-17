/**
 * Nuclear Strike Strategy
 *
 * Priority: 97, above every other strategy: a charge is worth most in the
 * few decisions where a wave is about to break through, and a placement or
 * upgrade can wait for the next one.
 *
 * Leads the enemies: the missile lands `warningMs` (6.5 s) after the
 * command, and a zombie walks 32 m meanwhile. Every enemy is taken where it
 * will stand then: its speed of the moment (slows and halts included) times
 * the warning further along its path (enemyAhead). One that would be past
 * its path's end by then has reached the HQ and is not counted.
 *
 * Fires when: a wave runs, the strike is ready (researched, charged, a
 * missile silo standing) and at least MIN_FINAL_STRETCH_ENEMIES enemies will
 * stand in the last fifth of their route at the impact, before the HQ
 * (PLAYER_AGENCY_CONCEPT.md, section 7).
 * Aims at: the spot, among those enemies' spots at the impact, with the most
 * of the others within the strike radius (densestCenter). The
 * AbilityManager snaps the aim to the route, as it does for a click.
 */

import { BaseStrategy } from '../tower-strategy.interface';
import { GameStateSnapshot } from '../../../core/models/game-state-snapshot';
import { TowerAction } from '../../bots/tower-bot.interface';
import { GameStateManager } from '../../../../managers/game-state.manager';
import { ABILITIES } from '../../../../configs/abilities.config';
import type { GeoPosition } from '../../../../models/game.types';
import { DecisionAim, densestCenter, enemyAhead, type Positioned } from './ability-aim';

const NUKE = ABILITIES['nuclear-strike'];
const WARNING_S = NUKE.warningMs / 1000;

interface StrikeAim {
  /** Where the strike is aimed: the densest spot at the impact */
  point: GeoPosition;
  /** Enemies expected within the radius of it */
  covered: number;
  /** Enemies expected in the last fifth of their route, before the HQ */
  stretch: number;
}

export class NuclearStrikeStrategy extends BaseStrategy {
  /** Path progress from which an enemy stands in the last fifth of its route */
  static readonly FINAL_STRETCH = 0.8;
  /** "Many": fewer than this in the last fifth at the impact and the charge is kept */
  static readonly MIN_FINAL_STRETCH_ENEMIES = 10;

  private readonly decision = new DecisionAim<StrikeAim>();

  constructor(private readonly gameState: GameStateManager) {
    super('NuclearStrike', 97);
  }

  canExecute(state: GameStateSnapshot): boolean {
    if (state.phase !== 'wave') return false;
    if (this.gameState.abilityManager.checkUse(NUKE.id) !== null) return false;
    return this.decision.find(state, () => this.aim()) !== null;
  }

  execute(state: GameStateSnapshot): TowerAction | null {
    const aim = this.decision.take(state, () => this.aim());
    if (!aim) return null;
    return {
      type: 'use-ability',
      abilityId: NUKE.id,
      position: { x: aim.point.lon, z: aim.point.lat },
      confidence: 0.9,
      reason: `Nuclear strike on ${aim.covered} of ${aim.stretch} enemies in the last fifth of the route at the impact`,
    };
  }

  /**
   * The spots of the enemies that will stand in the last fifth of their
   * route when the strike lands, and the densest of them; null for fewer
   * than MIN_FINAL_STRETCH_ENEMIES.
   */
  private aim(): StrikeAim | null {
    const now = this.gameState.gameTimeMs;
    const spots: Positioned[] = [];
    for (const enemy of this.gameState.enemyManager.getAlive()) {
      const ahead = enemyAhead(enemy, enemy.movement.getEffectiveSpeed(now) * WARNING_S);
      if (ahead.progress < NuclearStrikeStrategy.FINAL_STRETCH || ahead.progress >= 1) continue;
      spots.push(ahead);
    }
    if (spots.length < NuclearStrikeStrategy.MIN_FINAL_STRETCH_ENEMIES) return null;

    const { center, covered } = densestCenter(spots, NUKE.radiusM);
    return { point: center.position, covered, stretch: spots.length };
  }
}
