/**
 * The budget step: how much HP the enemies of a plan row get against the
 * defense as it stands. The same steps for every wave, boss or not
 * (docs/WAVE_RUN_PLAN.md, section 9):
 *
 * 1. Budget in seconds of defense damage: `B = S(N) · strength · R`.
 * 2. Each enemy's cost at HP ×1: its HP over the defense's damage against its
 *    armor, ground or air.
 * 3. Grenze je Gegner: no enemy gets more HP than the defense deals while it is
 *    under fire (metres of route under fire over its speed), and only a part of
 *    that when its one leak would cost a good part of the HQ (SURE_KILL_SHARE).
 *    A boss is never weaker than its escort (BOSS_OVER_ESCORT, BOSS_MIN_HP_MULT),
 *    its own limit or not.
 * 4. Deckel: the wave's whole cost is at most what the defense can deal while
 *    the wave is on the route, times the loop's R, plus the leaks the tension
 *    curve allows (CAP_FOLLOWS_REGULATOR).
 * 5. One shared HP factor fills what is left of the budget.
 *
 * Pure functions, no state: the source holds R.
 */

import type { EffectiveDPSPerArmor } from '../../models/game-state-snapshot';
import type { ArmorType } from '../../../configs/combat/combat.types';
import {
  ENEMY_TYPES, WORM_MAX_SEGMENTS, leakDamageOf, lineageHp, lineageLeakDamage, type EnemyTypeId,
} from '../../../configs/enemy-types.config';
import { DetMath } from '../../../utils/det-math';

/**
 * The saturating part of the curve: 15 s at W1, towards 100 s. What a leak
 * costs follows this part only (planLeakScale), so it levels off near 2.2.
 */
export function baseBudgetSeconds(wave: number): number {
  return 15 + 85 * (1 - DetMath.exp(-(Math.max(1, wave) - 1) / 15));
}

/**
 * Growth that keeps the curve rising past the plan: `ENDLESS_GROWTH ·
 * ((N − 1) / 60)²` seconds, +2.2 s at W30, +9.7 s at W60, +27 s at W100, +61 s
 * at W150 (User, 2026-09-29, from the endless concept).
 */
export const ENDLESS_GROWTH = 10;

/** Budget of a wave of strength 1 at R 1, in seconds of defense damage: 15 s at W1, 108 s at W60, rising on. */
export function budgetSeconds(wave: number): number {
  const n = (Math.max(1, wave) - 1) / 60;
  return baseBudgetSeconds(wave) + ENDLESS_GROWTH * n * n;
}

/**
 * Share of the modelled damage a defense actually lands, one value for the
 * whole run. Bots with three or four towers in W2-W8 killed 33 to 89 % of what
 * the model gave them at 0.9 (2026-09-28, 3 runs); the adaptive director
 * measured 0.65 on W1-W10. The pressure loop corrects the rest.
 */
export const BUDGET_REALISM = 0.6;
/** An enemy may take this share of the damage the defense deals while it is under fire. */
export const UNDER_FIRE_SHARE = 0.9;
/**
 * An enemy whose one leak would cost more than SURE_KILL_HQ_SHARE of the HQ
 * takes only this share: it has to die with room to spare. Every type, every
 * wave. The Ooze of W20 cost 91 HP with one leak at 0.9 (bots 2026-09-28);
 * at 0.25 and with the condition at the wave's whole allowed loss (a few HP)
 * Herbert and the Ooze were sized as fodder: Herbert 400 HP beside tanks of
 * 719, the Ooze dead at a fifth of the route (the run of 2026-10-01).
 */
export const SURE_KILL_SHARE = 0.5;
export const SURE_KILL_HQ_SHARE = 0.15;
/**
 * A boss (EnemyTypeConfig.isBoss) gets at least this many times the HP of
 * the toughest body of its escort, and at least this share of its base HP,
 * whatever its own limit says: a boss is a boss, and its HP come out of the
 * escort's share of the budget. It may get through; that is its threat.
 */
