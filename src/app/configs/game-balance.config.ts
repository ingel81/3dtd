/**
 * Game Balance Configuration
 *
 * Centralized game balance values for easy tuning.
 * Previously hardcoded in game-state.manager.ts
 */

export const GAME_BALANCE = {
  /** Player starting values */
  player: {
    startHealth: 100,
    startCredits: 70,
  },

  /** Wave system */
  waves: {
    /** Credits awarded for completing a wave */
    completionBonus: 50,
  },

  /** Combat values */
  combat: {
    /** Damage dealt to base when enemy reaches HQ */
    enemyBaseDamage: 10,
  },

  /** Status effects */
  effects: {
    /** Ice Tower slow effect */
    ice: {
      /** Speed reduction (0.5 = 50% slower) */
      slowAmount: 0.5,
      /** Duration in milliseconds */
      duration: 3000,
    },
  },

  /** Fire behavior thresholds */
  fire: {
    /** HP threshold - above this: brief flash, below: permanent fire */
    permanentThreshold: 50,
  },
} as const;

/** Type for accessing game balance config values */
export type GameBalanceConfig = typeof GAME_BALANCE;
