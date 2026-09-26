/**
 * How the adaptive source sizes a wave.
 *
 * The survivability cap, the DPS ramp and the range interpolation: everything
 * that turns a template's designer ranges plus four factors into concrete
 * numbers. It belongs to this source alone, which is why it sits here and not
 * with the template data (docs/WAVE_SOURCE_PLAN.md, section 4).
 */

import { type ArmorType } from '../../../configs/combat/combat.types';
import { type NumberRange, type Template } from '../../templates';
import { directorParams } from '../../director-params';
import { type GameStateSnapshot } from '../../models/game-state-snapshot';

/** DPS-scaled range caps (Phase 5.11b). Mirrored into the generated schema. */
export const DPS_RAMP_FLOOR = 0.10;
export const DPS_RAMP_COUNT = 500.0;
export const DPS_RAMP_HP_MULT = 1000.0;

/**
 * Fairness gate — how much damage a wave is allowed to be worth.
 *
 * The gate used to cap the count at what the defense could theoretically kill,
 * plus 25% headroom. Measured against 15k waves, that model was wrong exactly
 * where it mattered: defenses actually killed 64% of what it predicted through
 * waves 1-10, and 100% from wave 11 on. So in the only phase where the player
 * has no HP buffer, the gate permitted roughly twice what the towers could
 * handle — 42 rats in wave 2 against a defense that kills 27, i.e. 15 HP gone
 * in one early wave. 85% of all runs ended between waves 6 and 10.
 *
 * It now caps on the thing that actually ends runs: expected LEAK DAMAGE. Take
 * what the defense can realistically kill, then allow enough overshoot that the
 * expected leaks cost at most a slice of the player's remaining HP. The
 * overshoot is still what produces drama — it is just priced in HP now rather
 * than assumed away.
 *
 * Still a floor on fairness, not the difficulty knob: on a strong defense the
 * kill term dominates and the gate does not bind.
 */

/**
 * Fraction of the DPS model's prediction a defense actually achieves.
 *
 * Measured kill share (killed / sent) over 15k waves: 0.64 in waves 1-10, 1.00
 * from wave 11. The model overestimates because it assumes every point of DPS
 * lands on a live target — no reload gaps, no travel time, no overkill on the
 * last hit of a swarm, no enemy slipping between two towers' radii.
 */
export const FAIRNESS_KILL_REALISM = 0.65;

/**
 * Der Anteil der Rest-HP, den eine Welle kosten darf, kommt seit 2026-09-21
 * aus `targetPressure(wave)` (pressure-controller.ts) und ist damit dieselbe
 * Zahl, auf die der Druck-Regler regelt.
 *
 * Vorher standen hier feste 6 %, während der Regler auf ein Leck-Band zielte,
 * das damit nichts zu tun hatte: zwei Sollwerte, die gegeneinander arbeiteten.
 * Der Bezug auf die Rest-HP statt auf das Maximum bleibt, denn er lässt den
 * Deckel mit dem Lauf enger werden und überlebt Heilung.
 */

/** ...but always at least this much, so a wave is never a guaranteed shutout. */
export const FAIRNESS_MIN_LEAK_HP = 1.0;

/**
 * How far along the path a defense can engage, in metres.
 *
 * Combined with enemy speed this gives the seconds each enemy actually spends
 * under fire — which is the real limit, not the length of the wave. A flat
 * 30-second allowance assumed the towers keep shooting long after the last
 * spawn, but the enemies do not wait around: a rat at 10 m/s is inside a 40 m
 * engagement envelope for four seconds and then it is at the base. That
 * mistake let 217 rats through a gate that thought they were clearable.
 *
 * Deliberately larger than a single tower's radius, since a defense is spread
 * along the route and an enemy passes several.
 */
export const FAIRNESS_ENGAGEMENT_REACH_M = 60;

/** Clamp on the derived engagement window, so extreme speeds stay sane. */
export const FAIRNESS_ENGAGEMENT_MIN_S = 2;
export const FAIRNESS_ENGAGEMENT_MAX_S = 40;

/**
 * The gate never clamps below this; a wave of one enemy is not a wave.
 *
 * Bewusst eine kleine Konstante und **nicht** an die Template-Untergrenze
 * gekoppelt. Am 2026-09-21 einmal auf die halbe Untergrenze angehoben, weil
 * der alte Leck-Regler unter fünf Gegnern blind wurde: Welle 2 spawnte
 * daraufhin 75 statt 30 Gegner und kostete 45 % der HP, die mediane Runlänge
 * des Könners fiel von 25 auf 9. Der Deckel ist die einzige Bremse gegen eine
 * Welle, die eine junge Verteidigung nicht halten kann, und ein Boden darüber
 * hebelt genau sie aus.
 *
 * Der Druck-Regler braucht den Boden ohnehin nicht: anders als die Leck-Quote
 * ist der HP-Anteil auch bei sieben Gegnern stetig, weil jeder Gegnertyp
 * anderen Leck-Schaden macht (docs/DRAMA_CONTROLLER_PLAN.md).
 */