export const BOSS_OVER_ESCORT = 3;
export const BOSS_MIN_HP_MULT = 0.25;
/** Least time under fire an enemy counts with, so a defense whose LOS is not in yet does not zero the HP. */
export const MIN_UNDER_FIRE_S = 2;
/** HP factors stay within these, whatever the defense. */
export const HP_MULT_MIN = 0.1;
export const HP_MULT_MAX = 500;
/**
 * The cap moves with the loop: a wave may cost R times the defense's time on
 * the route. A fixed cap held 13 of 60 waves of the human run of 2026-10-01
 * while the loop stood at its stop for 50 waves and 37 of them cost nothing:
 * a player who lands more than BUDGET_REALISM of the matrix damage was never
 * reached on the waves that fill the route. With R in it the cap still flattens
 * the waves a plan row makes too dense, and the loop decides how dense that is
 * for this player; below R 1 it protects a weaker one further.
 */
export const CAP_FOLLOWS_REGULATOR = true;
/** Least HP a wave may cost through leaks, as in the adaptive cap. */
export const MIN_LEAK_HP = 1;

export interface BudgetDefense {
  /** Damage per armor, ground and air: the plain matrix values. The gate values count every tower at a floor against fortified, which let 62 mammoths through at HP x5 (bots, W25). */
  readonly dps: EffectiveDPSPerArmor | undefined;
  /** Damage times metres of route under fire, per armor (snapshot `damageMetres`): the limit per enemy. */
  readonly damageMetres: EffectiveDPSPerArmor | undefined;
  /** Metres some tower sees (snapshot `metresUnderFire`): how long the wave is under fire at all. */
  readonly metresUnderFire?: { readonly ground: number; readonly air: number };
  /** HQ HP this lane may spend (the coop share). */
  readonly hpRemaining: number;
}

export interface BudgetInput {
  readonly wave: number;
  readonly enemies: Readonly<Record<string, number>>;
  readonly strength: number;
  readonly spawnDelayMs: number;
  /** The pressure loop's R. */
  readonly regulator: number;
  /** Target share of the HP this wave may cost (targetPressure). */
  readonly targetPressure: number;
  /** What one leak of a type costs at this wave, times the type's own leak damage (waveLeakScale). */
  readonly leakScale: (type: string) => number;
  readonly defense: BudgetDefense;
}

export interface BudgetResult {
  /** HP factor per enemy type. */
  readonly hpMult: Readonly<Record<string, number>>;
  /** Budget before the cap: S · strength · R. */
  readonly budget: number;
  /** What the cap left of it. */
  readonly delivered: number;
  /** Seconds the defense can spend on the wave while it is on the route. */
  readonly window: number;
  /** Did the cap cut the budget? */
  readonly capped: boolean;
  /** Types held at their own limit (time under fire). */
  readonly clamped: readonly string[];
  /** Types the defense cannot hurt at all (no air defense, no tower yet): HP × the row's strength. */
  readonly unhurt: readonly string[];
  /** Each hurt type's own limit (time under fire) as an HP factor. */
  readonly limits: Readonly<Record<string, number>>;
  /** Bosses held up by their floor (BOSS_OVER_ESCORT, BOSS_MIN_HP_MULT) over the shared factor or their limit. */
  readonly floored: readonly string[];
}

/** The bodies of one kind one spawn brings, each walking past the towers on its own. */
export interface BodyPart {
  readonly bodies: number;
  /** HP of one of them at ×1 */
  readonly hp: number;
  readonly armor: ArmorType;
  /** Speed its time under fire counts with (m/s) */
  readonly speed: number;
}

/**
 * Speed factor a worm's segments pass the towers with on average, for its
 * rush (EnemyChain.rush): taken apart from the front, the k-th lost segment
 * speeds the rest up to 1 + rush · k / size, and the time under fire goes
 * with the inverse, whose mean over k is ln(1 + rush) / rush.
 */
