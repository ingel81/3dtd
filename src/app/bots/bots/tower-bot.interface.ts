/**
 * Tower Bot Interface
 *
 * Defines the contract for AI training bots that play the tower defense side.
 * These bots simulate different player skill levels for training the Wave Director.
 */

import { GameStateSnapshot } from '../../director/models/game-state-snapshot';
import { TowerTypeId, TargetingStrategy } from '../../configs/tower-types.config';
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
export type BotSkillLevel = 'beginner' | 'normal' | 'expert';

/**
 * Tower action types
 */
export type TowerActionType =
  'place' | 'upgrade' | 'sell' | 'wait' | 'start-wave' | 'research-start' | 'research-cancel'
  | 'use-ability' | 'hire-hero' | 'hero-move' | 'hero-ammo' | 'set-targeting' | 'give-credits';

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

  /** For 'set-targeting': what the tower (towerId) aims at */
  targeting?: TargetingStrategy;

  /** For 'give-credits': the coop partner and the gold */
  to?: string;
  amount?: number;

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

  /**
   * Chance that a decision looks at the wave panel and the last waves' leaks
   * (docs/BOT_PLAYER_PLAN.md, B5): without the look the bot reckons with the
   * expected armor mix on the ground and takes the last wave as held.
   */
  attention: number;

  /**
   * Spread on the value of every buy, a share drawn per decision: a player
   * does not always pick the best per gold.
   */
  noise: number;

  /** What the bot knows to do beyond building, upgrading and research */
  knows: {
    /** Hires the hero and sends him to the crowd */
    hero: boolean;
    /** Sells blind towers and makes room for better ones */
    selling: boolean;
    /** Turns towers on a boss and on air before a wave */
    targeting: boolean;
    /** Picks research against the armor that comes, not by a fixed list */
    adaptiveResearch: boolean;
    /** Spreads its towers over the zones of the route, not only its two ends */
    spreading: boolean;
    /** Coop: sends gold to a partner who leaks and runs short */
    gifting: boolean;
  };

  /** Max towers bot will build (0 = unlimited) */
  maxTowers: number;

  /**
   * Fighting towers the bot builds up to by a wave: `base + perWave × wave`
   * (docs/BOT_PLAYER_PLAN.md, B3). A player's pace, not a value: per gold a
   * new tower beats an upgrade, so a bot that only weighs value builds 35
   * archers by wave 4. In a human run (2026-10-01, wave 60) the defense stood
   * at 1 fighting tower at wave 1, 3 at 2, 8 at 4, 14 at 8, 29 at 12; the gold
   * beyond went into upgrades (tools/play-profile/play-profile.mjs).
   */
  buildTempo: { base: number; perWave: number };
}

/** Fighting towers a bot of `config` builds up to by wave `wave` (BotConfig.buildTempo) */
export function towersByWave(config: Pick<BotConfig, 'buildTempo'>, wave: number): number {
  return Math.floor(config.buildTempo.base + config.buildTempo.perWave * Math.max(0, wave));
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
  // Profiles (docs/BOT_PLAYER_PLAN.md, B5, decision P4). The expert is set
  // against the user's run of 2026-10-01; normal and beginner follow from it
  // with less knowledge, a slower hand and more spread. The reaction time is
  // the cap on actions too: 800 ms are 75 a minute of game time, the user's
  // run reached 60 to 90 in its upgrade bursts and 3 to 18 between them.
  beginner: {
    skillLevel: 'beginner',
    reactionTimeMs: 3000,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    attention: 0,
    noise: 0.5,
    knows: { hero: false, selling: false, targeting: false, adaptiveResearch: false, spreading: false, gifting: false },
    maxTowers: 10,
    buildTempo: { base: 1, perWave: 1 },
  },

  normal: {
    skillLevel: 'normal',
    reactionTimeMs: 1500,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    attention: 0.6,
    noise: 0.25,
    knows: { hero: true, selling: false, targeting: false, adaptiveResearch: true, spreading: true, gifting: true },
    maxTowers: 25,
    buildTempo: { base: 1, perWave: 1.5 },
  },

  expert: {
    skillLevel: 'expert',
    reactionTimeMs: 800,
    knownTowerTypes: ALL_COMBAT_TOWERS,
    attention: 0.95,
    noise: 0.1,
    knows: { hero: true, selling: true, targeting: true, adaptiveResearch: true, spreading: true, gifting: true },
    // Well above the design roster of ~13 towers (docs/wave-planner.html),
    // so the bot measures what a player who keeps building reaches. It keeps
    // combat affordable in the measurement runs: at 300 the bot built 298
    // towers and combat alone cost 6ms per sub-step. With the factory's
    // jitter the cap lands between 28 and 52.
    maxTowers: 40,
    buildTempo: { base: 1, perWave: 1.75 },
  },
};

