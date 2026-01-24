/**
 * Strategist Bot
 *
 * Simulates an experienced player who:
 * - Plans tower placement strategically
 * - Adapts to enemy types
 * - Creates kill zones
 * - Upgrades efficiently
 * - Rarely makes mistakes
 */

import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TowerTypeId, TOWER_TYPES } from '../../../configs/tower-types.config';
import { TowerAction } from './tower-bot.interface';
import { BaseTowerBot } from './base-tower-bot';

export class StrategistBot extends BaseTowerBot {
  private buildOrder: TowerTypeId[] = [];
  private phase: 'early' | 'mid' | 'late' = 'early';

  constructor() {
    super('strategist', 'StrategistBot');
    this.planBuildOrder();
  }

  override reset(): void {
    super.reset();
    this.phase = 'early';
    this.planBuildOrder();
  }

  private planBuildOrder(): void {
    // Strategist has a planned build order
    this.buildOrder = [
      'archer', // Cheap early defense
      'archer',
      'ice', // Slow for control
      'cannon', // AoE damage
      'dual-gatling', // High DPS
      'magic', // DoT
      'cannon',
      'ice',
      'rocket', // Late game AoE
    ];
  }

  protected decideAction(state: GameStateSnapshot): TowerAction | null {
    const wave = state.waveNumber;

    // Update phase
    if (wave >= 15) this.phase = 'late';
    else if (wave >= 7) this.phase = 'mid';
    else this.phase = 'early';

    // Strategist evaluates multiple options
    const options = this.evaluateOptions(state);

    // Pick best option
    if (options.length === 0) {
      return { type: 'wait', reason: 'Warte auf Gold' };
    }

    // Sort by priority
    options.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    return options[0].action;
  }

  private evaluateOptions(
    state: GameStateSnapshot
  ): { action: TowerAction; priority: number }[] {
    const options: { action: TowerAction; priority: number }[] = [];
    const credits = state.player.credits;

    // Option 1: Follow build order
    if (this.towersBuilt < this.buildOrder.length) {
      const nextTower = this.buildOrder[this.towersBuilt];
      const config = TOWER_TYPES[nextTower];

      if (config && config.cost <= credits) {
        options.push({
          action: {
            type: 'place',
            towerType: nextTower,
            position: this.getStrategicPosition(state, nextTower),
            reason: `Build Order: ${config.name}`,
            confidence: 0.9,
          },
          priority: 80,
        });
      }
    }

    // Option 2: Counter vulnerabilities
    if (state.vulnerabilities.airDefenseGap && state.waveNumber > 3) {
      const antiAir = this.config.knownTowerTypes.find(
        (t) => TOWER_TYPES[t].canTargetAir && TOWER_TYPES[t].cost <= credits
      );
      if (antiAir) {
        options.push({
          action: {
            type: 'place',
            towerType: antiAir,
            position: this.getStrategicPosition(state, antiAir),
            reason: 'Brauche Anti-Air!',
            confidence: 0.95,
          },
          priority: 100, // High priority for critical gaps
        });
      }
    }

    if (state.vulnerabilities.splashGap && state.defense.towerCount >= 3) {
      if (TOWER_TYPES.cannon.cost <= credits) {
        options.push({
          action: {
            type: 'place',
            towerType: 'cannon',
            position: this.getStrategicPosition(state, 'cannon'),
            reason: 'Brauche Splash gegen Schwarm',
            confidence: 0.85,
          },
          priority: 90,
        });
      }
    }

    // Option 3: Economy play - save for expensive tower
    if (this.phase === 'mid' && credits < 300 && credits > 150) {
      options.push({
        action: {
          type: 'wait',
          reason: 'Spare fuer Dual-Gatling',
        },
        priority: 70,
      });
    }

    // Option 4: Fill gaps in coverage
    if (state.defense.pathCoverage < 0.6 && state.defense.towerCount >= 2) {
      const cheapTower = this.getCheapestAffordableTower(credits);
      if (cheapTower) {
        options.push({
          action: {
            type: 'place',
            towerType: cheapTower,
            position: this.getStrategicPosition(state, cheapTower),
            reason: 'Fuelle Luecke in Coverage',
            confidence: 0.75,
          },
          priority: 60,
        });
      }
    }

    return options;
  }

  private getStrategicPosition(
    _state: GameStateSnapshot,
    _towerType: TowerTypeId
  ): { x: number; z: number } {
    // Strategist places towers more carefully
    // Simplified: slight offset from center based on tower count
    const angle = (this.towersBuilt * 0.7) % (2 * Math.PI);
    const radius = 30 + this.towersBuilt * 5;

    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    };
  }

  protected override makeSuboptimalAction(
    state: GameStateSnapshot,
    originalAction: TowerAction
  ): TowerAction {
    // Strategist rarely makes mistakes, and they're minor
    if (originalAction.type === 'place' && originalAction.position) {
      // Slight position error
      return {
        ...originalAction,
        position: {
          x: originalAction.position.x + (Math.random() - 0.5) * 10,
          z: originalAction.position.z + (Math.random() - 0.5) * 10,
        },
        confidence: (originalAction.confidence ?? 0.9) - 0.1,
      };
    }
    return originalAction;
  }
}
