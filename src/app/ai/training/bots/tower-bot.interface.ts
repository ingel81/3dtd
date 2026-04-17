/**
 * Tower Bot Interface
 *
 * Defines the contract for AI training bots that play the tower defense side.
 * These bots simulate different player skill levels for training the Wave Director.
 */

import { GameStateSnapshot } from '../../core/models/game-state-snapshot';
import { TowerTypeId } from '../../../configs/tower-types.config';

/**
 * Bot skill levels
 */
export type BotSkillLevel = 'beginner' | 'casual' | 'strategist' | 'meta';

/**
 * Tower action types
 */
export type TowerActionType = 'place' | 'upgrade' | 'sell' | 'wait' | 'start-wave' | 'research-start' | 'research-cancel';

/**
 * Tower action returned by bot
 */
export interface TowerAction {
  type: TowerActionType;

  /** For 'place': Where to place the tower (grid coordinates) */
  position?: { x: number; z: number };

  /** For 'place': What tower type to build */
  towerType?: TowerTypeId;

  /** For 'upgrade' and 'sell': Which tower to act on */
  towerId?: string;

  /** For 'upgrade': Which upgrade to apply */
  upgradeId?: string;

  /** For 'research-start' and 'research-cancel': Which research to act on */
  researchId?: string;

  /** Confidence in this action (0-1) */
  confidence?: number;

  /** Human-readable reason for this action */
  reason?: string;
}

/**
 * Bot configuration
 */
export interface BotConfig {
  /** Skill level preset */
  skillLevel: BotSkillLevel;

  /** Reaction time in ms (time between decisions) */
  reactionTimeMs: number;

  /** Mistake rate (0-1, probability of suboptimal action) */
  mistakeRate: number;

  /** Tower types this bot knows how to use */
  knownTowerTypes: TowerTypeId[];

  /** Whether bot considers enemy types when building */
  adaptsToEnemies: boolean;

  /** Whether bot plans ahead (multiple waves) */
  plansAhead: boolean;

  /** Max towers bot will build (0 = unlimited) */
  maxTowers: number;
}

/**
 * Tower Bot interface
 */
export interface ITowerBot {
  /** Bot configuration */
  readonly config: BotConfig;

  /** Bot name for display */
  readonly name: string;

  /**
   * Get next action based on game state
   *
   * @param state Current game state snapshot
   * @param deltaTime Time since last update (ms)
   * @returns Action to take, or null if no action needed
   */
  update(state: GameStateSnapshot, deltaTime: number): TowerAction | null;

  /**
   * Reset bot state for new game
   */
  reset(): void;

  /**
   * Notify bot of wave completion (for learning bots)
   */
  onWaveCompleted?(survived: boolean, damagePercent: number): void;
}

/**
 * All combat towers — Research Center is NOT a combat tower and excluded by
 * base-tower-bot.ts (attackType === 'passive'). Research is the actual gate.
 * Skill-level differences come from reactionTimeMs, mistakeRate, maxTowers,
 * adaptsToEnemies, plansAhead — not knownTowerTypes.
 */
const ALL_COMBAT_TOWERS: TowerTypeId[] = [
  'archer', 'dual-gatling', 'cannon', 'magic', 'rocket', 'ice', 'fire', 'tentacle', 'poison',
];

/**
 * Default bot configurations by skill level
 */
export const BOT_CONFIGS: Record<BotSkillLevel, BotConfig> = {
  beginner: {
    skillLevel: 'beginner',
    reactionTimeMs: 3000,
    mistakeRate: 0.4,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    adaptsToEnemies: false,
    plansAhead: false,
    maxTowers: 10,
  },

  casual: {
    skillLevel: 'casual',
    reactionTimeMs: 1500,
    mistakeRate: 0.2,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    adaptsToEnemies: true,
    plansAhead: false,
    maxTowers: 15,
  },

  strategist: {
    skillLevel: 'strategist',
    reactionTimeMs: 800,
    mistakeRate: 0.05,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    adaptsToEnemies: true,
    plansAhead: true,
    maxTowers: 50,
  },

  meta: {
    skillLevel: 'meta',
    reactionTimeMs: 400,
    mistakeRate: 0.01,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    adaptsToEnemies: true,
    plansAhead: true,
    maxTowers: 0, // Unlimited
  },
};

/**
 * Get human-readable description of bot
 */
export function getBotDescription(level: BotSkillLevel): string {
  const descriptions: Record<BotSkillLevel, string> = {
    beginner: 'Neuer Spieler - platziert zufaellig, macht viele Fehler',
    casual: 'Gelegenheitsspieler - versteht Grundlagen, manchmal Fehler',
    strategist: 'Erfahrener Spieler - plant voraus, wenige Fehler',
    meta: 'Profi-Spieler - optimale Builds, fast keine Fehler',
  };
  return descriptions[level];
}
