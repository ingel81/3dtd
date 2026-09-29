/**
 * Tower Bot Interface
 *
 * Defines the contract for AI training bots that play the tower defense side.
 * These bots simulate different player skill levels for training the Wave Director.
 */

import { GameStateSnapshot } from '../../director/models/game-state-snapshot';
import { TowerTypeId } from '../../configs/tower-types.config';
import type { AbilityId } from '../../configs/abilities.config';
import type { HeroAmmoId } from '../../configs/hero.config';

/**
 * Bot skill levels
 */
/**
 * Two bots, decided 2026-09-20 (BALANCING_PLAN.md, D15): a beginner who
 * reacts slowly and builds little, and an expert who researches everything,
 * uses the abilities and hires the hero. The four levels before that had two
 * pairs with identical strategies.
 */
export type BotSkillLevel = 'beginner' | 'expert';

/**
 * Tower action types
 */
export type TowerActionType =
  'place' | 'upgrade' | 'sell' | 'wait' | 'start-wave' | 'research-start' | 'research-cancel'
  | 'use-ability' | 'hire-hero' | 'hero-move' | 'hero-ammo';

/**
 * Tower action returned by bot
 */
export interface TowerAction {
  type: TowerActionType;

  /** For 'place': where to place the tower; for 'use-ability': where to aim. x = lon, z = lat */
  position?: { x: number; z: number };

  /** For 'use-ability': which ability to fire */
  abilityId?: AbilityId;

  /** For 'place': What tower type to build */
  towerType?: TowerTypeId;

  /** For 'upgrade' and 'sell': Which tower to act on */
  towerId?: string;

  /** For 'upgrade': Which upgrade to apply */
  upgradeId?: string;

  /** For 'research-start' and 'research-cancel': Which research to act on */
  researchId?: string;

  /** For 'hero-ammo': which rounds he loads */
  ammo?: HeroAmmoId;

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
 * All combat towers. The passive buildings (Research Center, Missile Silo)
 * are none and are filtered out by `attackType === 'passive'`; strategies of
 * their own place them. Research unlocks are the actual gate on what the
 * bot can build. Skill levels differ in reaction time and tower cap, not in
 * which towers they know about.
 */
const ALL_COMBAT_TOWERS: TowerTypeId[] = [
  'archer', 'dual-gatling', 'cannon', 'magic', 'rocket', 'ice', 'fire', 'tentacle', 'poison',
  // Lightning was missing here, so the bot could never build it even after
  // researching storm-mastery — and the AI therefore never saw it played.
  'lightning',
  'chaos',
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

  expert: {
    skillLevel: 'expert',
    reactionTimeMs: 800,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    adaptsToEnemies: true,
    // Well above the design roster of ~13 towers (docs/wave-planner.html),
    // so the bot measures what a player who keeps building reaches. The wave
    // sources plan against the defense that stands, so a higher cap no longer
    // teaches anything wrong; it only has to keep combat affordable in the
    // measurement runs: at 300 the bot built 298 towers and combat alone cost
    // 6ms per sub-step. With the factory's jitter the cap lands between 28
    // and 52.
    maxTowers: 40,
  },
};
