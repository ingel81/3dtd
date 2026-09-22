/**
 * Wave Templates — Phase 5.11 Range-Based (Frontend mirror of templates.py).
 *
 * Each template defines the CHARACTER of a wave (enemy mix, campaign gate,
 * capability requirement, spawn pattern) plus RANGES for 4 dynamic parameters:
 * count, spawn_delay_ms, hp_mult, variation.
 *
 * The director picks a template index and four factors in [0,1]; the builder
 * interpolates each factor into the template's designer-set range.
 *
 * Slots 0-21 are active, slots 22-31 are free for new templates. New
 * templates are appended, so existing slots keep their index.
 */

import { type ArmorType } from '../configs/combat/combat.types';
import { directorParams } from './director-params';

export type TemplateSpawnPattern = 'interleaved' | 'sequential' | 'clustered' | null;
export type TemplateCapability = 'antiAir' | 'antiEthereal' | null;
export type NumberRange = readonly [number, number];

export interface Template {
  id: string;
  name: string;
  description: string;
  enemies: readonly (readonly [string, number])[];
  countRange: NumberRange;
  spawnDelayRange: NumberRange;
  hpMultRange: NumberRange;
  variationRange: NumberRange;
  minWave: number;
  spawnPattern: TemplateSpawnPattern;
  requires: TemplateCapability;
  bossOnly: boolean;
}