export const FAIRNESS_MIN_COUNT = 5;


/**
 * Largest enemy count the defense can plausibly fight, or null if unbounded.
 *
 * Mirrors `schema.fair_max_count` in the bot server — inference has to
 * apply the same gate the net was trained under, or the shipped game hands out
 * waves the training run never produced.
 *
 * Uses armor-weighted DPS rather than raw DPS: an archer counts fully against
 * unarmored and barely at all (0.1x) against ethereal, and a wave of wraiths has
 * to be judged by the latter. Callers pass `gateDpsPerArmor`, where bad ground
 * matchups are floored at FAIRNESS_MATCHUP_FLOOR. Ground and air are read
 * separately so a defense that cannot shoot upward gets no credit for a bat
 * swarm.
 *
 * Closed form, since the wave's duration depends on the count itself:
 *
 *     killable = dps * (count * delaySeconds + ENGAGEMENT) * KILL_REALISM
 *     allowed  = killable + (leak HP budget / damage per leak / leaks per enemy)
 *
 * A non-positive denominator means the defense out-damages the spawn rate, so
 * nothing needs capping.
 */
export function survivableCount(
  template: Template,
  hpMult: number,
  spawnDelayMs: number,
  effectiveDps: { ground?: Record<string, number>; air?: Record<string, number> } | undefined,
  killThroughput: { ground: number; air: number } | undefined,
  enemyArmor: (enemyId: string) => ArmorType,
  enemyIsAir: (enemyId: string) => boolean,
  /** HP to clear one enemy, everything it splits into included (lineageHp). */
  enemyBaseHp: (enemyId: string) => number,
  enemyBaseSpeed: (enemyId: string) => number,
  /** Kills one enemy takes: itself and everything it splits into (splitBodyCount). */
  enemyBodies: (enemyId: string) => number,
  /** Most leaks one enemy can cost: the ends of its split tree (splitLeafCount). */
  enemyMaxLeaks: (enemyId: string) => number,
  /** Player HP still on the clock, in HP points (not a fraction). */
  hpRemaining: number,
  /** HP the player loses per enemy that reaches the base, at this wave. */
  leakDamage: number,
  /**
   * Closed-loop correction on the kill estimate, from
   * {@link PressureController}.
   *
   * FAIRNESS_KILL_REALISM was measured on waves 1-10, where defenses achieve
   * about 65% of what the DPS model predicts; from wave 11 they achieve
   * essentially all of it. A single static discount therefore understates the
   * defense for most of a run, and the cap lands on "exactly what the towers
   * can kill" — which guarantees the towers kill it. Measured over 1834 waves
   * with no correction: 70% of waves killed everything and 80% dealt no damage
   * at all, and four wave designers as different as a policy network and a
   * uniform random sampler produced statistically identical runs, because the
   * cap and not the designer was choosing the wave size.
   */
  pressureMultiplier = 1,
  /**
   * Anteil der Rest-HP, den diese Welle kosten soll: `targetPressure(wave)`.
   *
   * Derselbe Sollwert, auf den der Druck-Regler regelt. Der Deckel gibt
   * genau so viel Leck frei, wie die Spannungskurve für diese Welle vorsieht.
   */
  targetPressure = 0.06,
): number | null {
  const ground = effectiveDps?.ground ?? {};
  const air = effectiveDps?.air ?? {};

  let totalShare = 0;
  let weightedDps = 0;
  let weightedHp = 0;
  let weightedThroughput = 0;
  let weightedSpeed = 0;
  let weightedBodies = 0;
  let weightedLeaks = 0;
  for (const [enemy, share] of template.enemies) {
    if (share <= 0) continue;
    const isAir = enemyIsAir(enemy);
    const dpsSource = isAir ? air : ground;
    weightedDps += share * (dpsSource[enemyArmor(enemy)] ?? 0);
    weightedThroughput += share * (isAir ? (killThroughput?.air ?? 0) : (killThroughput?.ground ?? 0));
    weightedHp += share * enemyBaseHp(enemy) * hpMult;
    weightedSpeed += share * Math.max(0.1, enemyBaseSpeed(enemy));
    weightedBodies += share * Math.max(1, enemyBodies(enemy));
    weightedLeaks += share * Math.max(1, enemyMaxLeaks(enemy));
    totalShare += share;
  }
  if (totalShare <= 0) return null;

  const dps = weightedDps / totalShare;
  const hpPerEnemy = weightedHp / totalShare;
  const throughput = weightedThroughput / totalShare;
  const bodiesPerEnemy = weightedBodies / totalShare;
  const leaksPerEnemy = weightedLeaks / totalShare;
  // No effective damage against this wave at all — a campaign-pinned air wave
  // against a ground-only defense, say, since forcing bypasses the capability
  // mask. Every enemy will leak and leak damage scales with the count, so the
  // smallest legal wave is the right answer, not an uncapped one.
  if (dps <= 0 || hpPerEnemy <= 0) return FAIRNESS_MIN_COUNT;

  // Kills per second, not damage per second.
  //
  // Damage alone said a defense doing 76 DPS could clear 848 rats of 3.4 HP —
  // twice over. It could not: a tower engages one target per shot and throws
  // away the surplus, so two archers kill two rats a second regardless of how
  // much damage each shot carries. Against tanky enemies the damage term binds
  // instead, and throughput is irrelevant. Whichever is scarcer wins.
  //
  // An enemy that splits counts with its children: its HP is the lineage's
  // and every body takes a kill, so a kill clears 1/bodies of such an enemy.
  const dpsLimited = dps / hpPerEnemy;
  const killsPerSecond = throughput > 0 ? Math.min(dpsLimited, throughput / bodiesPerEnemy) : dpsLimited;
  if (killsPerSecond <= 0) return null;

  // Closed form, since the wave's duration depends on the count:
  //   killable = killsPerSecond * (count * delaySeconds + ENGAGEMENT) * REALISM
  // Seconds an enemy spends under fire, from its own speed. Fast swarms give
  // the defense far less time than the wave's nominal duration suggests.
  const speed = weightedSpeed / totalShare;
  const engagementSeconds = Math.min(
    FAIRNESS_ENGAGEMENT_MAX_S,
    Math.max(FAIRNESS_ENGAGEMENT_MIN_S, FAIRNESS_ENGAGEMENT_REACH_M / speed),
  );

  // What the model says is killable, discounted by what defenses actually
  // manage. Without the discount the gate permits about twice the real capacity
  // through waves 1-10, which is where every run was ending.
  const budget = killsPerSecond * FAIRNESS_KILL_REALISM * Math.max(0.01, pressureMultiplier);
  //
  // Ein Nenner <= 0 heißt: Die Verteidigung tötet schneller, als Gegner
  // nachkommen, also schafft sie jede Zahl und der Deckel ist unbegrenzt.
  //
  // Am 2026-09-22 einmal durch eine endliche Obergrenze ersetzt (was in
  // `MAX_WAVE_DURATION_MS` tötbar ist), weil genau diese Wellen mit 584
  // Gegnern kamen. Das Gegenteil trat ein: Die Grenze lag über der
  // Template-Spanne, die Deckel-Spanne innerhalb eines Laufs stieg von ×115
  // auf ×534 und die mediane Runlänge fiel von 53 auf 38. Die Formel hat
  // recht; die großen Wellen kommen aus der Template-Spanne, nicht von hier
  // (docs/DRAMA_CONTROLLER_PLAN.md, Runde 8).
  const denominator = 1 - budget * (Math.max(0, spawnDelayMs) / 1000);
  if (denominator <= 0) return null;
  const killable = (budget * engagementSeconds) / denominator;

  // Allow an overshoot priced in HP rather than assumed away. The leaks are
  // what make a wave dramatic; the budget is what stops them ending the run.
  // An enemy that splits can cost a leak per end of its split tree: a
  // skeleton killed just before the base sends both minions on.
  const leakHpBudget = Math.max(FAIRNESS_MIN_LEAK_HP, hpRemaining * Math.max(0, targetPressure));
  const allowedLeaks = (leakDamage > 0 ? leakHpBudget / leakDamage : leakHpBudget) / leaksPerEnemy;

  return Math.max(FAIRNESS_MIN_COUNT, Math.floor(killable + allowedLeaks));
}

