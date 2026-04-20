/**
 * Base Tower Bot
 *
 * Abstract base class for all tower bots.
 * Implements common functionality like timing and state management.
 */

import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TowerTypeId, TOWER_TYPES } from '../../../configs/tower-types.config';
import { ArmorType, ARMOR_TYPES } from '../../../configs/combat/combat.types';
import { DAMAGE_MATRIX } from '../../../configs/combat/damage-matrix.config';
import {
  ITowerBot,
  TowerAction,
  BotConfig,
  BOT_CONFIGS,
  BotSkillLevel,
} from './tower-bot.interface';

export abstract class BaseTowerBot implements ITowerBot {
  readonly config: BotConfig;
  readonly name: string;

  protected lastActionTime = 0;
  protected totalGoldSpent = 0;
  protected towersBuilt = 0;

  /**
   * @param skillLevel Baseline config from BOT_CONFIGS
   * @param configOverrides Optional per-instance tweaks (used by factory to add
   *   ±30% randomness to reactionTimeMs/maxTowers so concurrent training clients
   *   don't all play identically).
   * @param name Display name
   */
  constructor(skillLevel: BotSkillLevel, configOverrides?: Partial<BotConfig>, name?: string) {
    this.config = { ...BOT_CONFIGS[skillLevel], ...(configOverrides ?? {}) };
    this.name = name ?? `${skillLevel.charAt(0).toUpperCase()}${skillLevel.slice(1)}Bot`;
  }

  /**
   * Main update method - handles timing and delegates to subclass
   */
  update(state: GameStateSnapshot, _deltaTime: number): TowerAction | null {
    const now = Date.now();

    // Check cooldown
    if (now - this.lastActionTime < this.config.reactionTimeMs) {
      return null;
    }

    // Decide action (individual strategies handle tower limits)
    const action = this.decideAction(state);

    // Record action time (always apply cooldown, even for 'wait',
    // to prevent random-based decisions from being re-rolled every frame)
    if (action) {
      this.lastActionTime = now;

      if (action.type === 'place' && action.towerType) {
        const towerConfig = TOWER_TYPES[action.towerType];
        if (towerConfig) {
          this.totalGoldSpent += towerConfig.cost;
          this.towersBuilt++;
        }
      }
    }

    return action;
  }

  /**
   * Reset bot state for new game
   */
  reset(): void {
    this.lastActionTime = 0;
    this.totalGoldSpent = 0;
    this.towersBuilt = 0;
  }

  /**
   * Subclass must implement: decide what action to take
   */
  protected abstract decideAction(state: GameStateSnapshot): TowerAction | null;

  // === HELPER METHODS ===

  /**
   * Get cheapest tower this bot can build that it can afford.
   * Respects research unlock status when `state` is provided (optional for backwards compat).
   */
  protected getCheapestAffordableTower(credits: number, state?: GameStateSnapshot): TowerTypeId | null {
    let cheapest: TowerTypeId | null = null;
    let lowestCost = Infinity;

    for (const typeId of this.config.knownTowerTypes) {
      const config = TOWER_TYPES[typeId];
      if (!config || config.cost > credits || config.cost >= lowestCost) continue;
      if (config.attackType === 'passive') continue;
      if (state?.research && !state.research.towerUnlocked[typeId]) continue;
      lowestCost = config.cost;
      cheapest = typeId;
    }

    return cheapest;
  }

  /**
   * Get best tower for current situation.
   * Respects:
   * - knownTowerTypes (bot skill-limit)
   * - research unlock status (only unlocked towers)
   * - excludes passive buildings (research-center) — not a combat tower
   */
  protected getBestTowerForSituation(state: GameStateSnapshot, credits: number): TowerTypeId | null {
    const affordable = this.config.knownTowerTypes.filter((t) => {
      const config = TOWER_TYPES[t];
      if (!config || config.cost > credits) return false;
      if (config.attackType === 'passive') return false;       // exclude research-center etc.
      if (state.research && !state.research.towerUnlocked[t]) return false;
      return true;
    });

    if (affordable.length === 0) return null;

    // If adapts to enemies, check vulnerabilities first (high-prio matchups)
    if (this.config.adaptsToEnemies) {
      // No anti-air? Build anti-air if affordable
      if (state.vulnerabilities.airDefenseGap) {
        const antiAir = affordable.find((t) => TOWER_TYPES[t].canTargetAir);
        if (antiAir) return antiAir;
      }

      // No splash? Build splash for swarms
      if (state.vulnerabilities.splashGap) {
        const splash = affordable.find((t) => t === 'cannon' || t === 'rocket');
        if (splash) return splash;
      }

      // No slow? Build ice
      if (state.vulnerabilities.slowGap && affordable.includes('ice')) {
        return 'ice';
      }

      // DamageType-aware pick: use armor distribution to weight effective DPS
      if (state.expectedArmorDistribution) {
        return this.pickTowerByDamageMatrix(affordable, state.expectedArmorDistribution);
      }
    }

    // Default: pick based on DPS/cost ratio
    return this.getBestValueTower(affordable);
  }

  /**
   * Pick the tower with highest effective DPS-per-cost against expected armor mix.
   * effectiveDps = sum over armor-types: DAMAGE_MATRIX[damageType][armor] * dist[armor]
   */
  protected pickTowerByDamageMatrix(
    affordable: TowerTypeId[],
    armorDist: Record<ArmorType, number>
  ): TowerTypeId {
    let best: TowerTypeId = affordable[0];
    let bestScore = -Infinity;

    for (const typeId of affordable) {
      const cfg = TOWER_TYPES[typeId];
      if (!cfg) continue;

      // DPS: beam towers use damagePerSecond, projectile/melee use damage * fireRate
      const baseDps = cfg.attackType === 'beam'
        ? (cfg.damagePerSecond ?? 0)
        : cfg.damage * cfg.fireRate;
      if (baseDps <= 0) continue;

      const avgMultiplier = ARMOR_TYPES.reduce((sum, armor) => {
        const m = DAMAGE_MATRIX[cfg.damageType]?.[armor] ?? 1.0;
        return sum + m * (armorDist[armor] ?? 0);
      }, 0);

      const score = (baseDps * avgMultiplier) / cfg.cost;
      if (score > bestScore) {
        bestScore = score;
        best = typeId;
      }
    }
    return best;
  }

  /**
   * Get tower with best DPS/cost ratio
   */
  protected getBestValueTower(typeIds: TowerTypeId[]): TowerTypeId {
    let best: TowerTypeId = typeIds[0];
    let bestValue = 0;

    for (const typeId of typeIds) {
      const config = TOWER_TYPES[typeId];
      if (!config) continue;

      const dps = config.damage * config.fireRate;
      const value = dps / config.cost;

      if (value > bestValue) {
        bestValue = value;
        best = typeId;
      }
    }

    return best;
  }

  /**
   * Generate random position near path (simplified)
   */
  protected getRandomPlacementPosition(): { x: number; z: number } {
    // Simplified: random position in play area
    // In real implementation, this should be near the path
    return {
      x: (Math.random() - 0.5) * 200,
      z: (Math.random() - 0.5) * 200,
    };
  }
}
