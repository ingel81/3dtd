/**
 * The frame packet: everything the simulation hands the main thread after one
 * update (docs/SIM_WORKER.md). Built in the simulation (SimCore), read by the
 * main thread (SimClient: mirror, presentation). The same object whether the
 * simulation runs in the worker (sent with its buffers transferred) or, for the
 * specs, in the same thread.
 *
 * Tables are Float64Array rows of a fixed stride (lat and lon need doubles);
 * `count` rows are valid. Ids of entities are the numeric part of their
 * GameObject id (`enemy-123` is 123), see entityNum().
 */
import { PROJECTILE_TYPES, type ProjectileTypeId } from '../../configs/projectile-types.config';
import type { PresentationOp } from './ops';
import type { ExportedEvent } from './events';
import type { LosMaskJson } from '../../utils/los-mask';
import { ENEMY_TYPES } from '../../configs/enemy-types.config';

// ── Enemies: every active enemy, dead ones in their death animation included ──
export const E_ID = 0;
export const E_LAT = 1;
export const E_LON = 2;
/** Ground under the enemy, geo height (transform.terrainHeight) */
export const E_TERRAIN = 3;
/** Height over the ground (heightOffset): air units, portal exit */
export const E_HOFF = 4;
/** transform.rotation, rad */
export const E_ROT = 5;
export const E_HP = 6;
export const E_MAXHP = 7;
/** Speed the walk cycle shows: speedMps · speedMultiplier · slow, m/s */
export const E_ANIM_SPEED = 8;
export const E_FLAGS = 9;
/** movement.getPathProgress(), 0..1 */
export const E_PROGRESS = 10;
/** movement.getDistanceAlongPath(), m */
export const E_DIST = 11;
/** movement.getEffectiveSpeed(), m/s */
export const E_EFF_SPEED = 12;
/** Index of the enemy's route in SimWorldInfo.spawns (the spawn id its path belongs to), -1 for none */
export const E_ROUTE = 13;
/** Index of the enemy's type in ENEMY_TYPE_IDS: the mirror builds a view from a row it has no reference for */
export const E_TYPE = 14;
export const ENEMY_STRIDE = 15;

/** Enemy type ids in config order, for E_TYPE */
export const ENEMY_TYPE_IDS: readonly string[] = Object.keys(ENEMY_TYPES);

export const EF_ALIVE = 1;
export const EF_ACTIVE = 2;
/** An ooze: drawn by the ooze renderer, no instance */
export const EF_BODY = 4;
/** Has a rush (Enemy.rush), see EF_RUNNING */
export const EF_RUSH = 8;
export const EF_RUNNING = 16;
export const EF_SLOWED = 32;
export const EF_FROZEN = 64;
export const EF_STUNNED = 128;
export const EF_POISONED = 256;
export const EF_BURNING = 512;
/** Walking (Enemy.isMoving): its moving sound loops */
export const EF_MOVING = 1024;
/** movement.hasStatusEffects */
export const EF_ANY_STATUS = 2048;
/** A boss in its rage (Enemy.enraged): tinted red */
export const EF_ENRAGED = 4096;
/** An elite (Enemy.elite): bigger and gold */
export const EF_ELITE = 8192;

// ── Projectiles in flight ──
export const P_ID = 0;
export const P_LAT = 1;
export const P_LON = 2;
/** flightHeight, geo */
export const P_HEIGHT = 3;
export const P_DX = 4;
export const P_DY = 5;
export const P_DZ = 6;
export const P_FLAGS = 7;
/** Index into PROJECTILE_TYPE_IDS */
export const P_TYPE = 8;
export const PROJECTILE_STRIDE = 9;
/** Homing or arcing: the model turns along `direction` */
export const PF_ROTATES = 1;
/** Projectile types by P_TYPE, in the config's order */
export const PROJECTILE_TYPE_IDS = Object.keys(PROJECTILE_TYPES) as readonly ProjectileTypeId[];

// ── Towers: every standing tower ──
export const T_ID = 0;
/** aim.current, rad */
export const T_AIM = 1;
/** aim.pitch, rad */
export const T_PITCH = 2;
export const T_KILLS = 3;
export const T_DAMAGE = 4;
/** combat cooldown left, ms */
export const T_COOLDOWN = 5;
export const T_FLAGS = 6;
export const TOWER_STRIDE = 7;
export const TF_LOS_READY = 1;
export const TF_HOLD_FIRE = 2;
export const TF_MANNED = 4;
export const TF_TRIGGER = 8;
export const TF_SLEEPING = 16;
/** A manned tower's crosshair is on an enemy it may shoot (TowerCombatService.mannedAimTargetOf) */
export const TF_ON_TARGET = 32;

// ── Oozes (enemies with a body) ──
export const O_ID = 0;
export const O_TAIL = 1;
export const O_TIP = 2;
/** healthPercent, 0..1 */
export const O_HP = 3;
export const O_FLAGS = 4;
export const OOZE_STRIDE = 5;
export const OF_SLOWED = 1;
export const OF_POISONED = 2;
export const OF_BURNING = 4;
export const OF_FROZEN = 8;
export const OF_STUNNED = 16;