/**
 * The player HP one lane may spend, the `hpRemaining` of survivableCount. In
 * coop every lane gets the whole wave (D13) and all leak into the one shared
 * base, so each lane's copy gets its share of the leak budget; with the whole
 * of it on every lane a wave cost N times the target pressure.
 */
export function laneHp(state: GameStateSnapshot): number {
  return (state.player?.lives ?? 100) / Math.max(1, state.lanes ?? 1);
}

/** Linear interpolation within a [min, max] range. t ∈ [0,1]. */
export function lerpRange(range: NumberRange, t: number): number {
  return range[0] + (range[1] - range[0]) * t;
}

/**
 * Top of the count range a defense of `totalDps` opens up (the DPS ramp): a
 * weak defense gets DPS_RAMP_FLOOR of the range, DPS_RAMP_COUNT DPS and more
 * the whole of it. The director never sends more, the fairness gate only
 * lowers it; NEXT in the WAVE panel shows it as the top of its range.
 *
 * `dpsRampWeight` decides how much of that is left. At 1 it is the rule
 * above; at 0 the whole range is open whatever the defense does, and the wave
 * follows the campaign instead of the player (director-params.ts).
 */
export function dpsScaledCountMax(countRange: NumberRange, totalDps: number): number {
  const weight = directorParams().dpsRampWeight;
  const byDps = Math.max(DPS_RAMP_FLOOR, Math.min(1.0, totalDps / DPS_RAMP_COUNT));
  const frac = byDps + (1 - byDps) * (1 - weight);
  return lerpRange(countRange, frac);
}
