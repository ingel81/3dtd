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

  /** Tower types this bot knows how to use */
  knownTowerTypes: TowerTypeId[];

  /** Whether bot considers enemy types when building */
  adaptsToEnemies: boolean;

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
   * Advance internal timers by `deltaTime` (game-time ms) and report whether a
   * decision is due this tick.
   *
   * Split out from {@link update} so callers can avoid building a state
   * snapshot on ticks where the bot is still in reaction cooldown. At training
   * timescales the sub-step loop runs hundreds of ticks per rendered frame and
   * the snapshot is by far the most expensive thing in it.
   */
  tickCooldown(deltaTime: number): boolean;

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
 * All combat towers. The Research Center is not one and is filtered out by
 * `attackType === 'passive'`; research unlocks are the actual gate on what the
 * bot can build. Skill levels differ in reaction time and tower cap, not in
 * which towers they know about.
 */
const ALL_COMBAT_TOWERS: TowerTypeId[] = [
  'archer', 'dual-gatling', 'cannon', 'magic', 'rocket', 'ice', 'fire', 'tentacle', 'poison',
  // Lightning was missing here, so the bot could never build it even after
  // researching storm-mastery — and the AI therefore never saw it played.
  'lightning',
];

/**
 * Default bot configurations by skill level
 */
export const BOT_CONFIGS: Record<BotSkillLevel, BotConfig> = {
  beginner: {
    skillLevel: 'beginner',
    reactionTimeMs: 3000,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    adaptsToEnemies: false,
    maxTowers: 10,
  },

  casual: {
    skillLevel: 'casual',
    reactionTimeMs: 1500,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    adaptsToEnemies: true,
    maxTowers: 15,
  },

  strategist: {
    skillLevel: 'strategist',
    reactionTimeMs: 800,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    adaptsToEnemies: true,
    // The design target roster is ~13 towers (one of each type, archer x3) at
    // level 20 — see docs/wave-planner.html. This cap sits well above that
    // while keeping combat resolution affordable: at 300 the bot actually
    // built 298 towers and combat alone cost 6ms per sub-step, which at
    // timescale 75 (~225 sub-steps per frame) collapsed the loop to 2 FPS.
    // The gold-hoarding that motivated raising it to 300 had a different
    // cause: the upgrade strategy only ever looked at a single tower.
    maxTowers: 80,
  },

  meta: {
    skillLevel: 'meta',
    reactionTimeMs: 400,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    adaptsToEnemies: true,
    maxTowers: 80,  // Matches strategist; see the note there.
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