export const TEMPLATES: readonly Template[] = [
  {
    id: 'zombie_horde',
    name: 'Zombie Horde',
    description: 'Unarmored zombies. Starts gentle, ends as a mega-swarm.',
    // zombie-v2 stays a garnish rather than half the horde: at the top of the
    // count range (2000) it is measurably more expensive to render than the
    // classic zombie, and this template is the mega-swarm slot.
    enemies: [['zombie', 0.9], ['zombie-v2', 0.1]],
    countRange: [20, 2000],
    spawnDelayRange: [15, 400],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.05, 0.40],
    minWave: 1,
    spawnPattern: 'interleaved',
    requires: null,
    bossOnly: false,
  },
  {
    id: 'rat_tide',
    name: 'Rat Tide',
    description: 'A flood of rats, anywhere from 100 to 5000.',
    enemies: [['rat', 1.0]],
    countRange: [100, 5000],
    spawnDelayRange: [10, 200],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.05, 0.30],
    minWave: 8,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    id: 'penguin_rush',
    name: 'Penguin Rush',
    description: 'Fast penguins, with rats filling the gaps.',
    enemies: [['penguin', 0.9], ['rat', 0.1]],
    countRange: [30, 500],
    spawnDelayRange: [10, 300],
    hpMultRange: [0.5, 4.0],
    variationRange: [0.05, 0.35],
    minWave: 5,
    spawnPattern: 'interleaved',
    requires: null,
    bossOnly: false,
  },
  {
    id: 'light_mix',
    name: 'Light Mix',
    description: 'Wallsmashers and spiders.',
    enemies: [['wallsmasher', 0.5], ['spider', 0.5]],
    countRange: [30, 400],
    spawnDelayRange: [30, 500],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.05, 0.40],
    minWave: 4,
    spawnPattern: 'interleaved',
    requires: null,
    bossOnly: false,
  },
  {
    id: 'spider_swarm',
    name: 'Spider Swarm',
    description: 'A flood of spiders.',
    enemies: [['spider', 1.0]],
    countRange: [50, 800],
    spawnDelayRange: [20, 350],
    hpMultRange: [0.5, 4.0],
    variationRange: [0.05, 0.35],
    minWave: 8,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    id: 'wallsmasher_crew',
    name: 'Wallsmasher Crew',
    description: 'Wallsmashers only. All health, no tricks.',
    enemies: [['wallsmasher', 1.0]],
    countRange: [15, 200],
    spawnDelayRange: [50, 600],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.10, 0.40],
    minWave: 6,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    id: 'bat_swarm',
    name: 'Bat Swarm',
    description: 'Bat swarm. Needs anti-air.',
    enemies: [['bat', 1.0]],
    countRange: [30, 600],
    spawnDelayRange: [15, 300],
    hpMultRange: [0.5, 4.0],
    variationRange: [0.05, 0.30],
    minWave: 7,
    spawnPattern: null,
    requires: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'hornet_strike',
    name: 'Hornet Strike',
    description: 'Hornets and bats. Needs anti-air.',
    enemies: [['hornet', 0.7], ['bat', 0.3]],
    countRange: [20, 300],
    spawnDelayRange: [30, 400],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.10, 0.40],
    minWave: 9,
    spawnPattern: 'interleaved',
    requires: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'tank_column',
    name: 'Tank Column',
    description: 'Tanks and zombie soldiers.',
    enemies: [['tank', 0.6], ['zombie-soldier', 0.4]],
    countRange: [10, 150],
    spawnDelayRange: [80, 800],
    hpMultRange: [0.5, 8.0],
    variationRange: [0.10, 0.35],
    minWave: 10,
    spawnPattern: 'interleaved',
    requires: null,
    bossOnly: false,
  },
  {
    id: 'bear_pack',
    name: 'Bear Pack',
    description: 'A pack of bears.',
    enemies: [['bear', 1.0]],
    countRange: [8, 120],
    spawnDelayRange: [60, 600],
    hpMultRange: [0.5, 7.0],
    variationRange: [0.10, 0.35],
    minWave: 12,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    id: 'mech_army',
    name: 'Mech Army',
    description: 'Mechs only. A late-game stress test.',
    enemies: [['mech', 1.0]],
    countRange: [5, 100],
    // Untere Grenze von 100 auf 450 ms (2026-09-22): Mechs sind große Modelle
    // und liefen bei 100 ms praktisch ineinander. Bei 3 m/s sind 450 ms rund
    // anderthalb Meter Abstand.
    spawnDelayRange: [450, 1200],
    hpMultRange: [0.5, 10.0],
    variationRange: [0.10, 0.40],
    minWave: 20,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    id: 'dragon_elite',
    name: 'Dragon Elite',
    description: 'Dragons and hornets. Needs anti-air.',
    enemies: [['dragon', 0.6], ['hornet', 0.4]],
    countRange: [5, 100],
    spawnDelayRange: [80, 800],
    hpMultRange: [0.5, 8.0],
    variationRange: [0.10, 0.40],
    minWave: 15,
    spawnPattern: 'interleaved',
    requires: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'mammoth_siege',
    name: 'Mammoth Siege',
    description: 'Mammoths and wallsmashers.',
    enemies: [['mammoth', 0.7], ['wallsmasher', 0.3]],
    countRange: [8, 120],
    spawnDelayRange: [100, 1000],
    hpMultRange: [0.5, 10.0],
    variationRange: [0.10, 0.40],
    minWave: 14,
    spawnPattern: 'interleaved',
    requires: null,
    bossOnly: false,
  },
  {
    id: 'ghost_surge',
    name: 'Ghost Surge',
    description: 'Ghosts and wraiths. Needs magic or ice.',
    enemies: [['ghost', 0.8], ['wraith', 0.2]],
    countRange: [20, 350],
    spawnDelayRange: [30, 400],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.10, 0.40],
    minWave: 12,
    spawnPattern: 'interleaved',
    requires: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'wraith_storm',
    name: 'Wraith Storm',
    description: 'Wraiths only. Needs magic or ice.',
    enemies: [['wraith', 1.0]],
    countRange: [15, 300],
    spawnDelayRange: [20, 350],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.05, 0.35],
    minWave: 18,
    spawnPattern: null,
    requires: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'chaos_wave',
    name: 'Chaos Wave',
    description: 'A chaotic four-type mix. Needs anti-air.',
    enemies: [['zombie', 0.3], ['tank', 0.3], ['hornet', 0.2], ['bear', 0.2]],
    countRange: [25, 500],
    spawnDelayRange: [40, 500],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.15, 0.50],
    minWave: 15,
    spawnPattern: 'interleaved',
    requires: 'antiAir',
    bossOnly: false,
  },
  {
    id: 'armor_gauntlet',
    name: 'Armor Gauntlet',
    description: 'All four armor types at once.',
    enemies: [['rat', 0.25], ['tank', 0.25], ['mammoth', 0.25], ['ghost', 0.25]],
    countRange: [30, 600],
    spawnDelayRange: [40, 500],
    hpMultRange: [0.5, 6.0],
    variationRange: [0.15, 0.45],
    minWave: 20,
    spawnPattern: 'interleaved',
    requires: 'antiEthereal',
    bossOnly: false,
  },
  {
    id: 'boss_herbert',
    name: 'Boss: Herbert',
    description: 'Herbert, with support waves.',
    // Kein Horden-Template mehr (2026-09-22). Bei 3,34 % Herbert auf bis zu
    // hundert Gegner kamen drei Bosse und siebenundneunzig Begleiter — eine
    // Horde mit Boss-Etikett. Jetzt höchstens zwanzig Gegner, davon ein
    // Viertel Herberts, und die Schwierigkeit wächst über die HP statt über
    // die Menge: Die HP-Spanne reicht dafür bis ×20, und welchen Wert der
    // Regler daraus nimmt, entscheidet er selbst.
    enemies: [['herbert', 0.25], ['tank', 0.375], ['zombie', 0.375]],
    countRange: [6, 20],
    spawnDelayRange: [400, 1800],
    hpMultRange: [0.5, 20.0],
    variationRange: [0.10, 0.30],
    minWave: 20,
    spawnPattern: 'clustered',
    requires: null,
    bossOnly: true,
  },
  {
    // Stone Golem squad — fortified, slow, very tough. Campaign slot W15.
    // minWave matches mammoth_siege (14): both are fortified DPS checks, and
    // the campaign reaches this template one wave later.
    id: 'golem_squad',
    name: 'Golem Squad',
    description: 'Stone golems. Slow and fortified, a straight damage check.',
    enemies: [['stone-golem', 1.0]],
    countRange: [5, 60],
    // Untere Grenze von 200 auf 600 ms (2026-09-22): Der Stone Golem ist das
    // größte Bodenmodell im Spiel und stand bei 200 ms und 2,5 m/s einen
    // halben Meter hinter seinem Vordermann.
    spawnDelayRange: [600, 1800],
    hpMultRange: [0.8, 6.0],
    variationRange: [0.10, 0.30],
    minWave: 14,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
  {
    // Post-campaign boss (W35, W40, ...): stone golems with a mammoth escort.
    // Fortified, so the wave asks whether the player has siege or magic.
    id: 'boss_golem',
    name: 'Boss: Stone Golem',
    description: 'Stone golems with a mammoth escort.',
    enemies: [['stone-golem', 0.3], ['mammoth', 0.7]],
    countRange: [8, 80],
    // Wie beim Golem Squad: große Modelle brauchen Luft zwischen sich.
    spawnDelayRange: [600, 1800],
    hpMultRange: [0.8, 6.0],
    variationRange: [0.10, 0.30],
    minWave: 31,
    spawnPattern: 'clustered',
    requires: null,
    bossOnly: true,
  },
  {
    // Post-campaign air boss: dragons (heavy) inside a hornet swarm (light),
    // one answer from rocket or lightning, the other from gatling or ice.
    id: 'boss_dragon',
    name: 'Boss: Dragon Flight',
    description: 'Dragons with a hornet swarm. Needs anti-air.',
    enemies: [['dragon', 0.5], ['hornet', 0.5]],
    countRange: [8, 80],
    spawnDelayRange: [100, 1000],
    hpMultRange: [0.8, 6.0],
    variationRange: [0.10, 0.30],
    minWave: 31,
    spawnPattern: 'clustered',
    requires: 'antiAir',
    bossOnly: true,
  },
  {
    // Skeletons: unarmored like the zombie, a quarter of its HP and faster,
    // a swarm between rat_tide (5 HP) and zombie_horde. Campaign slot W19,
    // the mega-swarm checkpoint that used to run rat_tide a second time.
    // A kill splits each into two minions: 20 + 2 × 6 = 32 HP and three
    // bodies per skeleton. The range is the pre-split [40, 1500] divided by
    // that 1.6, so a wave brings the HP it did before; its top is 2820
    // bodies, 3.3 Mio. VAT vertices against the swarm budget of 5 Mio.
    id: 'skeleton_swarm',
    name: 'Skeleton Swarm',
    description: 'A rattling swarm of skeletons.',
    enemies: [['skeleton', 1.0]],
    countRange: [25, 940],
    spawnDelayRange: [15, 300],
    hpMultRange: [0.5, 5.0],
    variationRange: [0.05, 0.35],
    minWave: 6,
    spawnPattern: null,
    requires: null,
    bossOnly: false,
  },
];

