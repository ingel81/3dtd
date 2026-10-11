/**
 * One player on N lanes (a custom map with many spawns): the real budget
 * source plans each lane's wave as the game does (the defense's share 1/N,
 * the HQ's share 1/N, `lanes` in the snapshot), every lane gets the wave, and
 * the losses of all lanes come off the one HQ. Levers: the player's gold
 * (start and kill gold are paid per lane: `economy` N), the share of a
 * one-lane wave each lane gets (`laneScaling` 'sqrt': 1/sqrt(N) of the bodies, as the w3x import does),
 * and the share of a leak the HQ takes (`leakShare`). README.md has the
 * model; docs/CUSTOM_MAP_WORLD.md the result.
 */

import { createEmptySnapshot, type EffectiveDPSPerArmor, type GameStateSnapshot } from '../../src/app/director/models/game-state-snapshot';
import type { WaveResult } from '../../src/app/director/models/wave-result';
import type { PlannedWave } from '../../src/app/director/wave-source';
import { BudgetWaveSource } from '../../src/app/director/sources/budget/budget-source';
import { mulberry32 } from '../../src/app/utils/game-rng';
import { defenseDps, estimateLeak, scaleArmor, waveBodies, type LeakModel } from './model';
import type { Trajectory } from './trajectory';
/** How each lane's wave shrinks: the whole wave, or 1/sqrt(N) of its bodies (variant (a); the game has no such option) */
export type LaneScaling = 'none' | 'sqrt';

export interface LaneOptions {
  readonly lanes: number;
  /** The player's defense over the recorded one-lane run's: N where start and kill gold come per lane */
  readonly economy: number;
  /** How each lane's wave shrinks (the budget source's LaneScaling): the whole wave, or 1/sqrt(N) of its bodies */
  readonly laneScaling: LaneScaling;
  /** Share of a leak's damage the HQ takes: 1, or 1/N */
  readonly leakShare: number;
  readonly model: LeakModel;
  readonly lastWave?: number;
}

export interface LaneRow {
  readonly wave: number;
  readonly regulator: number;
  /** Bodies of all lanes */
  readonly bodies: number;
  /** One lane's load (seconds of realised damage needed over seconds under fire) */
  readonly load: number;
  readonly loss: number;
  readonly hpEnd: number;
}

function snapshot(dps: EffectiveDPSPerArmor, metres: number, towerShare: number, lives: number, wave: number, lanes: number): GameStateSnapshot {
  const state = createEmptySnapshot();
  state.waveNumber = wave - 1;
  state.player.lives = lives;
  state.player.maxLives = 500;
  state.defense.effectiveDPSPerArmor = dps;
  state.defense.damageMetres = scaleArmor(dps, towerShare * metres);
  state.defense.metresUnderFire = { ground: metres, air: metres };
  if (lanes > 1) state.lanes = lanes;
  return state;
}

/**
 * The run on N lanes: the recorded defense times `economy`, spread evenly
 * over the lanes (every route sees 1/N of it, the metres one route has under
 * fire as in the run). The build-up waves (model.buildUpWaves) cost their
 * recorded one-lane loss per lane, times the lane's share of bodies.
 */
export function runLanes(trajectory: Trajectory, options: LaneOptions): LaneRow[] {
  const { lanes, economy, laneScaling, leakShare, model } = options;
  const source = new BudgetWaveSource();
  const share = laneScaling === 'sqrt' ? 1 / Math.sqrt(lanes) : 1;
  // Variant (a): each lane gets 1/sqrt(N) of the planned bodies, at least one of a type, HP as sized
  const shrink = (wave: PlannedWave): PlannedWave => share === 1 ? wave : {
    ...wave,
    config: { ...wave.config, enemies: wave.config.enemies.map((g) => ({ ...g, count: Math.max(1, Math.round(g.count * share)) })) },
  };
  const random = mulberry32(1);
  const metres = new Map(trajectory.waves.map((w) => [w.wave, w.metres]));
  const perLane = economy / lanes;
  const rows: LaneRow[] = [];
  let hp = trajectory.startHealth;
  for (const w of trajectory.waves) {
    if (options.lastWave !== undefined && w.wave > options.lastWave) break;
    if (hp <= 0) break;
    const planMetres = metres.get(w.wave)!;
    const startMetres = metres.get(w.wave + 1) ?? planMetres;
    // One lane's share of the defense, as StateSnapshotService.shareDefense gives the planner
    const planDps = scaleArmor(defenseDps(w.plan), perLane);
    const startDps = scaleArmor(defenseDps(w.start), perLane);
    let planned: PlannedWave = source.plan({ wave: w.wave, state: snapshot(planDps, planMetres, model.towerShare, hp, w.wave, lanes), random });
    if (source.sizeAtStart) {
      planned = source.sizeAtStart(planned, { wave: w.wave, state: snapshot(startDps, startMetres, model.towerShare, hp, w.wave, lanes), random });
    }
    planned = shrink(planned);
    const bodies = waveBodies(w.wave, planned.config, startMetres);
    const leak = estimateLeak(w.wave, bodies, startDps, startMetres, model);
    const recorded = Math.max(0, w.actual.healthStart - w.actual.healthEnd);
    const buildUp = w.wave <= model.buildUpWaves ? recorded * share : 0;
    const loss = Math.min(hp, lanes * (leak.hp + buildUp) * leakShare);
    const spawned = lanes * bodies.reduce((sum, b) => sum + b.n, 0);
    rows.push({ wave: w.wave, regulator: planned.log.pressureMultiplier ?? 1, bodies: spawned, load: leak.load, loss, hpEnd: hp - loss });
    source.onWaveResult({
      waveNumber: w.wave,
      timestamp: 0,
      config: planned.config,
      outcome: { damageToPlayer: loss, healthAtWaveStart: hp, enemiesSpawned: spawned },
    } as unknown as WaveResult);
    hp -= loss;
  }
  return rows;
}
