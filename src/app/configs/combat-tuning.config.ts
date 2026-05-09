/**
 * Combat-Tuning-Konstanten
 *
 * Zentralisiert die Magic-Numbers, die früher als Inline-Werte in
 * tower-combat.service, enemy.manager und tower.entity verstreut waren.
 * Game-Balancing wird so an einer Stelle änderbar, ohne den Code anfassen
 * zu müssen.
 */
export const COMBAT_TUNING = {
  /** Wie lange ein Tower ohne Ziel wartet, bevor er „schläft" (Spatial-Grid-Wake-Path). [ms] */
  towerSleepDelayMs: 2000,

  /** Mindestabstand zwischen zwei Sleep-Wake-Checks pro Tower. [ms] */
  towerSleepCheckIntervalMs: 500,

  /** Sicherheits-Margin auf den Tower-Range, um knapp eintreffende Enemies früher zu „sehen". */
  rangeMargin: {
    /** Standard-Margin für Projektil-/Hitscan-Kandidatenfilter. */
    standard: 1.1,
    /** Erweiterte Margin für Beam-Tower (Beam-Spread). */
    beam: 1.2,
  },

  /** Mindestabstand zwischen zwei Blood-Effekten pro durchgängigem Beam-Tick. [ms] */
  beamBloodEffectIntervalMs: 200,

  /** Tick-Intervall für Poison-DOT pro betroffenem Enemy. [ms] */
  poisonTickIntervalMs: 500,
} as const;