// ── Worm chains, one row per chain of a group ──
export const W_GROUP = 0;
export const W_CHAIN = 1;
/** Enemy id of the chain's head segment, -1 when none alive */
export const W_HEAD = 2;
export const W_REMAINING = 3;
export const W_SEQ = 4;
export const W_SIZE = 5;
/** HP left over the whole group (WormGroup.hp()), the same on every row of the group */
export const W_HP = 6;
/** WormGroup.maxHp, the same on every row of the group */
export const W_MAXHP = 7;
export const WORM_STRIDE = 8;

/** A table: rows of `stride` numbers, `count` of them valid. */
export interface SimTable {
  data: Float64Array;
  count: number;
}

/** The hero of one seat as the renderer shows it; `present` null while not hired. */
export interface HeroFrame {
  heroId: string;
  playerId: string;
  present: {
    lat: number;
    lon: number;
    heading: number;
    pose: 'idle' | 'run' | 'shoot' | 'run-shoot';
    anchor: { lat: number; lon: number; height: number };
  } | null;
}

/** Numbers the main thread reads every frame (the old synchronous reads of the GameStateManager). */
export interface SimScalars {
  subStep: number;
  gameTimeMs: number;
  phase: 'setup' | 'wave' | 'gameover';
  waveNumber: number;
  baseHealth: number;
  /** Roster order */
  players: string[];
  localPlayerId: string;
  /** Credits per player, roster order */
  credits: number[];
  enemiesAlive: number;
  /** SimSnapshots refusal, null when a snapshot may be taken now */
  snapshotRefusal: string | null;
  waveSnapshotRefusal: string | null;
  lockstepActive: boolean;
  paused: boolean;
  gameSpeed: number;
  /** Tower each player sits in, roster order, null for none */
  mannedTowers: (string | null)[];
  /** Ready for the next wave, roster order */
  ready: boolean[];
  /** The spawn point of each lane, roster order (alone every spawn point), and the player of each */
  laneSpawns: string[];
  laneOwners: string[];
  /** Wave numbers a replay can re-simulate (SimRecorder), newest last */
  replayableWaves: number[];
  towerCount: number;
  /** HP the abilities of each player took from enemies so far, roster order (CombatEffectService.abilityDamageOf; the run log) */
  abilityDamage: number[];
  /** The replay while one is on, null for the live game */
  replay: {
    wave: number;
    stepInWave: number;
    lengthInSteps: number | null;
    divergedAt: number | null;
    finished: boolean;
    /** A seek running (SimReplay.seek): the step it runs to and the one it began at, for the bar's progress */
    seeking: { target: number; from: number } | null;
  } | null;
  /**
   * Wall-clock ms the simulation spent on this packet: the commands since
   * the one before, the pass's sub-steps and the packet itself (the second
   * number besides the frame time; per sub-step divide by the packet's
   * stepsRun). Summed over the packets and divided by the wall clock, the
   * share of its time the simulation computes
   */
  tickMs: number;
  /** The run's seed (GameRng.seed): the main thread's wave source and bot draw their own streams from it */
  seed: number;
}

/**
 * A tower's whole state for the main thread's shadow tower
 * (sim/client/mirror): sent when the tower is placed and whenever something
 * other than the per-frame numbers (T_*) changed.
 */
export interface TowerStateDto {
  id: string;
  typeId: string;
  ownerId: string;
  position: { lat: number; lon: number; height: number };
  customRotation: number;
  plinthHeight: number;
  plinthOverhang: readonly number[];
  upgrades: [string, number][];
  /** Tower.getSimState() as plain data */
  sim: Record<string, unknown>;
  /** combat values the panels read, after upgrades and research */
  combat: { range: number; damage: number; fireRate: number };
  losReady: boolean;
  /**
   * The tower's line of sight when it changed since the last state sent (a
   * mask applied, a restore): the main thread writes it into its own grid
   * (viz, the wave source's coverage numbers). Null when the tower has none
   * any more; absent when unchanged.
   */
  losMask?: LosMaskJson | null;
}

export interface SimFramePacket {
  /** Running number of the packet */
  frame: number;
  /** Sub-steps run in this pass */
  stepsRun: number;
  /** Tables hold this packet's state for the renderers (stepsRun > 0 and rendering on) */
  presented: boolean;
  scalars: SimScalars;
  enemies: SimTable;
  projectiles: SimTable;
  towers: SimTable;
  oozes: SimTable;
  worms: SimTable;
  heroes: HeroFrame[];
  /** Towers whose state changed (placed, upgraded, settings, line of sight) */
  towerStates: TowerStateDto[];
  /** Towers gone since the last packet */
  removedTowers: string[];
  /** Renderer calls in the order the simulation made them */
  ops: PresentationOp[];
  /** Simulation events in emit order, entities as references */
  events: ExportedEvent[];
}

/** 123 from 'enemy-123'. */
export function entityNum(id: string): number {
  return Number(id.slice(id.lastIndexOf('-') + 1));
}