/** Number of currently defined templates — slots beyond this are reserved. */
export const NUM_ACTIVE_TEMPLATES = TEMPLATES.length;

/** Template cooldown: template blocked for N waves after use. */
export const TEMPLATE_COOLDOWN_WAVES = 2;

/** Global wave-duration safety cap (count × spawn_delay ≤ 3 min). */
export const MAX_WAVE_DURATION_MS = 180_000;
export const MIN_SPAWN_DELAY_MS = 5;

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
 * Lowest matchup factor the gate credits a tower with against ground
 * unarmored, light, heavy and fortified enemies.
 *
 * The gate sizes a wave from armor-weighted DPS, so a bad matchup does not make
 * a wave hard, it makes it small: gatlings against tanks simply got fewer tanks,
 * and a wider damage matrix would have been absorbed by the gate almost
 * entirely. With the floor a wrong roster is felt as leaks, and the leak
 * controller answers with smaller waves afterwards. Since 2026-09-20 nothing
 * caps what those leaks cost, so `survivableCount` is the only thing standing
 * between a wrong roster and the end of the run. Ethereal and air keep the plain matrix: they
 * are hard gates with their own capability check.
 *
 * Applied per tower in the defense analyzer (`gateDpsPerArmor`); survivableCount
 * reads the result and knows nothing about the floor.
 */
