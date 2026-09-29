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
 *    that when its one leak would cost more than the wave may (SURE_KILL_SHARE).
 * 4. Deckel: the wave's whole cost is at most what the defense can deal while
 *    the wave is on the route, plus the leaks the tension curve allows.
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
 * An enemy whose one leak would cost more HP than the whole wave may cost
 * takes only this share: it has to die with room to spare (the Ooze of W20
 * cost 91 HP with one leak at 0.9 and still about 90 at 0.5 with no escort, bots
 * 2026-09-28). Every type, every wave.
 */
export const SURE_KILL_SHARE = 0.25;
/** Least time under fire an enemy counts with, so a defense whose LOS is not in yet does not zero the HP. */
export const MIN_UNDER_FIRE_S = 2;
/** HP factors stay within these, whatever the defense. */
export const HP_MULT_MIN = 0.1;
export const HP_MULT_MAX = 500;
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
  /** What one leak costs at this wave, times the type's own leak damage. */
  readonly leakScale: number;
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
  const hurt: { type: string; n: number; sec: number; cap: number; fire: number; onRoute: number }[] = [];
  const unhurt: string[] = [];
  let leakCost = 0;
  for (const [type, spawns] of types) {
    const cfg = ENEMY_TYPES[type as EnemyTypeId];
    const bodyLeak = cfg.chain ? leakDamageOf(type as EnemyTypeId) / bodiesOf(type) : lineageLeakDamage(type as EnemyTypeId);
    const side = cfg.isAirUnit ? 'air' : 'ground';
    const oneLeak = bodyLeak * input.leakScale;
    const share = oneLeak > leakHp ? SURE_KILL_SHARE : UNDER_FIRE_SHARE;
    let isHurt = false;
    for (const part of bodyParts(type)) {
      const n = spawns * part.bodies;
      leakCost += n * (cfg.chain ? bodyLeak : Math.max(1, bodyLeak));
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
      hurt.push({ type, n, sec, fire, onRoute, cap: (share * fire) / sec });
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
  const allowedLeaks = leakCost > 0 && count > 0 ? leakHp / (input.leakScale * (leakCost / count)) : 0;
  const delivered = Math.min(budget, window + budget * Math.min(1, allowedLeaks / Math.max(1, count)));

  // One shared factor m, each type held at its own limit
  const cost = (m: number) => hurt.reduce((sum, h) => sum + h.n * h.sec * Math.min(m, h.cap), 0);
  let lo = 0;
  let hi = HP_MULT_MAX;
  if (cost(hi) <= delivered) lo = hi;
  else for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (cost(mid) < delivered) lo = mid; else hi = mid; }
  const m = lo;

  const hpMult: Record<string, number> = {};
  const clamped: string[] = [];
  for (const h of hurt) {
    if (h.cap < m && !clamped.includes(h.type)) clamped.push(h.type);
    hpMult[h.type] = round3(Math.max(HP_MULT_MIN, Math.min(HP_MULT_MAX, h.cap, m)));
  }
  // Nothing to measure against: the row's strength alone (HP x1 at strength 1)
  for (const type of unhurt) hpMult[type] = round3(Math.max(HP_MULT_MIN, input.strength));

  return { hpMult, budget, delivered, window, capped: delivered < budget, clamped, unhurt };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
