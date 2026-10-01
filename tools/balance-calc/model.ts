/**
 * The balance calculator's model: the defense of a recorded run rebuilt for
 * the real planner, and a simple estimate of what a wave costs the HQ.
 *
 * What is real code: the defense's matrix damage (defense-analyzer
 * addTowerDps, tower-dps.util), the run plan, the budget step, the budget
 * source with its pressure loop. What is estimated, and how, is in README.md:
 * the metres of route under fire (from the window the run log wrote) and the
 * leaks (one utilisation per side, fitted to the run's HQ).
 */

import { ARMOR_TYPES, type ArmorType } from '../../src/app/configs/combat/combat.types';
import { TOWER_TYPES, type TowerTypeId } from '../../src/app/configs/tower-types.config';
import { ENEMY_TYPES, WORM_MAX_SEGMENTS, leakDamageOf, lineageLeakDamage, type EnemyTypeId } from '../../src/app/configs/enemy-types.config';
import { addTowerDps } from '../../src/app/director/defense-analyzer';
import { computeTowerDPSFromLevels } from '../../src/app/director/tower-dps.util';
import type { EffectiveDPSPerArmor } from '../../src/app/director/models/game-state-snapshot';
import { bodyParts } from '../../src/app/director/sources/budget/budget';
import { RUN_PLAN_RULES, planEnemies, planRowForWave } from '../../src/app/director/sources/budget/run-plan';
import type { WaveConfig } from '../../src/app/director/models/wave-config';
import type { DefenseAt, TrajectoryWave } from './trajectory';

const zero = (): Record<ArmorType, number> => ARMOR_TYPES.reduce((acc, a) => { acc[a] = 0; return acc; }, {} as Record<ArmorType, number>);

/** Matrix damage per armor of a recorded defense. */
export function defenseDps(defense: DefenseAt): EffectiveDPSPerArmor {
  const out: EffectiveDPSPerArmor = { ground: zero(), air: zero() };
  for (const [type, levels, count] of defense.towers) {
    const cfg = TOWER_TYPES[type as TowerTypeId];
    if (!cfg) continue;
    const dps = computeTowerDPSFromLevels(cfg, levels) * count;
    addTowerDps(out, cfg, dps, defense.aa);
  }
  return out;
}

export function scaleArmor(dps: EffectiveDPSPerArmor, k: number): EffectiveDPSPerArmor {
  const out: EffectiveDPSPerArmor = { ground: zero(), air: zero() };
  for (const armor of ARMOR_TYPES) {
    out.ground[armor] = dps.ground[armor] * k;
    out.air[armor] = dps.air[armor] * k;
  }
  return out;
}

/** One kind of body in a wave: how many, HP each as shipped, how it walks and what a leak costs. */
export interface WaveBody {
  readonly type: string;
  readonly n: number;
  readonly hp: number;
  readonly armor: ArmorType;
  readonly air: boolean;
  readonly speed: number;
  /** HQ HP one of them costs when it gets through, wave scale included. */
  readonly leak: number;
}

/** The bodies of a wave as shipped: counts and HP factors from the config, the rest from the enemy types. */
export function waveBodies(wave: number, config: Pick<WaveConfig, 'enemies'>): WaveBody[] {
  const out: WaveBody[] = [];
  for (const group of config.enemies) {
    const cfg = ENEMY_TYPES[group.type as EnemyTypeId];
    if (!cfg || group.count <= 0) continue;
    const parts = bodyParts(group.type);
    const bodies = parts.reduce((sum, p) => sum + p.bodies, 0);
    const leak = cfg.chain ? leakDamageOf(group.type as EnemyTypeId) / bodies : lineageLeakDamage(group.type as EnemyTypeId);
    const scale = RUN_PLAN_RULES.leakScale(wave, group.type);
    // A raging boss counts as more HP: the part past the rage at its damage taken, faster (boss-traits.ts)
    const rage = cfg.traits?.rage;
    const hpFactor = rage ? 1 - rage.belowHp + (rage.belowHp * rage.speed) / rage.damageTaken : 1;
    for (const part of parts) {
      const n = group.count * part.bodies;
      const elites = cfg.chain ? 0 : Math.min(n, group.elite?.count ?? 0);
      const body = { type: group.type, armor: part.armor, air: !!cfg.isAirUnit, speed: part.speed, leak: leak * scale };
      if (elites > 0) out.push({ ...body, n: elites, hp: part.hp * group.elite!.healthMultiplier * hpFactor });
      out.push({ ...body, n: n - elites, hp: part.hp * (group.healthMultiplier ?? 1) * hpFactor });
    }
  }
  return out.filter((b) => b.n > 0);
}

/** Seconds the wave takes to come out of the portal, as budget.ts counts them. */
export function spawnSeconds(wave: number): number {
  const row = planRowForWave(wave)!;
  const planned = planEnemies(wave);
  const spawns = Object.values(planned).reduce((sum, n) => sum + n, 0);
  const emerging = Object.keys(planned).reduce((most, type) => {
    const cfg = ENEMY_TYPES[type as EnemyTypeId];
    return cfg?.chain ? Math.max(most, (WORM_MAX_SEGMENTS * cfg.chain.spacing) / Math.max(0.1, cfg.baseSpeed)) : most;
  }, 0);
  return Math.max(0, spawns - 1) * (row.spawnDelay / 1000) + emerging;
}

/**
 * Metres of route under fire when `wave` was planned, from the window the run
 * log wrote: window = spawn seconds + the bodies' mean time on the route, and
 * that time is metres over speed (budget.ts, onRoute, which is the larger of
 * the two times for every body when each tower sees part of the union).
 * null when the log gives nothing to read (no hurt bodies, a tiny window).
 */