export function meanRush(rush: number): number {
  return rush > 0 ? rush / DetMath.log(1 + rush) : 1;
}

/**
 * The bodies of one spawn of `type`: the enemy itself with its split tree,
 * or for a chain its head (EnemyChain.head, HP and armor of its own) and its
 * segments, as many as the longest worm has. The same rule for every type.
 */
export function bodyParts(type: string): BodyPart[] {
  const cfg = ENEMY_TYPES[type as EnemyTypeId];
  if (!cfg) return [];
  if (!cfg.chain) return [{ bodies: 1, hp: lineageHp(type as EnemyTypeId), armor: cfg.armorType, speed: cfg.baseSpeed }];
  const speed = cfg.baseSpeed * meanRush(cfg.chain.rush);
  return [
    { bodies: 1, hp: cfg.baseHp * cfg.chain.head.hpFactor, armor: cfg.chain.head.armorType, speed },
    { bodies: WORM_MAX_SEGMENTS - 1, hp: cfg.baseHp, armor: cfg.armorType, speed },
  ];
}

/** HP of one enemy at ×1, split tree included; a worm counts its head and all its segments. */
export function enemyHp(type: string): number {
  return bodyParts(type).reduce((sum, part) => sum + part.bodies * part.hp, 0);
}

export function sizeWave(input: BudgetInput): BudgetResult {
  const { defense } = input;
  const budget = budgetSeconds(input.wave) * input.strength * input.regulator;
  const types = Object.entries(input.enemies).filter(([type, count]) => count > 0 && ENEMY_TYPES[type as EnemyTypeId]);
  // Bodies, not spawns: a chain (Skarnax) is one spawn but a body per segment, each walking
  // past the towers on its own, each with its share of HP and leak (the same rule for every type)
  const bodiesOf = (type: string) => bodyParts(type).reduce((sum, part) => sum + part.bodies, 0);
  const count = types.reduce((sum, [type, n]) => sum + n * bodiesOf(type), 0);
  // The seconds a chain takes to come out of its portal, one segment after another
  const emerging = types.reduce((most, [type]) => {
    const cfg = ENEMY_TYPES[type as EnemyTypeId];
    return cfg.chain ? Math.max(most, (WORM_MAX_SEGMENTS * cfg.chain.spacing) / Math.max(0.1, cfg.baseSpeed)) : most;
  }, 0);

  const leakHp = Math.max(MIN_LEAK_HP, input.defense.hpRemaining * Math.max(0, input.targetPressure));
  const hurt: { type: string; boss: boolean; n: number; hp: number; sec: number; cap: number; fire: number; onRoute: number }[] = [];
  const unhurt: string[] = [];
  let leakCost = 0;
  for (const [type, spawns] of types) {
    const cfg = ENEMY_TYPES[type as EnemyTypeId];
    const bodyLeak = cfg.chain ? leakDamageOf(type as EnemyTypeId) / bodiesOf(type) : lineageLeakDamage(type as EnemyTypeId);
    const side = cfg.isAirUnit ? 'air' : 'ground';
    const scale = input.leakScale(type);
    const oneLeak = bodyLeak * scale;
    const share = oneLeak > input.defense.hpRemaining * SURE_KILL_HQ_SHARE ? SURE_KILL_SHARE : UNDER_FIRE_SHARE;
    let isHurt = false;
    for (const part of bodyParts(type)) {
      const n = spawns * part.bodies;
      leakCost += n * (cfg.chain ? bodyLeak : Math.max(1, bodyLeak)) * scale;
      const rawDps = defense.dps?.[side]?.[part.armor] ?? 0;
      const dps = rawDps * BUDGET_REALISM;
      if (!(dps > 0)) continue;
      isHurt = true;
      const sec = part.hp / dps;
      // Seconds of the whole defense's damage the body takes on its way past: each tower
      // counts with the stretch it sees (damage-metres over speed, over the total damage)
      const damageMetres = defense.damageMetres?.[side]?.[part.armor] ?? 0;
      const fire = Math.max(MIN_UNDER_FIRE_S, damageMetres / (rawDps * Math.max(0.1, part.speed)));
      // For the wave's window: how long this body is under fire at all (union of the stretches)
      const onRoute = Math.max(MIN_UNDER_FIRE_S, (defense.metresUnderFire?.[side] ?? 0) / Math.max(0.1, part.speed));
      hurt.push({ type, boss: cfg.isBoss === true, n, hp: part.hp, sec, fire, onRoute, cap: (share * fire) / sec });
    }
    if (!isHurt) unhurt.push(type);
  }

  // One HP factor per type: the parts of a worm share the lowest of their limits
  const capOf = new Map<string, number>();
  for (const h of hurt) capOf.set(h.type, Math.min(capOf.get(h.type) ?? Infinity, h.cap));
  for (const h of hurt) h.cap = capOf.get(h.type)!;

  // The cap: the defense spends at most the wave's time on the route on it,
  // plus the leaks the tension curve allows for this wave
  const spawns = types.reduce((sum, [, n]) => sum + n, 0);
  const spawnSeconds = Math.max(0, spawns - 1) * (input.spawnDelayMs / 1000) + emerging;
  const fireAvg = hurt.length ? hurt.reduce((sum, h) => sum + h.n * Math.max(h.fire, h.onRoute), 0) / hurt.reduce((sum, h) => sum + h.n, 0) : 0;
  const window = spawnSeconds + fireAvg;
  const allowedLeaks = leakCost > 0 && count > 0 ? leakHp / (leakCost / count) : 0;
  const capWindow = CAP_FOLLOWS_REGULATOR ? window * input.regulator : window;
  const delivered = Math.min(budget, capWindow + budget * Math.min(1, allowedLeaks / Math.max(1, count)));

  // A boss's floor at the shared factor m: over the toughest escort body, over its share of its base
  const bossHp = new Map<string, number>();
  for (const h of hurt) if (h.boss) bossHp.set(h.type, Math.max(bossHp.get(h.type) ?? 0, h.hp));
  const floorOf = (type: string, m: number) => {
    let escort = 0;
    for (const h of hurt) if (!h.boss) escort = Math.max(escort, h.hp * Math.min(m, h.cap));
    return Math.max(BOSS_MIN_HP_MULT, (BOSS_OVER_ESCORT * escort) / bossHp.get(type)!);
  };
  const multOf = (h: (typeof hurt)[number], m: number) => (h.boss ? Math.max(floorOf(h.type, m), Math.min(m, h.cap)) : Math.min(m, h.cap));

  // One shared factor m, each type held at its own limit, a boss at least at its floor
  const cost = (m: number) => hurt.reduce((sum, h) => sum + h.n * h.sec * multOf(h, m), 0);
  let lo = 0;
  let hi = HP_MULT_MAX;
  if (cost(hi) <= delivered) lo = hi;
  else for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (cost(mid) < delivered) lo = mid; else hi = mid; }
  const m = lo;

  const hpMult: Record<string, number> = {};
  const clamped: string[] = [];
  const floored: string[] = [];
  for (const h of hurt) {
    const mult = multOf(h, m);
    if (h.boss && mult > Math.min(m, h.cap)) {
      if (!floored.includes(h.type)) floored.push(h.type);
    } else if (h.cap < m && !clamped.includes(h.type)) clamped.push(h.type);
    hpMult[h.type] = round3(Math.max(HP_MULT_MIN, Math.min(HP_MULT_MAX, mult)));
  }
  // Nothing to measure against: the row's strength alone (HP x1 at strength 1)
  for (const type of unhurt) hpMult[type] = round3(Math.max(HP_MULT_MIN, input.strength));

  const limits: Record<string, number> = {};
  for (const [type, cap] of capOf) limits[type] = round3(cap);
  return { hpMult, budget, delivered, window, capped: delivered < budget, clamped, unhurt, limits, floored };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
