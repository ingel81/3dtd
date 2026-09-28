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
import {
  ENEMY_TYPES, WORM_MAX_SEGMENTS, leakDamageOf, lineageHp, lineageLeakDamage, type EnemyTypeId,
} from '../../../configs/enemy-types.config';
import { DetMath } from '../../../utils/det-math';

/** Budget of a wave of strength 1 at R 1, in seconds of defense damage: 15 s at W1, towards 100 s. */
export function budgetSeconds(wave: number): number {
  return 15 + 85 * (1 - DetMath.exp(-(Math.max(1, wave) - 1) / 15));
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
  /** Types the defense cannot hurt at all (no air defense, say): they keep HP ×1. */
  readonly unhurt: readonly string[];
}

/** HP of one enemy at ×1, split tree included; a worm counts all its segments. */
export function enemyHp(type: string): number {
  const cfg = ENEMY_TYPES[type as EnemyTypeId];
  if (!cfg) return 0;
  return cfg.chain ? cfg.baseHp * WORM_MAX_SEGMENTS : lineageHp(type as EnemyTypeId);
}

export function sizeWave(input: BudgetInput): BudgetResult {
  const { defense } = input;
  const budget = budgetSeconds(input.wave) * input.strength * input.regulator;
  const types = Object.entries(input.enemies).filter(([type, count]) => count > 0 && ENEMY_TYPES[type as EnemyTypeId]);
  // Bodies, not spawns: a chain (Skarnax) is one spawn but a body per segment, each walking
  // past the towers on its own, each with its share of HP and leak (the same rule for every type)
  const bodiesOf = (type: string) => (ENEMY_TYPES[type as EnemyTypeId].chain ? WORM_MAX_SEGMENTS : 1);
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
    const bodies = bodiesOf(type);
    const n = spawns * bodies;
    const bodyHp = enemyHp(type) / bodies;
    const bodyLeak = cfg.chain ? leakDamageOf(type as EnemyTypeId) / bodies : lineageLeakDamage(type as EnemyTypeId);
    const side = cfg.isAirUnit ? 'air' : 'ground';
    const rawDps = defense.dps?.[side]?.[cfg.armorType] ?? 0;
    const dps = rawDps * BUDGET_REALISM;
    leakCost += n * (cfg.chain ? bodyLeak : Math.max(1, bodyLeak));
    if (!(dps > 0)) { unhurt.push(type); continue; }
    const sec = bodyHp / dps;
    // Seconds of the whole defense's damage the enemy takes on its way past: each tower
    // counts with the stretch it sees (damage-metres over speed, over the total damage)
    const damageMetres = defense.damageMetres?.[side]?.[cfg.armorType] ?? 0;
    const fire = Math.max(MIN_UNDER_FIRE_S, damageMetres / (rawDps * Math.max(0.1, cfg.baseSpeed)));
    const oneLeak = bodyLeak * input.leakScale;
    const share = oneLeak > leakHp ? SURE_KILL_SHARE : UNDER_FIRE_SHARE;
    // For the wave's window: how long this enemy is under fire at all (union of the stretches)
    const onRoute = Math.max(MIN_UNDER_FIRE_S, (defense.metresUnderFire?.[side] ?? 0) / Math.max(0.1, cfg.baseSpeed));
    hurt.push({ type, n, sec, fire, onRoute, cap: (share * fire) / sec });
  }

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
    if (h.cap < m) clamped.push(h.type);
    hpMult[h.type] = round3(Math.max(HP_MULT_MIN, Math.min(HP_MULT_MAX, h.cap, m)));
  }
  for (const type of unhurt) hpMult[type] = 1;

  return { hpMult, budget, delivered, window, capped: delivered < budget, clamped, unhurt };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
