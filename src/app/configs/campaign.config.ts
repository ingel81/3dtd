/**
 * Campaign gold: the deterministic gold budget of every wave (Phase 5.16).
 *
 * Each entry of waves 1 to 30 is the wave's kill credits and completion bonus,
 * decoupled from how big or tough the wave turns out, so cumulative income is
 * predictable and tower and research costs can be planned wave by wave. Past
 * wave 30 the budget tapers to a sustain level (waveGold). What a wave brings
 * is the wave source's business (director/sources/), not this file's.
 *
 * Also the leak step the table source plays (enemyBaseDamageForWave).
 */

import { DetMath } from '../utils/det-math';

export interface CampaignWave {
  /** Total kill-credits awarded across the whole wave (split per enemy). */
  killGold: number;
  /** Base wave-completion bonus (skill bonuses stack on top). */
  completionGold: number;
}

/**
 * Gold per wave, 1-indexed: CAMPAIGN[0] = wave 1. The trailing comments name
 * what the wave was when the budget was set.
 * After the last entry the gold budget tapers (waveGold).
 */
export const CAMPAIGN: readonly CampaignWave[] = [
  // Rebalanced baseline derived from a Wave-Planner W30-target run:
  // every tower 1× (archer ×3), all upgrade tracks at L20, every research
  // done, RC Lv 3: the cumulative cost of that endgame state is the income
  // budget this campaign funds. Smoothed monotonic growth (~25-40%/wave)
  // with deliberate boss bonuses at W10/W20/W30.
  // Buffer over that roster: 25% when it was set, 83% since the upgrade
  // curves turned degressive and range stopped at L10 (roster 632,834 ->
  // 431,542 gold, see economy-chart.html), 69% since the chaos tower joined
  // the roster (468,702). Deliberately not retuned before a playtest, see
  // BALANCE_PROPOSAL_2026-09 §2.5.
  { killGold:   133, completionGold:    67 }, //  1: unarmored intro (200 baseline; ~250 with combo)
  { killGold:   267, completionGold:   133 }, //  2: swarm test (400; funds gatling-tech)
  { killGold:   333, completionGold:   167 }, //  3: speed mix (500; covers W4 build phase)
  { killGold:   367, completionGold:   183 }, //  4: light armor intro (550; ice-magic research)
  { killGold:   433, completionGold:   217 }, //  5: light tank-y (650)
  { killGold:   467, completionGold:   233 }, //  6: light swarm (700)
  { killGold:   533, completionGold:   267 }, //  7: AIR debut (800)
  { killGold:   600, completionGold:   300 }, //  8: more air (900)
  { killGold:   733, completionGold:   367 }, //  9: heavy intro (1100)
  { killGold:   933, completionGold:   467 }, // 10: BOSS 1 (1400; reduced bonus peak)
  { killGold:  1200, completionGold:   600 }, // 11: heavy fast
  { killGold:  1667, completionGold:   833 }, // 12: flying heavy
  { killGold:  2000, completionGold:  1000 }, // 13: ETHEREAL intro
  { killGold:  2333, completionGold:  1167 }, // 14: fortified DPS-check
  { killGold:  3000, completionGold:  1500 }, // 15: fortified DPS check (Stone Golem squad)
  { killGold:  3667, completionGold:  1833 }, // 16: multi-armor + air
  { killGold:  4667, completionGold:  2333 }, // 17: ethereal swarm
  { killGold:  6000, completionGold:  3000 }, // 18: multi-armor mix
  { killGold:  8000, completionGold:  4000 }, // 19: mega-swarm checkpoint (skeletons, was a second rat_tide)
  { killGold: 12000, completionGold:  6000 }, // 20: BOSS 2, bonus peak
  // W21-30 grow by x1.1 a wave from W20's 12,000 (2026-10-02), no peak at
  // W30. At x1.2 (User, 2026-09-23) a human run banked 46,000 to 147,000
  // over W23-W34 and had every research by W26; at about x1.3 a player sat
  // on 350,000 unspent gold by W28.
  { killGold:  13200, completionGold:   6600 }, // 21: air pressure
  { killGold:  14500, completionGold:   7250 }, // 22: heavy pressure
  { killGold:  16000, completionGold:   8000 }, // 23: breather: mass, no counter needed
  { killGold:  17600, completionGold:   8800 }, // 24: ethereal pressure
  { killGold:  19300, completionGold:   9650 }, // 25: fortified pressure
  { killGold:  21300, completionGold:  10650 }, // 26: breather: mass, no counter needed
  { killGold:  23400, completionGold:  11700 }, // 27: flying-heavy pressure
  { killGold:  25700, completionGold:  12850 }, // 28: heavy mass
  { killGold:  28300, completionGold:  14150 }, // 29: final mix
  { killGold:  31100, completionGold:  15550 }, // 30: BOSS 3, on the line since 2026-10-02
] as const;

