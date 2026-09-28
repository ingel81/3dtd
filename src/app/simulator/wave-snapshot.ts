import type { PlainRecord } from './plain-fields';
import type { SimSnapshot } from './sim-snapshot';
import type { WaveConfig } from '../managers/wave.manager';
import type { EnemyTypeId } from '../configs/enemy-types.config';
import type { ProjectileTypeId } from '../configs/projectile-types.config';
import type { TowerTypeId } from '../configs/tower-types.config';
import type { DamageType } from '../configs/combat/combat.types';

/** Bumped whenever the shape changes; another version is refused. */
export const WAVE_SNAPSHOT_VERSION = 1;

/**
 * The simulation at any sub-step boundary, a wave running included, as
 * JSON-safe data (TODO E58, COOP_PLAN C5b): the snapshot between waves plus
 * what only lives while a wave runs. Taken with
 * GameStateManager.captureWaveSnapshot(), put back into a simulation on the
 * same world with restoreWaveSnapshot(); from there both run on bit for bit
 * alike.
 *
 * Not in it yet (waveSnapshotRefusal says so): worms, oozes, strikes on
 * their way, a hero's target, manned towers. Presentation is not in it at
 * all: models, sounds, trails and status auras come back from the restored
 * state or not at all.
 */
export interface WaveSnapshot {
  version: number;
  /** Towers, research, abilities, heroes, credits, clock, random streams and ids, as between waves */
  base: SimSnapshot;
  /** The running wave, null between waves */
  wave: WaveRunState | null;
}

export interface WaveRunState {
  /** The wave's plan as the start command built it (WaveManager.startWave) */
  config: WaveConfig;
  spawner: SpawnerState | null;
  counters: PlainRecord;
  enemies: EnemiesState;
  projectiles: SavedProjectile[];
  /** [tower id, target enemy id] of every tower with a target */
  towerTargets: [string, string][];
  /** Events waiting for the next sub-step, those of plain data (a wave:completed, a sound); one holding an entity is presentation and left out */
  deferred: unknown[];
}

/** WaveManager's spawner between two sub-steps */
export interface SpawnerState {
  waveId: number;
  accumulatedMs: number | string;
  nextDelayMs: number | string;
  spawnIndex: number;
  consecutiveFailures: number;
}

export interface EnemiesState {
  /** In the order the enemy manager holds them; dying ones included */
  enemies: SavedEnemy[];
  /** [enemy id, game ms left] of the death animations under way, in their order */
  pendingDeaths: [string, number | string][];
  /** The ids of enemies being killed, in set order */
  killing: string[];
  /** Kill gold bookkeeping of the wave */
  rewards: PlainRecord;
  /** [cell key, enemy ids] of every route grid cell with enemies, each in set order */
  cells: [number, string[]][];
  /** Enemies out of the manager (a leak, a finished death) that a shot or a tower still holds */
  ghosts: SavedEnemy[];
}

export interface SavedEnemy {
  id: string;
  typeId: EnemyTypeId;
  /** The spawn point whose route it walks */
  pathId: string;
  entity: PlainRecord;
  /** The route grid memo of its cell is current (routeCellGen) */
  cellCurrent: boolean;
  position: PlainRecord;
  transform: PlainRecord;
  health: PlainRecord;
  movement: PlainRecord;
  statusEffects: PlainRecord[];
  rush: PlainRecord | null;
  portalExit: PlainRecord | null;
}

export interface SavedProjectile {
  id: string;
  typeId: ProjectileTypeId;
  /** Null for a free shot (a manned tower's miss) */
  targetId: string | null;
  sourceTowerId: string;
  sourceTowerType: TowerTypeId | null;
  damageType: DamageType;
  aimPoint: PlainRecord | null;
  entity: PlainRecord;
  position: PlainRecord;
  direction: PlainRecord;
  lastTargetPosition: PlainRecord | null;
  transform: PlainRecord;
  combat: PlainRecord;
  movement: PlainRecord;
}

/** Why the state now cannot be a wave snapshot yet, null when it can. */
export type WaveSnapshotRefusal = 'worm' | 'ooze' | 'pending-strike' | 'hero-target' | 'manned' | 'debug-enemies';
