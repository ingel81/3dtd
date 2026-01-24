/**
 * Beginner Bot
 *
 * Simulates a new player who:
 * - Places towers randomly
 * - Only knows basic tower types
 * - Makes many mistakes
 * - Doesn't understand enemy types
 */

import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TOWER_TYPES } from '../../../configs/tower-types.config';
import { TowerAction } from './tower-bot.interface';
import { BaseTowerBot } from './base-tower-bot';

export class BeginnerBot extends BaseTowerBot {
  constructor() {
    super('beginner', 'BeginnerBot');
  }

  protected decideAction(state: GameStateSnapshot): TowerAction | null {
    const credits = state.player.credits;

    // Beginners often wait too long before building
    if (Math.random() < 0.3) {
      return { type: 'wait', reason: 'Weiss nicht was ich tun soll...' };
    }

    // Can only afford archer?
    if (credits < TOWER_TYPES.cannon.cost) {
      if (credits >= TOWER_TYPES.archer.cost) {
        return this.buildArcher();
      }
      return { type: 'wait', reason: 'Sparen...' };
    }

    // Has enough for cannon - 50% chance to build cannon, 50% archer
    if (Math.random() < 0.5) {
      return this.buildCannon();
    } else {
      return this.buildArcher();
    }
  }

  private buildArcher(): TowerAction {
    return {
      type: 'place',
      towerType: 'archer',
      position: this.getRandomPlacementPosition(),
      reason: 'Archer ist guenstig',
      confidence: 0.5,
    };
  }

  private buildCannon(): TowerAction {
    return {
      type: 'place',
      towerType: 'cannon',
      position: this.getRandomPlacementPosition(),
      reason: 'Cannon macht viel Schaden',
      confidence: 0.6,
    };
  }

  protected override getRandomPlacementPosition(): { x: number; z: number } {
    // Beginners place very randomly, often far from path
    return {
      x: (Math.random() - 0.5) * 300,
      z: (Math.random() - 0.5) * 300,
    };
  }

  protected override makeSuboptimalAction(
    state: GameStateSnapshot,
    originalAction: TowerAction
  ): TowerAction {
    // Beginners often just wait when confused
    if (Math.random() < 0.5) {
      return { type: 'wait', reason: 'Verwirrt...' };
    }

    // Or place in really bad spot
    return {
      ...originalAction,
      position: {
        x: (Math.random() - 0.5) * 400,
        z: (Math.random() - 0.5) * 400,
      },
      reason: 'Irgendwo hingestellt',
      confidence: 0.2,
    };
  }
}
