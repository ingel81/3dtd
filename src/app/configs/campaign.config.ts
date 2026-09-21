/**
 * Campaign — designer-curated wave sequence + gold budget (Phase 5.16).
 *
 * Each entry pins a template (content/pacing) AND a deterministic gold budget
 * (kill-credits + completion-bonus) for that wave. The director's factors
 * (count, spawn delay, hp multiplier, variation) still tune *difficulty* — but
 * the player's income per wave is decoupled from those factors entirely. This
 * is the foundation for tower/research-cost balancing: cumulative income is
 * predictable and progression can be planned wave-by-wave.
 *
 * After wave 30 the director picks the template (every fifth wave a boss, see
 * isBossWave) and the gold budget tapers to a sustain level (waveGold).
 */

import { TEMPLATES, type Template } from '../director/templates';

export interface CampaignWave {
  /** Template id forced by the campaign for this wave. */
  template: string;
  /** Total kill-credits awarded across the whole wave (split per enemy). */
  killGold: number;
  /** Base wave-completion bonus (skill bonuses stack on top). */
  completionGold: number;
  /**
   * How hard this wave leans on the player, as a factor on the enemy count.
   *
   * The wave director sizes every wave against the defense, so a template
   * alone cannot say "this one is meant to be easier": a wave that needs no
   * counter simply gets a bigger count. This is the campaign's own say in it
   * (decision D3, the room per campaign wave). 1 is the director's number.
   */
  intensity?: number;
}

/**
 * Hard sequence, 1-indexed: CAMPAIGN[0] = wave 1.
 * After the last entry the director picks the template (templateForWave
 * returns null) and the gold budget tapers (waveGold).
 */
export const CAMPAIGN: readonly CampaignWave[] = [
  // Rebalanced baseline derived from a Wave-Planner W30-target run:
  // every tower 1× (archer ×3), all upgrade tracks at L20, every research
  // done, RC Lv 3 — the cumulative cost of that endgame state is the income
  // budget this campaign funds. Smoothed monotonic growth (~25-40%/wave)
  // with deliberate boss bonuses at W10/W20/W30.
  // Buffer over that roster: 25% when it was set, 83% since the upgrade
  // curves turned degressive and range stopped at L10 (roster 632,834 ->
  // 431,542 gold, see economy-chart.html), 69% since the chaos tower joined
  // the roster (468,702). Deliberately not retuned before a playtest, see
  // BALANCE_PROPOSAL_2026-09 §2.5.
  { template: 'zombie_horde',     killGold:   133, completionGold:    67 }, //  1 — unarmored intro (200 baseline; ~250 with combo)
  { template: 'rat_tide',         killGold:   267, completionGold:   133 }, //  2 — swarm test (400; funds gatling-tech)
  { template: 'penguin_rush',     killGold:   333, completionGold:   167 }, //  3 — speed mix (500; covers W4 build phase)
  { template: 'light_mix',        killGold:   367, completionGold:   183 }, //  4 — light armor intro (550; ice-magic research)
  { template: 'wallsmasher_crew', killGold:   433, completionGold:   217 }, //  5 — light tank-y (650)
  { template: 'spider_swarm',     killGold:   467, completionGold:   233 }, //  6 — light swarm (700)
  { template: 'bat_swarm',        killGold:   533, completionGold:   267 }, //  7 — AIR debut (800)
  { template: 'hornet_strike',    killGold:   600, completionGold:   300 }, //  8 — more air (900)
  { template: 'tank_column',      killGold:   733, completionGold:   367 }, //  9 — heavy intro (1100)
  { template: 'boss_herbert',     killGold:   933, completionGold:   467 }, // 10 — BOSS 1 (1400; reduced bonus peak)
  { template: 'bear_pack',        killGold:  1200, completionGold:   600 }, // 11 — heavy fast
  { template: 'dragon_elite',     killGold:  1667, completionGold:   833 }, // 12 — flying heavy
  { template: 'ghost_surge',      killGold:  2000, completionGold:  1000 }, // 13 — ETHEREAL intro
  { template: 'mammoth_siege',    killGold:  2333, completionGold:  1167 }, // 14 — fortified DPS-check
  { template: 'golem_squad',      killGold:  3000, completionGold:  1500 }, // 15 — fortified DPS check (Stone Golem squad)
  { template: 'chaos_wave',       killGold:  3667, completionGold:  1833 }, // 16 — multi-armor + air
  { template: 'wraith_storm',     killGold:  4667, completionGold:  2333 }, // 17 — ethereal swarm
  { template: 'armor_gauntlet',   killGold:  6000, completionGold:  3000 }, // 18 — multi-armor mix
  { template: 'skeleton_swarm',   killGold:  8000, completionGold:  4000 }, // 19: mega-swarm checkpoint (skeletons, was a second rat_tide)
  { template: 'boss_herbert',     killGold: 12000, completionGold:  6000 }, // 20 — BOSS 2 (bonus peak)
  // W21-29 used to be nine waves in a row that each demanded a different
  // counter, with no wave in between to build in. Measured over 107 expert
  // runs: 85% of them ended in waves 23 to 26, four of those nine. A missing
  // answer did not cost a wave, it cost the chain. Two waves that ask for
  // nothing but damage now sit between the specialists, and no two waves in a
  // row ask for the same thing (BALANCING_PLAN.md, Tuning-Runde 2).
  { template: 'bat_swarm',        killGold: 10667, completionGold:  5333 }, // 21 — air pressure
  { template: 'tank_column',      killGold: 14667, completionGold:  7333 }, // 22 — heavy pressure
  { template: 'spider_swarm',     killGold: 18667, completionGold:  9333 }, // 23 — breather: mass, no counter needed
  // The factors below are measured, not guessed: each round of 80+ expert runs
  // reads the HP a wave costs and what share of runs it ends, and moves the
  // wave that stands out. Nothing heals in this game, so the last ten waves
  // have to be survivable for a defense that arrives worn down.
  { template: 'ghost_surge',      killGold: 24000, completionGold: 12000, intensity: 0.85 }, // 24 — ethereal pressure
  { template: 'mammoth_siege',    killGold: 30000, completionGold: 15000, intensity: 0.75 }, // 25 — fortified pressure
  { template: 'zombie_horde',     killGold: 40000, completionGold: 20000, intensity: 0.5 },  // 26 — breather: mass, no counter needed
  { template: 'dragon_elite',     killGold: 53333, completionGold: 26667, intensity: 0.55 }, // 27 — flying-heavy pressure
  { template: 'mech_army',        killGold: 73333, completionGold: 36667 }, // 28 — heavy mass
  { template: 'chaos_wave',       killGold: 93333, completionGold: 46667 }, // 29 — final mix
  { template: 'boss_herbert',     killGold:120000, completionGold: 60000 }, // 30 — BOSS 3 (season finale, bonus peak)
] as const;

