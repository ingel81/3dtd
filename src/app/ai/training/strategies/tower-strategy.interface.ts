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
import { ArmorType } from '../../../configs/combat/combat.types';
import { computeTowerDPSFromLevels, armorMultipliersFor } from '../../core/tower-dps.util';

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

  /**
   * Optional: called once per frame with game-time delta. Override for
   * strategies with internal cooldowns (e.g. sell-cooldown, wave-start-delay).
   */
  tickCooldowns?(deltaTime: number): void;
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

  /**
   * Called once per frame by StrategyBot with game-time delta.
   * Strategies with internal cooldowns override this to decrement them.
   * Default: no-op so most strategies don't need to care.
   */
  tickCooldowns(_deltaTime: number): void {
    /* no-op by default */
  }

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
   * Value of a freshly-built tower: DPS per credit.
   *
   * Uses the shared DPS function rather than `damage * fireRate`. That shortcut
   * returns 0 for beam towers (Fire keeps its output in `damagePerSecond` and
   * has `damage: 0`) and ignores chain falloff, splash and DoT — so Fire could
   * never win a comparison and Lightning was undervalued.
   */
  protected getTowerValue(towerType: TowerTypeId): number {
    const config = TOWER_TYPES[towerType];
    if (!config || config.cost <= 0) return 0;
    return computeTowerDPSFromLevels(config, {}) / config.cost;
  }

  /**
   * Value of a tower against a specific armor class: effective DPS per credit.
   *
   * Raw DPS is misleading whenever the armor matrix is lopsided — an Archer
   * out-DPSes a Magic tower on paper but lands at 0.15x against ethereal while
   * Magic lands at 1.75x.
   */
  protected getTowerValueVsArmor(towerType: TowerTypeId, armor: ArmorType): number {
    const config = TOWER_TYPES[towerType];
    if (!config || config.cost <= 0) return 0;
    const multiplier = armorMultipliersFor(config.damageType)[armor] ?? 1;
    return (computeTowerDPSFromLevels(config, {}) * multiplier) / config.cost;
  }
}