export function metresFromWindow(wave: number, window: number, dps: EffectiveDPSPerArmor): number | null {
  const fireAvg = window - spawnSeconds(wave);
  if (!(fireAvg > 2.05)) return null;
  let bodies = 0;
  let perSpeed = 0;
  for (const [type, spawns] of Object.entries(planEnemies(wave))) {
    const cfg = ENEMY_TYPES[type as EnemyTypeId];
    if (!cfg) continue;
    const side = cfg.isAirUnit ? 'air' : 'ground';
    for (const part of bodyParts(type)) {
      if (!(dps[side][part.armor] > 0)) continue;
      const n = spawns * part.bodies;
      bodies += n;
      perSpeed += n / Math.max(0.1, part.speed);
    }
  }
  return bodies > 0 ? (fireAvg * bodies) / perSpeed : null;
}

/** The metres per wave, gaps filled from the neighbours. */
export function metresPerWave(waves: readonly Pick<TrajectoryWave, 'wave' | 'plan' | 'actual'>[]): Map<number, number> {
  const read = new Map<number, number>();
  for (const w of waves) {
    const m = metresFromWindow(w.wave, w.actual.window, defenseDps(w.plan));
    if (m !== null) read.set(w.wave, m);
  }
  const out = new Map<number, number>();
  const known = [...read.keys()].sort((a, b) => a - b);
  for (const w of waves) {
    if (read.has(w.wave)) { out.set(w.wave, read.get(w.wave)!); continue; }
    const before = known.filter((k) => k < w.wave).pop();
    const after = known.find((k) => k > w.wave);
    out.set(w.wave, read.get(before ?? after!) ?? read.get(after ?? before!) ?? 100);
  }
  return out;
}

/** The parts of a leak estimate. */
export interface LeakEstimate {
  /** HQ HP the wave costs. */
  readonly hp: number;
  /** Bodies that get through. */
  readonly bodies: number;
  /** Seconds of the realised damage the wave needs, over the seconds it is under fire. */
  readonly load: number;
}

/**
 * Utilisation of the matrix damage a defense realises against a wave: what
 * the towers land of their nominal damage while the wave is on the route
 * (overkill, retargeting, travel, towers out of reach of the bodies in the
 * route at that moment). Fitted to the human run (README.md).
 */
export interface LeakModel {
  readonly ground: number;
  readonly air: number;
  /** Ethereal bodies (ghosts, wraiths), ground or air. */
  readonly ethereal: number;
  /** Share of one body's time-under-fire damage the defense lands on it alone. */
  readonly single: number;
  /** Mean metres of route one tower sees, as a share of the metres under fire. */
  readonly towerShare: number;
  /**
   * Waves up to this one cost what they cost in the run, on top of the
   * estimate: the build-up's losses come from where the first towers stand,
   * which the load does not see (README.md).
   */
  readonly buildUpWaves: number;
}

/** The fit to the human run (README.md, calibration). */
export const HUMAN_RUN_MODEL: LeakModel = {
  ground: 0.65,
  air: 0.58,
  ethereal: 0.55,
  single: 1.4,
  towerShare: 0.215,
  buildUpWaves: 7,
};

/** Seconds one body is under the fire of a typical tower as it walks past (budget.ts, `fire`). */
export function bodyFire(body: Pick<WaveBody, 'speed'>, metres: number, model: Pick<LeakModel, 'towerShare'>): number {
  return Math.max(2, (model.towerShare * metres) / Math.max(0.1, body.speed));
}

/** Realised damage against a body: the matrix damage times the side's utilisation. */
export function realisedDps(body: Pick<WaveBody, 'air' | 'armor'>, dps: EffectiveDPSPerArmor, model: LeakModel): number {
  const u = body.armor === 'ethereal' ? model.ethereal : body.air ? model.air : model.ground;
  return dps[body.air ? 'air' : 'ground'][body.armor] * u;
}

/**
 * HQ HP a wave costs against a defense, by a fluid estimate: the defense
 * works through the wave's HP at its realised damage while the wave is under
 * fire (spawn seconds plus time on the route); what it cannot work through in
 * that time gets through, spread over the bodies; a body alone tougher than
 * what the defense deals it while it walks past gets through whole.
 */
export function estimateLeak(
  wave: number, bodies: readonly WaveBody[], dps: EffectiveDPSPerArmor, metres: number, model: LeakModel,
): LeakEstimate {
  let need = 0;
  let leakAll = 0;
  let bodyCount = 0;
  let surely = 0;
  let surelyHp = 0;
  for (const b of bodies) {
    const d = realisedDps(b, dps, model);
    leakAll += b.n * b.leak;
    bodyCount += b.n;
    if (!(d > 0)) { surely += b.n * b.leak; surelyHp += b.n; continue; }
    if (b.hp > model.single * d * bodyFire(b, metres, model)) { surely += b.n * b.leak; surelyHp += b.n; continue; }
    need += (b.n * b.hp) / d;
  }
  const fireAvg = bodies.length
    ? bodies.reduce((sum, b) => sum + b.n * (metres / Math.max(0.1, b.speed)), 0) / Math.max(1, bodyCount)
    : 0;
  const window = spawnSeconds(wave) + fireAvg;
  const load = window > 0 ? need / window : 0;
  const share = load > 1 ? 1 - 1 / load : 0;
  const rest = leakAll - surely;
  return { hp: surely + share * rest, bodies: surelyHp + share * (bodyCount - surelyHp), load };
}
