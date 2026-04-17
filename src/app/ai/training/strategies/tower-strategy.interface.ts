/**
 * Tower Strategy Interface
 *
 * Each strategy represents a single decision-making concern:
 * - Placement (where to build)
 * - Upgrade (which tower to upgrade)
 * - Economy (when to save/spend)
 * - Wave timing (when to start next wave)
 */

import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TowerAction } from '../bots/tower-bot.interface';
import { TowerTypeId, TOWER_TYPES } from '../../../configs/tower-types.config';

export interface ITowerStrategy {
  /** Strategy name (for debugging) */
  readonly name: string;

  /** Priority (0-100, higher = more important) */
  readonly priority: number;

  /**
   * Can this strategy execute now?
   * @returns true if strategy is applicable to current game state
   */
  canExecute(state: GameStateSnapshot): boolean;

  /**
   * Execute strategy and return action
   * @returns TowerAction to perform, or null if strategy cannot execute
   */
  execute(state: GameStateSnapshot): TowerAction | null;
}

/**
 * Abstract base for strategies (optional, provides helpers)
 */
export abstract class BaseStrategy implements ITowerStrategy {
  constructor(
    public readonly name: string,
    public readonly priority: number
  ) {}

  abstract canExecute(state: GameStateSnapshot): boolean;
  abstract execute(state: GameStateSnapshot): TowerAction | null;

  // Helper methods shared by all strategies

  /**
   * Get affordable towers from known types.
   * Filters out:
   * - Passive buildings (research-center) — not combat towers
   * - Locked towers (if state provided) — respects research unlocks
   *
   * @param state Optional snapshot for research-gate check. Omit in contexts
   *              where research isn't relevant (rare — nearly all callers have state).
   */
  protected getAffordableTowers(
    credits: number,
    knownTypes: TowerTypeId[],
    state?: GameStateSnapshot
  ): TowerTypeId[] {
    return knownTypes.filter(typeId => {
      const config = TOWER_TYPES[typeId];
      if (!config || config.cost > credits) return false;
      if (config.attackType === 'passive') return false;
      if (state?.research && !state.research.towerUnlocked[typeId]) return false;
      return true;
    });
  }

  /**
   * Calculate tower value (DPS per cost)
   */
  protected getTowerValue(towerType: TowerTypeId): number {
    const config = TOWER_TYPES[towerType];
    const dps = config.damage * config.fireRate;
    return dps / config.cost;
  }
}