/**
 * Per-leak HP-damage to player base scales with wave number, in steps: the
 * table source plays it (the budget source grows it with its curve instead,
 * sources/budget/run-plan.ts).
 *
 *  W1-30   → 1
 *  W31-60  → 2
 *  W61-90  → 3
 *  ...
 *
 * Seit dem 2026-09-21 je 30 Wellen statt je 10. Der Grund ist die Auflösung,
 * nicht die Härte: Die HP fallen über einen Lauf, während der Leck-Schaden
 * stieg, und bei Welle 40 kostete ein einziger Durchbruch rund 17 % der
 * Rest-HP. Damit war die Schwierigkeit nicht mehr steuerbar, weil zwischen
 * "kostet nichts" und "kostet ein Sechstel" nichts lag. Dass späte Wellen
 * härter sind, trägt jetzt die Spannungskurve des Druck-Reglers über die
 * Wellengröße (docs/DRAMA_CONTROLLER_PLAN.md).
 */
export function enemyBaseDamageForWave(waveNum: number): number {
  return 1 + Math.floor(Math.max(0, waveNum - 1) / 30);
}

/**
 * How fast income decays once the authored build-up is over.
 *
 * Applied per wave past the campaign, down to GOLD_SUSTAIN_FRACTION.
 */
// 0.9 since 2026-10-02, 0.85 since 2026-09-23, before 0.5. Halving per wave
// took a human run from 99,600 gold at W31 to 25,650 at W33 while the waves
// kept growing. At 0.85 with the 5 % floor a human run earned about 6,000 a
// wave from W45 on, less than one upgrade past L20, and could not close the
// gaps the air of W58 and the wraiths of W52 found.
const GOLD_TAPER_PER_WAVE = 0.9;

/**
 * Floor on post-campaign income, as a fraction of the last authored wave.
 *
 * 0.3 since 2026-10-02 (before 0.05): the late game keeps about 14,000 a wave
 * at strength 1, one or two upgrades past L20 or a new tower brought to L15,
 * so a gap a late wave finds can still be closed. The campaign pays about
 * 390,000 over W1-W30 (before 650,000), the plan about 975,000 by W60
 * (before 1.28M); docs/WAVE_RUN_PLAN.md, section 16.
 */
const GOLD_SUSTAIN_FRACTION = 0.3;

/**
 * Boss waves past the campaign pay this multiple of the tapered budget.
 * Inside the campaign the boss bonus is authored into CAMPAIGN; which wave is
 * a boss wave is the wave source's to say.
 */
const BOSS_GOLD_MULTIPLIER = 2;

/**
 * Deterministic gold budget for `waveNum` (1-indexed). Within the explicit
 * campaign (waves 1-30) the values are read directly.
 *
 * Past wave 30 income TAPERS to a sustain level. It used to loop over the
 * campaign, which had two consequences, both bad. Wave 31 dropped from
 * 180,000 gold to 200 and then climbed all over again, incoherent for a player
 * mid-run. And across 100 waves the loop paid out 2.64M against a design roster
 * costing 1.39M, so a defense could reach full build-out and keep going: the
 * training bot ended up at ~6700 DPS covering the whole route, killing 100% of
 * every wave from wave 11 on, which left the wave director nothing to aim at.
 *
 * Tapering instead keeps the curve monotone and lands the 100-wave total near
 * 1.5M: the roster plus a working reserve. Economic pressure survives into the
 * late game, which is where the genre's actual tension lives.
 *
 * Boss waves past the campaign pay double; the wave source says which ones
 * are (`WaveRules.isBoss`).
 */
/**
 * Share of the last authored wave's gold that wave `waveNum` past the
 * campaign pays, before any boss bonus: the taper down to the sustain floor.
 */
export function goldTaper(waveNum: number): number {
  return Math.max(GOLD_SUSTAIN_FRACTION, DetMath.pow(GOLD_TAPER_PER_WAVE, waveNum - CAMPAIGN.length));
}

export function waveGold(
  waveNum: number,
  boss: boolean,
): { kill: number; complete: number } {
  if (waveNum < 1) return { kill: 0, complete: 0 };
  const len = CAMPAIGN.length;
  if (waveNum <= len) {
    const e = CAMPAIGN[waveNum - 1];
    return { kill: e.killGold, complete: e.completionGold };
  }
  const last = CAMPAIGN[len - 1];
  const scale = goldTaper(waveNum) * (boss ? BOSS_GOLD_MULTIPLIER : 1);
  return {
    kill: Math.round(last.killGold * scale),
    complete: Math.round(last.completionGold * scale),
  };
}
