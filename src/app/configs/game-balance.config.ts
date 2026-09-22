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
    /**
     * Das HP-Budget eines ganzen Laufs, gemessen in Lecks.
     *
     * 500 seit dem 2026-09-21, vorher 100. Der Wert ist keine Geschmacksfrage,
     * sondern die Auflösung, mit der die Schwierigkeit überhaupt geregelt
     * werden kann: Bei 100 HP und 1 bis 4 HP je durchgekommenem Gegner hatte
     * ein Lauf rund 40 Lecks, auf 80 Wellen also ein halbes Leck je Welle. In
     * jeder zweiten Welle durfte damit gar nichts durchkommen, und genau das
     * ist die tote Welle, die der Druck-Regler vermeiden soll. Mit 500 sind es
     * gut 300 Lecks, also drei bis vier je Welle: fein genug, dass ein
     * einzelner Durchbruch eine Welle spannend macht statt sie zu entscheiden.
     *
     * Alles, was HP liest, rechnet in Anteilen (Close Call bei 30 %, der
     * Leck-Spielraum des Deckels, der Regler selbst), also ändert die Zahl
     * nichts außer der Auflösung. Details in docs/DRAMA_CONTROLLER_PLAN.md.
     */
    startHealth: 500,
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
    /**
     * Was eine Welle über ihr Budget hinaus einbringt, und wofür.
     *
     * Am 2026-09-22 umgedreht. Gemessen über 16471 Wellen der alten Baseline
     * ging der Bonus zu 19,5 % an `perfect` und zu 0,86 % an `closeCall`: Das
     * Spiel belohnte mit Abstand am stärksten die Welle, in der gar nichts
     * passiert — also genau das, was der Druck-Regler verhindern soll
     * (docs/DRAMA_CONTROLLER_PLAN.md). Die knapp überstandene Welle, das
     * eigentliche Erlebnis, brachte nichts.
     *
     * Perfekt gespielt bleibt belohnt, nur nicht mehr am stärksten. Der
     * knappe Sieg zahlt jetzt mehr, und das wirkt zugleich als Ausgleich:
     * Wer angeschlagen aus einer Welle kommt, bekommt die Mittel, sich zu
     * erholen, statt in eine Abwärtsspirale zu geraten.
     */
    /**
     * Die Sätze sind so gewählt, dass die **Summe** ungefähr bleibt und sich
     * nur ihre Verteilung dreht. Der erste Anlauf senkte Perfect von 0,35 auf
     * 0,2, ohne das gegenzurechnen: Der Bonusanteil am Wellengold fiel von
     * 32 % auf 20 %, und mit dem fehlenden Gold fiel die mediane Runlänge von
     * 47 auf 32. Weniger Gold ist ein härteres Spiel, aber es war nicht die
     * Absicht — die Absicht war, wofür gezahlt wird.
     *
     * Bei rund der Hälfte perfekter und einem Zehntel knapper Wellen hält
     * `0,5 × 0,27 + 0,1 × 0,55` ungefähr das alte `0,5 × 0,35 + 0,1 × 0,12`,
     * und der knappe Sieg zahlt das Doppelte des perfekten.
     */
    /** PerfectBonus: on the wave's completion budget when 0 HP lost */
    perfectBonusRatio: 0.27,
    /** CloseCallBonus: when the wave ended below `closeCallHpShare` of max HP */
    closeCallBonusRatio: 0.55,
    /**
     * Anteil der Start-HP, unter dem eine Welle als knapp gilt.
     *
     * Ein Anteil und keine HP-Zahl. Die alte `25` wurde an zwei Stellen mit
     * verschiedenen Einheiten gelesen: im GameStore gegen `healthPercent()`
     * (also als 25 %), im WaveManager gegen den HP-Stand (also als 25 HP).
     * Bei 100 Start-HP war das zufällig dasselbe. Beim Wechsel auf 500 fielen
     * beide auseinander — der Store meldete "kritisch" ab 125 HP, der Bonus
     * zahlte erst ab 25 — und der Bonus fiel von 0,86 % auf 0,11 % des
     * Wellengolds, ohne dass es jemand beschlossen hätte.
     */
    closeCallHpShare: 0.25,
    /** Flat milestone bonuses awarded on top at fixed waves */
    milestoneBonuses: { 10: 45, 20: 80, 30: 120, 40: 170 } as Record<number, number>,
    /** Max combo bonus (consecutive perfect waves) — multiplier on completion budget */
    comboBonusMax: 0.30,
    /** Combo bonus added per consecutive perfect wave */
    comboBonusPerStreak: 0.05,
    /**
     * Comeback: ein Trostpreis, der mit dem verlorenen Anteil der HP wächst.
     *
     * Beides als Anteil des Wellenbudgets. Vorher ein fester Deckel von 15
     * Gold gegen Budgets in Zehntausenden, also 0,02 % des Wellengolds und
     * damit ohne jede Wirkung.
     */
    comebackBonusCap: 0.3,
    comebackBonusSlope: 1.2,
  },
} as const;

/**
 * Der HP-Stand, unter dem eine Welle als knapp überstanden gilt.
 *
 * Eine Funktion und keine Konstante, damit die Schwelle den Start-HP folgt.
 * Beide Leser — der GameStore für seine Kritisch-Anzeige und der WaveManager
 * für den Bonus — rechnen sie hierüber aus, sonst driften sie auseinander,
 * sobald jemand `startHealth` anfasst. Genau das ist am 2026-09-22 passiert.
 */
export function closeCallHp(): number {
  return GAME_BALANCE.player.startHealth * GAME_BALANCE.economy.closeCallHpShare;
}