// Past W30 the campaign pins no template (templateForWave returns null,
// the director picks) and waveGold tapers the income to a sustain
// level. Neither a linear `+delta` extrapolation (half a million gold per wave)
// nor looping the W1-W30 budgets held up, see waveGold.

// =====================================================================
// Phase 5.16 Endgame Difficulty Knobs (P2)
// Structural difficulty scaling that compounds the NN's continuous factors.
// Both the existing checkpoint (no retraining) and a future fresh checkpoint
// will see steeper late-game without needing to learn it.
// =====================================================================

/**
 * Late-wave HP multiplier applied AFTER the NN's hp_mult — so a strong
 * checkpoint pushing 3× hp_mult at W30 effectively delivers 3× × 1.5× = 4.5×
 * once endgameHpMultiplier kicks in.
 *
 *  W1-19 → 1.00× (no change)
 *  W20   → 1.00× (start of ramp; +5%/wave from here)
 *  W30   → 1.50×
 *  W50   → 2.50×
 *  W80   → 4.00× (cap)
 */
export function endgameHpMultiplier(waveNum: number): number {
  if (waveNum <= 20) return 1.0;
  return Math.min(4.0, 1.0 + 0.05 * (waveNum - 20));
}

/**
 * Per-leak HP-damage to player base scales with wave number — late-game
 * leaks should hurt more so the player can't just tank a steady trickle.
 *
 *  W1-10  → 1
 *  W11-20 → 2
 *  W21-30 → 3
 *  W31-40 → 4
 *  ...
 */
export function enemyBaseDamageForWave(waveNum: number): number {
  if (waveNum < 11) return 1;
  return 1 + Math.floor((waveNum - 1) / 10);
}

/** Last wave the campaign pins a template to. Beyond this the AI chooses. */
export const CAMPAIGN_LENGTH = CAMPAIGN.length;

/**
 * Campaign-forced template id for `waveNum` (1-indexed), or null.
 *
 * Returns null past wave {@link CAMPAIGN_LENGTH}; from there
 * the Wave Director's template head chooses for itself under the normal
 * availability mask. The designer owns content and pacing through the scripted
 * run; the AI owns the open-ended tail.
 *
 * {@link waveGold} stays defined past this wave, but it tapers
 * rather than stopping.
 */
export function templateForWave(waveNum: number): string | null {
  if (waveNum < 1 || waveNum > CAMPAIGN_LENGTH) return null;
  return CAMPAIGN[waveNum - 1].template;
}