export const FAIRNESS_MATCHUP_FLOOR = 0.6;

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

export function getTemplate(idx: number): Template | null {
  if (idx < 0 || idx >= NUM_ACTIVE_TEMPLATES) return null;
  return TEMPLATES[idx];
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

/**
 * The templates the director may pick for a wave, as ascending indices.
 *
 * Inside the campaign the list collapses to the single pinned template. Past
 * it the designer's rules apply: `minWave`, the `requires` capability, the
 * reuse cooldown and the boss cadence. On a boss wave only boss templates that
 * pass those rules are candidates; on every other wave they are excluded.
 * Merely allowing a boss on boss waves left it tied with a dozen other
 * templates, and the stalest-template rule picked it in 0.7 of ten intended
 * boss waves between W31 and W130.
 *
 * `forcedTemplateId` and `bossWave` come from the campaign (templateForWave,
 * isBossWave). They are passed in rather than imported so this module stays
 * free of a dependency on the campaign config, which already imports TEMPLATES
 * from here.
 */
export function candidateTemplates(
  currentWave: number,
  hasAntiAir: boolean,
  hasAntiEthereal: boolean,
  recentTemplateIndices: readonly number[],
  forcedTemplateId: string | null = null,
  bossWave = false,
): TemplateCandidates {
  const picked = new Set<number>();
  const lacks = (t: Template): TemplateCapability => {
    if (t.requires === 'antiAir' && !hasAntiAir) return 'antiAir';
    if (t.requires === 'antiEthereal' && !hasAntiEthereal) return 'antiEthereal';
    return null;
  };
  const reason: CandidateReason = {
    rule: bossWave ? 'boss' : 'free',
    bossUnavailable: false,
    cooldownWaived: false,
    heldBack: { antiAir: [], antiEthereal: [] },
    pinnedLacks: null,
  };
  const sorted = (): number[] => [...picked].sort((a, b) => a - b);

  if (forcedTemplateId) {
    const forcedIdx = TEMPLATES.findIndex((t) => t.id === forcedTemplateId);
    if (forcedIdx >= 0) {
      // The pin bypasses the capability requirement on purpose; the
      // survivability cap is what keeps such a wave survivable.
      return {
        indices: [forcedIdx],
        reason: { ...reason, rule: 'campaign', pinnedLacks: lacks(TEMPLATES[forcedIdx]) },
      };
    }
    // An unknown campaign id is a config bug; fall through to free choice
    // rather than returning an empty list.
  }

  const recent = new Set(recentTemplateIndices.slice(-TEMPLATE_COOLDOWN_WAVES));
  /** Designer rules, and the boss rule: boss templates on boss waves only. */
  const eligible = (i: number, boss: boolean): boolean => {
    const t = TEMPLATES[i];
    if (t.bossOnly !== boss) return false;
    if (currentWave < t.minWave) return false;
    return lacks(t) === null;
  };
  const fill = (boss: boolean, respectCooldown: boolean, firstOnly: boolean): void => {
    for (let i = 0; i < NUM_ACTIVE_TEMPLATES; i++) {
      if (!eligible(i, boss) || (respectCooldown && recent.has(i))) continue;
      picked.add(i);
      if (firstOnly) return;
    }
  };

  fill(bossWave, true, false);

  // Fallbacks, in order: a boss wave is still a boss wave when every boss
  // template is on cooldown; a boss wave no boss template can serve (minWave,
  // capabilities) becomes a normal wave; the cooldown must never be able to
  // starve the list; and an empty list would leave the director nothing to
  // ship.
  if (picked.size === 0 && bossWave) {
    fill(true, false, true);
    reason.cooldownWaived = picked.size > 0;
  }
  if (picked.size === 0 && bossWave) {
    reason.rule = 'free';
    reason.bossUnavailable = true;
    fill(false, true, false);
  }
  if (picked.size === 0) {
    reason.cooldownWaived = true;
    fill(false, false, true);
  }
  if (picked.size === 0) picked.add(0);

  // Only templates the other rules would have let through: minWave and the
  // boss rule already exclude the rest, and listing those would be noise.
  const boss = reason.rule === 'boss';
  for (let i = 0; i < NUM_ACTIVE_TEMPLATES; i++) {
    const t = TEMPLATES[i];
    if (t.bossOnly !== boss || currentWave < t.minWave) continue;
    const missing = lacks(t);
    if (missing) reason.heldBack[missing].push(i);
  }

  return { indices: sorted(), reason };
}

/**
 * Why a wave's candidate list looks the way it does, for the decision
 * explainer.
 *
 * Carried as data rather than rebuilt from the list afterwards: a list with
 * one entry looks the same whether the campaign pinned it, the boss rule
 * collapsed it or the requirements left nothing else, and those are different
 * answers to "why this wave".
 */
export interface CandidateReason {
  /** campaign: pinned to one template; boss: boss templates only; free: open choice. */
  rule: 'campaign' | 'boss' | 'free';
  /** A boss wave no boss template could serve, run as a normal wave instead. */
  bossUnavailable: boolean;
  /** Every eligible template had just run, so the reuse cooldown was waived. */
  cooldownWaived: boolean;
  /** Templates held back only because the defense lacks the capability they need. */
  heldBack: { antiAir: number[]; antiEthereal: number[] };
  /** Capability the pinned campaign template needs and the defense lacks. */
  pinnedLacks: TemplateCapability;
}

/** The templates a wave may use, and why. */
export interface TemplateCandidates {
  /** Template indices, ascending. Never empty. */
  indices: number[];
  reason: CandidateReason;
}
