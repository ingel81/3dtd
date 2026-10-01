/**
 * Runs the real budget source wave by wave against a recorded defense: the
 * source plans each wave from a snapshot built of that defense, the leak
 * estimate says what it costs, and the source hears the result, so its
 * pressure loop moves as it would have (README.md).
 */

import { createEmptySnapshot, type EffectiveDPSPerArmor, type GameStateSnapshot } from '../../src/app/director/models/game-state-snapshot';
import type { WaveResult } from '../../src/app/director/models/wave-result';
import type { PlannedWave } from '../../src/app/director/wave-source';
import { BudgetWaveSource } from '../../src/app/director/sources/budget/budget-source';
import { ENEMY_TYPES, type EnemyTypeId } from '../../src/app/configs/enemy-types.config';
import { mulberry32 } from '../../src/app/utils/game-rng';
import { bodyFire, defenseDps, estimateLeak, realisedDps, scaleArmor, waveBodies, type LeakModel } from './model';
import type { Trajectory } from './trajectory';

export interface ScenarioOptions {
  /**
   * How well the player uses the recorded defense (0.7 a weaker player, 1.3 a
   * stronger one): scales the realised damage, not the towers. The planner
   * sizes against the towers' damage either way, so scaling the towers would
   * change nothing; what tells players apart is what they make of them.
   */
  readonly strength: number;
  readonly model: LeakModel;
  /** Feed the recorded HQ loss to the loop instead of the estimate (to check the rebuild). */
  readonly recordedLoss?: boolean;
  /** Stop after this wave. */
  readonly lastWave?: number;
}

export interface WaveRow {
  readonly wave: number;
  readonly name: string;
  readonly regulator: number;
  readonly budget: number;
  readonly delivered: number;
  readonly window: number;
  readonly capped: boolean;
  /** HP factor most of the wave got, and per type. */
  readonly shared: number;
  readonly hpMult: Readonly<Record<string, number>>;
  /** HP of the wave's bodies as shipped. */
  readonly hp: number;
  /** HP of its boss (isBoss type), 0 without. */
  readonly bossHp: number;
  /** HP of the strongest non-boss body. */
  readonly escortHp: number;
  /**
   * The boss's HP over what the defense realises on it alone while it walks
   * past: from 1/single on it gets through whole (model.ts). 0 without boss.
   */
  readonly bossThreat: number;
  /** Seconds of the start defense's matrix damage the wave's HP are. */
  readonly dpsSeconds: number;
  readonly load: number;
  readonly leak: number;
  readonly hpStart: number;
  readonly hpEnd: number;
  /** Recorded in the run, for the side-by-side. */
  readonly recorded: { readonly hpEnd: number; readonly regulator: number; readonly shared: number };
}

function snapshot(dps: EffectiveDPSPerArmor, metres: number, towerShare: number, lives: number, wave: number): GameStateSnapshot {
  const state = createEmptySnapshot();
  state.waveNumber = wave - 1;
  state.player.lives = lives;
  state.player.maxLives = 500;
  state.defense.effectiveDPSPerArmor = dps;
  state.defense.damageMetres = scaleArmor(dps, towerShare * metres);
  state.defense.metresUnderFire = { ground: metres, air: metres };
  return state;
}

export function runScenario(trajectory: Trajectory, options: ScenarioOptions): WaveRow[] {
  const source = new BudgetWaveSource();
  const random = mulberry32(1);
  const metres = new Map(trajectory.waves.map((w) => [w.wave, w.metres]));
  const model: LeakModel = {
    ...options.model,
    ground: options.model.ground * options.strength,
    air: options.model.air * options.strength,
    ethereal: options.model.ethereal * options.strength,
  };
  const rows: WaveRow[] = [];
  let hp = trajectory.startHealth;
  for (const w of trajectory.waves) {
    if (options.lastWave !== undefined && w.wave > options.lastWave) break;
    if (hp <= 0) break;
    // The plan's metres: measured at the end of the wave before; at the start the next wave's
    // reading (towers bought in the break and during the wave counted)
    const planMetres = metres.get(w.wave)!;
    const startMetres = metres.get(w.wave + 1) ?? planMetres;
    const planDps = defenseDps(w.plan);
    const startDps = defenseDps(w.start);
    const planState = snapshot(planDps, planMetres, options.model.towerShare, hp, w.wave);
    const startState = snapshot(startDps, startMetres, options.model.towerShare, hp, w.wave);
    let planned: PlannedWave = source.plan({ wave: w.wave, state: planState, random });
    if (source.sizeAtStart) planned = source.sizeAtStart(planned, { wave: w.wave, state: startState, random });
    const config = planned.config;
    const bodies = waveBodies(w.wave, config);
    const leak = estimateLeak(w.wave, bodies, startDps, startMetres, model);
    const recordedLoss = Math.max(0, w.actual.healthStart - w.actual.healthEnd);
    const buildUp = w.wave <= options.model.buildUpWaves ? recordedLoss : 0;
    const loss = options.recordedLoss ? recordedLoss : Math.min(hp, leak.hp + buildUp);
    const spawned = bodies.reduce((sum, b) => sum + b.n, 0);
    let dpsSeconds = 0;
    for (const b of bodies) {
      const d = startDps[b.air ? 'air' : 'ground'][b.armor];
      if (d > 0) dpsSeconds += (b.n * b.hp) / d;
    }
    const isBoss = (type: string) => ENEMY_TYPES[type as EnemyTypeId]?.isBoss === true;
    const diag = planned.log.diagnostics ?? {};
    const hpMult = Object.fromEntries(config.enemies.map((g) => [g.type, g.healthMultiplier ?? 1]));
    rows.push({
      wave: w.wave,
      name: config.templateName ?? '',
      regulator: planned.log.pressureMultiplier ?? 1,
      budget: Number(diag['budget'] ?? 0),
      delivered: Number(diag['delivered'] ?? 0),
      window: Number(diag['window'] ?? 0),
      capped: diag['capped'] === true,
      shared: config.templateStrength ?? 1,
      hpMult,
      hp: bodies.reduce((sum, b) => sum + b.n * b.hp, 0),
      bossHp: bodies.filter((b) => isBoss(b.type)).reduce((sum, b) => sum + b.n * b.hp, 0),
      escortHp: Math.max(0, ...bodies.filter((b) => !isBoss(b.type)).map((b) => b.hp)),
      bossThreat: Math.max(0, ...bodies.filter((b) => isBoss(b.type))
        .map((b) => b.hp / (realisedDps(b, startDps, model) * bodyFire(b, startMetres, model)))),
      dpsSeconds,
      load: leak.load,
      leak: loss,
      hpStart: hp,
      hpEnd: hp - loss,
      recorded: { hpEnd: w.actual.healthEnd, regulator: w.actual.regulator, shared: Math.max(...w.actual.composition.map((c) => c.hp)) },
    });
    const result = {
      waveNumber: w.wave,
      timestamp: 0,
      config,
      outcome: { damageToPlayer: loss, healthAtWaveStart: hp, enemiesSpawned: spawned },
    } as unknown as WaveResult;
    source.onWaveResult(result);
    hp -= loss;
  }
  return rows;
}