/**
 * The campaign's factor on the enemy count of this wave, 1 outside it.
 *
 * Bounded to 0.25 to 2: the campaign says how hard a wave leans, it does not
 * take the sizing away from the director.
 */
export function campaignIntensity(waveNum: number): number {
  if (waveNum < 1 || waveNum > CAMPAIGN_LENGTH) return 1;
  const intensity = CAMPAIGN[waveNum - 1].intensity ?? 1;
  return Math.min(2, Math.max(0.25, intensity));
}

/** Boss-Takt im Campaign (W10/W20/W30 sind dort gepinnt). */
export const BOSS_WAVE_INTERVAL = 10;
/** Boss-Takt danach, wenn der Director das Template wählt. */
export const BOSS_WAVE_INTERVAL_AFTER_CAMPAIGN = 5;

/**
 * Ist `waveNum` eine Boss-Welle? Bis W30 jede zehnte, danach jede fünfte.
 *
 * Past the campaign the template mask collapses onto the boss templates on
 * these waves (getAvailableTemplateMask). The mask used to merely ALLOW a boss
 * on `wave % 10 === 0`, and the stalest-template rule then tied it with about
 * fourteen other templates: simulated over 2,000 runs, W31-W130 produced 0.7
 * boss waves where ten were intended.
 *
 * Mirrored by `schema.is_boss_wave` in the bot server, which reads both
 * intervals from the generated schema.
 */
export function isBossWave(waveNum: number): boolean {
  if (waveNum < 1) return false;
  const interval = waveNum <= CAMPAIGN_LENGTH
    ? BOSS_WAVE_INTERVAL
    : BOSS_WAVE_INTERVAL_AFTER_CAMPAIGN;
  return waveNum % interval === 0;
}

/**
 * Lookup the full Template object for a wave (or null on bad waveNum/unknown id).
 */
export function templateObjectForWave(waveNum: number): Template | null {
  const id = templateForWave(waveNum);
  if (!id) return null;
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

/**
 * How fast income decays once the authored build-up is over.
 *
 * Applied per wave past the campaign, down to GOLD_SUSTAIN_FRACTION.
 */
const GOLD_TAPER_PER_WAVE = 0.5;

/**
 * Floor on post-campaign income, as a fraction of the last authored wave.
 *
 * Sized against what the run is supposed to buy. The design roster — one tower
 * of each type plus three archers, all upgrade tracks maxed, every research —
 * costs about 1.39M gold. The authored campaign pays 791k across its 30
 * waves, so the tail has to supply roughly 600k more over a long run and then
 * stop, rather than fund a second army.
 */
const GOLD_SUSTAIN_FRACTION = 0.05;

/**
 * Boss waves past the campaign pay this multiple of the tapered budget.
 * Inside the campaign the boss bonus is authored into CAMPAIGN.
 */
const BOSS_GOLD_MULTIPLIER = 2;

/**
 * Deterministic gold budget for `waveNum` (1-indexed). Within the explicit
 * campaign (waves 1-30) the values are read directly.
 *
 * Past wave 30 income TAPERS to a sustain level. It used to loop with
 * `templateForWave`, which had two consequences, both bad. Wave 31 dropped from
 * 180,000 gold to 200 and then climbed all over again — incoherent for a player
 * mid-run. And across 100 waves the loop paid out 2.64M against a design roster
 * costing 1.39M, so a defense could reach full build-out and keep going: the
 * training bot ended up at ~6700 DPS covering the whole route, killing 100% of
 * every wave from wave 11 on, which left the wave director nothing to aim at.
 *
 * Tapering instead keeps the curve monotone and lands the 100-wave total near
 * 1.5M — the roster plus a working reserve. Economic pressure survives into the
 * late game, which is where the genre's actual tension lives.
 *
 * (Endgame difficulty still compounds via `endgameHpMultiplier`, not via gold.)
 *
 * Boss waves past the campaign (every fifth, see isBossWave) pay double.
 */
export function waveGold(
  waveNum: number,
): { kill: number; complete: number } {
  if (waveNum < 1) return { kill: 0, complete: 0 };
  const len = CAMPAIGN.length;
  if (waveNum <= len) {
    const e = CAMPAIGN[waveNum - 1];
    return { kill: e.killGold, complete: e.completionGold };
  }
  const last = CAMPAIGN[len - 1];
  const scale = Math.max(
    GOLD_SUSTAIN_FRACTION,
    Math.pow(GOLD_TAPER_PER_WAVE, waveNum - len),
  ) * (isBossWave(waveNum) ? BOSS_GOLD_MULTIPLIER : 1);
  return {
    kill: Math.round(last.killGold * scale),
    complete: Math.round(last.completionGold * scale),
  };
}
