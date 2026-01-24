/**
 * Casual Bot
 *
 * Simulates a casual player who:
 * - Knows basic tower placement
 * - Sometimes upgrades towers
 * - Occasionally makes suboptimal choices
 * - Doesn't plan far ahead
 */

import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TowerTypeId, TOWER_TYPES } from '../../../configs/tower-types.config';
import { TowerAction } from './tower-bot.interface';
import { BaseTowerBot } from './base-tower-bot';

export class CasualBot extends BaseTowerBot {
  private preferredTowers: TowerTypeId[] = ['archer', 'cannon', 'ice'];
  private upgradeChance = 0.3; // 30% chance to upgrade instead of build

  constructor() {
    super('casual', 'CasualBot');
  }

  protected decideAction(state: GameStateSnapshot): TowerAction | null {
    const credits = state.player.credits;

    // Not enough gold for anything
    if (credits < 20) {
      return { type: 'wait', reason: 'Sparen fuer naechsten Tower' };
    }

    // Maybe upgrade existing tower
    if (
      state.defense.towerCount > 0 &&
      Math.random() < this.upgradeChance &&
      credits > 50
    ) {
      return this.considerUpgrade(state);
    }

    // Build new tower
    return this.buildTower(state);
  }

  private buildTower(state: GameStateSnapshot): TowerAction | null {
    const credits = state.player.credits;

    // Pick tower type
    let towerType = this.getBestTowerForSituation(state, credits);

    if (!towerType) {
      // Fall back to preferred towers
      for (const preferred of this.preferredTowers) {
        if (TOWER_TYPES[preferred]?.cost <= credits) {
          towerType = preferred;
          break;
        }
      }
    }

    if (!towerType) return null;

    // Pick position (simplified - random near center)
    const position = this.getRandomPlacementPosition();

    return {
      type: 'place',
      towerType,
      position,
      reason: `Baue ${TOWER_TYPES[towerType].name}`,
      confidence: 0.7,
    };
  }

  private considerUpgrade(_state: GameStateSnapshot): TowerAction | null {
    // Simplified: always wait (upgrading requires knowing tower IDs)
    // In real implementation, this would check existing towers
    return { type: 'wait', reason: 'Ueberlege Upgrade...' };
  }

  protected override makeSuboptimalAction(
    state: GameStateSnapshot,
    originalAction: TowerAction
  ): TowerAction {
    if (originalAction.type !== 'place') {
      return originalAction;
    }

    // Mistake types for casual player:
    const mistakeType = Math.random();

    if (mistakeType < 0.4) {
      // Wrong tower type (build archer instead of what was planned)
      return {
        ...originalAction,
        towerType: 'archer',
        reason: 'Baue sicherheitshalber Archer',
        confidence: 0.5,
      };
    } else if (mistakeType < 0.7) {
      // Suboptimal position (further from path)
      return {
        ...originalAction,
        position: {
          x: originalAction.position!.x + (Math.random() - 0.5) * 50,
          z: originalAction.position!.z + (Math.random() - 0.5) * 50,
        },
        reason: 'Position nicht ganz optimal',
        confidence: 0.4,
      };
    } else {
      // Wait instead (indecision)
      return {
        type: 'wait',
        reason: 'Noch unsicher...',
        confidence: 0.3,
      };
    }
  }
}
