/**
 * Game Balance Configuration
 *
 * Player-facing tuning values that don't belong to a specific entity config.
 * Per-wave gold budgets live in src/app/configs/campaign.config.ts so
 * they stay co-located with the wave content design.
 */

export const GAME_BALANCE = {
  /** Player starting values */
  player: {
    startHealth: 100,
    startCredits: 100, // Phase 5.16 playtest: enough for 2× Archer or 1× Research-Center + 25 reserve
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
    /** Poison Tower DOT effect */
    poison: {
      /** Damage per second */
      dotDamagePerSecond: 8,
      /** Duration in milliseconds */
      duration: 4000,
    },
    /**
     * Fire Tower burn DOT. The beam keeps its total damagePerSecond: this
     * share of it is dealt as burn instead of directly, so an enemy in the
     * cone takes the same damage as before and keeps burning after it leaves.
     */
    burn: {
      /** Share of the beam's effective DPS that becomes burn DPS */
      beamDpsShare: 0.2,
      /** Duration in milliseconds, refreshed while the enemy is in the cone */
      duration: 3000,
    },
  },

  /** Fire behavior thresholds */
  fire: {
    /** HP threshold - above this: brief flash, below: permanent fire */
    permanentThreshold: 50,
  },

  /**
   * Wave-completion skill bonuses (Phase 5.16). Stack on top of the
   * deterministic per-wave completion budget defined in campaign.config.ts.
   */
  economy: {
    /** PerfectBonus: +35% on the wave's completion budget when 0 HP lost */
    perfectBonusRatio: 0.35,
    /** CloseCallBonus: +12% when HP <= closeCallHpThreshold at wave end */
    closeCallBonusRatio: 0.12,
    closeCallHpThreshold: 25,
    /** Flat milestone bonuses awarded on top at fixed waves */
    milestoneBonuses: { 10: 45, 20: 80, 30: 120, 40: 170 } as Record<number, number>,
    /** Max combo bonus (consecutive perfect waves) — multiplier on completion budget */
    comboBonusMax: 0.30,
    /** Combo bonus added per consecutive perfect wave */
    comboBonusPerStreak: 0.05,
    /** Comeback bonus: min(cap, HP_Lost * slope) — small consolation when damage taken */
    comebackBonusCap: 15,
    comebackBonusSlope: 0.3,
  },
} as const;
