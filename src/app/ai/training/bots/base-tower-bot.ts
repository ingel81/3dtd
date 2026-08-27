/**
 * Base Tower Bot
 *
 * Abstract base class for all tower bots.
 * Implements common functionality like timing and state management.
 */

import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TOWER_TYPES } from '../../../configs/tower-types.config';
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

  /**
   * Phase 5.12: Game-time cooldown accumulator. Decrements by deltaTime (game-time
   * from caller). Previous wall-clock `lastActionTime` made the bot make 75× fewer
   * decisions per game-second at high training timescales — the major cause of
   * "bot gets to wave 6 at 75× but wave 20 at 10×".
   */
  protected cooldownRemainingMs = 0;
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
   * Main update method - handles timing and delegates to subclass.
   * deltaTime is game-time ms (already timescale-scaled by TrainingClientService).
   */
  update(state: GameStateSnapshot, deltaTime: number): TowerAction | null {
    // Tick cooldown in game-time. While cooldown is active, return early.
    if (this.cooldownRemainingMs > 0) {
      this.cooldownRemainingMs -= deltaTime;
      if (this.cooldownRemainingMs > 0) return null;
      this.cooldownRemainingMs = 0;
    }

    // Decide action (individual strategies handle tower limits)
    const action = this.decideAction(state);

    // Reset cooldown on any action (including 'wait') to prevent random-based
    // decisions from being re-rolled every frame.
    if (action) {
      this.cooldownRemainingMs = this.config.reactionTimeMs;

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
    this.cooldownRemainingMs = 0;
    this.totalGoldSpent = 0;
    this.towersBuilt = 0;
  }

  /**
   * Subclass must implement: decide what action to take
   */
  protected abstract decideAction(state: GameStateSnapshot): TowerAction | null;
}
