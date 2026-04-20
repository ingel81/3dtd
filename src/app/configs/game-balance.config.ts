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
    startCredits: 50, // Rebalanced: was 70 (1 Archer + reserve)
  },

  /** Wave system */
  waves: {
    /** Credits awarded for completing a wave */
    completionBonus: 35, // Rebalanced: was 50 (kill rewards more relevant)
  },

  /** Combat values */
  combat: {
    /** Damage dealt to base when enemy reaches HQ */
    enemyBaseDamage: 1,
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
  },

  /** Fire behavior thresholds */
  fire: {
    /** HP threshold - above this: brief flash, below: permanent fire */
    permanentThreshold: 50,
  },

  /**
   * Economy: Kill-Rewards + Wave-Completion-Bonuses
   * Gemaess MASTER_GAME_DESIGN.md Sektion 5
   */
  economy: {
    // ==================== Kill-Reward-Faktoren (5.1) ====================
    /** BaseHP = max(1, HP / baseHpDivisor) */
    baseHpDivisor: 40,
    /** SpeedFactor = speedFactorBase + (Speed/10) * speedFactorSlope */
    speedFactorBase: 0.9,
    speedFactorSlope: 0.35,
    /** ArmorFactor: Multiplier pro Ruestungstyp */
    armorFactor: {
      unarmored: 1.00,
      light: 1.08,
      heavy: 1.18,
      fortified: 1.30,
      ethereal: 1.25,
    },
    /** AirFactor: Flieger geben mehr Credits (taktisch wertvoller) */
    airFactor: 1.12,
    /** Boss-Multiplier (erkannt via EnemyTypeConfig.bossName) */
    bossFactor: 1.30,
    /** Elite-Multiplier (erkannt via EnemyTypeConfig.isElite) */
    eliteFactor: 1.10,
    /**
     * WaveFactor: 1.0 + waveFactorPerWave * (wave - 1) — Anti-Snowball.
     * Softened 0.02 → 0.01: even after swarm-discount the bot reached 500k
     * credits at Wave 81. Halving the per-wave scaling tames late-game spiral.
     * Wave 80 multiplier now 1.79 (was 2.58).
     */
    waveFactorPerWave: 0.01,
    /**
     * Swarm-Discount: pro-Kill-Credits skalieren invers mit Wave-Count via
     * sqrt(threshold / count). Bis 50 Enemies keine Reduktion; darüber
     * sinken Credits pro Kill. Verhindert dass AI-generierte Mega-Swarms
     * (500-2000 Enemies) den Bot mit hunderttausenden Credits fluten.
     *  count=50  → 1.00×
     *  count=200 → 0.50×
     *  count=940 → 0.23×
     *  count=2000 → 0.16×
     * Wave-Completion-Bonus (siehe unten) bleibt unberührt — lineares
     * Wachstum mit Wave-Nr dort belohnt das Überleben, nicht die Swarms.
     */
    swarmDiscountThreshold: 50,

    // ==================== Wave-Completion-Rewards (5.2) ====================
    /**
     * WaveCompleteBase = waveCompleteBase + round(waveCompleteSlope * wave)
     * Slope 2.6 → 1.5: Wave 80 completion bonus 226 → 138. Reduces the
     * straight-up linear income from just surviving waves at high wave_num.
     */
    waveCompleteBase: 18,
    waveCompleteSlope: 1.5,
    /** PerfectBonus: +35% wenn 0 HP-Verlust in Wave */
    perfectBonusRatio: 0.35,
    /** CloseCallBonus: +12% wenn HP <= closeCallHpThreshold am Wave-Ende */
    closeCallBonusRatio: 0.12,
    closeCallHpThreshold: 25,
    /** Milestone-Bonuses bei festen Waves */
    milestoneBonuses: { 10: 45, 20: 80, 30: 120, 40: 170 } as Record<number, number>,

    // ==================== Anti-Snowball (5.4) ====================
    /** Max Combo-Bonus (aufeinanderfolgende Perfect-Waves) */
    comboBonusMax: 0.30,
    /** Combo-Bonus pro aufeinanderfolgender Perfect-Wave */
    comboBonusPerStreak: 0.05,
    /** Comeback-Bonus: min(cap, HP_Lost * slope) */
    comebackBonusCap: 15,
    comebackBonusSlope: 0.3,
  },
} as const;

/** ArmorType-Keys fuer Typ-Sicherheit bei economy.armorFactor-Zugriff */
export type ArmorFactorKey = keyof typeof GAME_BALANCE.economy.armorFactor;

/** Type for accessing game balance config values */
export type GameBalanceConfig = typeof GAME_BALANCE;
