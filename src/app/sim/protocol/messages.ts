/**
 * The simulation's interface (docs/SIM_WORKER.md): SimCore implements it in
 * the worker (sim/worker/sim.worker.ts) and, for the specs, in the same
 * thread. The main thread's SimClient talks to it only through these calls.
 */
import type { GeoPosition, RouteWaypoint } from '../../models/game.types';
import type { SpawnPoint } from '../../managers/wave.manager';
import type { CommandData } from '../../managers/game-state/command-data';
import type { StampedCommand } from '../../coop/lockstep';
import type { SimFramePacket } from './packet';
import type { ReplayMarker } from '../../replay/replay-bar-view';
import type { WireFrame } from './wire';

/**
 * The world the simulation stands on, from the finished world on the main
 * thread (the corridor build or a coop package): no tiles, no sampling.
 */
export interface SimWorld {
  origin: GeoPosition;
  hq: GeoPosition;
  spawns: SpawnPoint[];
  /** Spawn id and its route */
  paths: [string, RouteWaypoint[]][];
  /** GlobalRouteGrid.exportHeights: [cell key, height, state] */
  heights: [number, number, number][];
  /** The main thread's world key; the simulation's must come out the same */
  worldKey: string;
  /** Ground under each spawn point (geo height), for spawns the grid has no cell for; null where the tiles had none */
  spawnGround: Record<string, number | null>;
}

/** A command from the main thread's bus, with the player who gave it. */
export interface QueuedCommand {
  playerId: string;
  command: CommandData;
}

/** Coop: what the relay delivered since the last input (the worker's LockstepLink reads it). */
export interface LockstepDelivery {
  confirmedTick: number;
  ticks: { tick: number; commands: readonly StampedCommand[] }[];
}

/**
 * What the main thread gives the simulation (docs/SIM_DECOUPLE_PLAN.md): sent
 * when something of it changed or commands came, not per frame. The
 * simulation keeps the settings until the next one.
 */
export interface SimInput {
  gameSpeed: number;
  paused: boolean;
  /** The renderers show the packets; off in headless training tabs */
  renderingEnabled: boolean;
  /** In the order they were given; they act at once, at the boundary between two sub-steps */
  commands: QueuedCommand[];
  /** Coop: the ticks the relay closed since the last input, null when there is no news */
  lockstep: LockstepDelivery | null;
  /**
   * While a replay is on (rpc replayEnter): play it at `speed` times the
   * wall clock (the backlog capped like the game clock's) instead of the
   * live game; `playing` false holds it. Null for the live game.
   */
  replay: { playing: boolean; speed: number } | null;
}

/** What the simulation sends besides frames. */
export type SimOutput =
  | { kind: 'lockstep-send'; command: CommandData }
  | { kind: 'lockstep-hash'; tick: number; hash: number; parts?: readonly number[] }
  | { kind: 'lockstep-frame'; steps: number; blocked: boolean; behind: number }
  | { kind: 'lockstep-ran'; count: number };

export interface SimCoreApi {
  /** Settings of the run that come from the main thread (wave source, dev flags); see SimConfig */
  configure(config: SimConfig): void;
  /**
   * Build the world and start a fresh run on it (the seed stays unless reset
   * gives another); before it the simulation runs no sub-step
   */
  loadWorld(world: SimWorld): void;
  /** The world goes (a new place is being built): no sub-step until the next loadWorld */
  unloadWorld(): void;
  /** Where the simulation's messages besides packets go (SimOutput) */
  output(out: (message: SimOutput) => void): void;
  /** Settings and commands at the wall clock `now`; the commands act before this returns */
  input(input: SimInput, now: number): void;
  /**
   * One pass of the loop at the wall clock `now`: the sub-steps due, none
   * started after `deadline` (performance.now()), then the packet. Null when
   * nothing ran and nothing changed.
   */
  pass(now: number, deadline?: number): SimFramePacket | null;
  /** Wall ms until the next pass has work: 0 at once, Infinity until a message comes */
  idleMs(): number;
  /** Everything else, by name (see SimRpc) */
  rpc<K extends keyof SimRpc>(method: K, ...args: Parameters<SimRpc[K]>): ReturnType<SimRpc[K]>;
}

export interface SimConfig {
  /** WaveSourceId whose rules the simulation reads (setActiveWaveRules) */
  waveSource?: string;
  /** Coop roster, local player, lanes, cheat rule, line-of-sight role */
  players?: { players: string[]; local: string };
  lanes?: [string, string][];
  cheatsFor?: string[] | 'all' | null;
  /** Coop: players out of the run (the relay was lost and this client goes on alone): their lanes close */
  playersLeft?: string[];
  lockstep?: { hashEvery?: number } | null;
  /** Debug: enemies stand still (display option `movement`) */
  movementEnabled?: boolean;
  /** Debug: damage numbers (display option) */
  damageNumbers?: boolean;
  /**
   * The main thread rebuilds the route corridor: no tower is placed and no
   * wave starts until it is false again (GameStateManager.corridorPending)
   */
  corridorPending?: boolean;
  /**
   * The perf panel is open: time the simulation by part (rpc profileSums).
   * Off, the sub-steps take no timer (TODO E82)
   */
  profile?: boolean;
}

/** One row of `__towerTargets()` (services/debug/tower-target-console.ts, towerTargetRows) */
export interface TowerTargetRow {
  tower: string;
  why: string;
  sleeping: boolean;
  visibleCells: number;
}

/**
 * Calls with an answer; SimClient.rpc sends them and resolves the promise
 * with the reply. Filled by the simulation side as the main thread needs them.
 */
export interface SimRpc {
  reset(seed?: number): void;
  worldKey(): string;
  stateHash(): number;
  hashBreakdownAt(tick: number): unknown;
  captureWaveSnapshot(): unknown;
  restoreWaveSnapshot(snapshot: unknown, reason: 'replay' | 'live'): void;
  /** The run's (or the loaded file's) replayable waves as a replay file's text; null when there is none */
  replayFile(head: { configHash: string; gameVersion: string; commit: string }): { text: string; waves: number[] } | null;
  loadReplayFile(text: string, here: { configHash: string; gameVersion: string }): { refusal: string | null; note: string | null; waves: number[] };
  /**
   * Keep the live state, put the simulation at the wave's start in replay
   * mode. `file`: a replay file's text read before (loadReplayFile) instead
   * of the run's own record. Null when the wave cannot be re-simulated.
   */
  replayEnter(wave: number, fromFile: boolean): ReplayEntered | null;
  /** Jump to `stepInWave` without the show (VFX, sounds muted), forward or from the start */
  replaySeek(stepInWave: number): void;
  /** Give the live game back as it was, leave replay mode */
  replayExit(): void;
  commandLog(): unknown[];
  /** Where the last pass's time went, ms: the commands since the one before, the sub-steps, the packet, and the slowest command */
  tickProfile(): TickProfile;
  /** The simulation by part since the last call, null while SimConfig.profile is off */
  profileSums(): SimProfileSums | null;
  /** `__towerTargets()` (services/debug/tower-target-console.ts): towerTargetRows over the towers and the living enemies */
  towerTargets(): TowerTargetRow[];
  /** `__towerTargets.watch()`: explainTowerTarget of every tower for the enemies `enemyIds` (an ooze's clumps), the lines not null */
  towerTargetLines(enemyIds: string[]): string[];
  /**
   * Tests of the coop resync (e2e/coop-bots/run.ts --falsify-at-wave): `amount` gold for the local player past the
   * lockstep, so this client's state leaves the room's and the relay repairs it (COOP_PLAN C5b). Changes this client only.
   */
  falsifyCredits(amount: number): void;
}

/** The simulation by part (rpc profileSums, sim/core/sim-profile.ts): sums over the passes since the last call, ms unless said otherwise */
export interface SimProfileSums {
  ticks: number;
  /** Sub-steps run in them */
  subSteps: number;
  /** Whole passes, as SimScalars.tickMs */
  tickMs: number;
  /** The commands, at the boundary they came in at */
  commandsMs: number;
  /** GameStateManager.update: the sub-steps */
  updateMs: number;
  /** Writing the packet (PacketWriter) */
  packetMs: number;
  /** Inside the sub-steps: the enemy loop and its sampled phases */
  enemyMs: number;
  enemyMoveMs: number;
  enemyGridMs: number;
  enemyHeightMs: number;
  projectileMs: number;
  combatMs: number;
  eventsMs: number;
}

/** The parts of a pass's time (rpc tickProfile) */
export interface TickProfile {
  commandsMs: number;
  updateMs: number;
  packetMs: number;
  slowest: { type: string; ms: number } | null;
  /** The slowest pass since the world was loaded, its parts as above */
  worst?: Omit<TickProfile, 'worst'> & { tickMs: number; stepsRun: number };
}

/** What the replay bar needs of a wave the simulation entered (rpc replayEnter). */
export interface ReplayEntered {
  wave: number;
  lengthInSteps: number | null;
  startStep: number;
  /** commandMarkers() of the wave's log (replay/replay-bar-view.ts) */
  markers: ReplayMarker[];
  /** The waves the bar can switch to, oldest first: the file's, or the run's replayable ones */
  waves: number[];
}

// ── Worker messages ──

export type ToWorker =
  | { kind: 'configure'; config: SimConfig }
  | { kind: 'world'; world: SimWorld }
  | { kind: 'unload' }
  /** The run the packets from here on belong to (SimClient.newRun) */
  | { kind: 'epoch'; epoch: number }
  | { kind: 'input'; input: SimInput }
  | { kind: 'rpc'; id: number; method: keyof SimRpc; args: unknown[] };

export type FromWorker =
  | { kind: 'ready' }
  | { kind: 'frame'; frame: WireFrame; epoch: number }
  | { kind: 'output'; message: SimOutput }
  | { kind: 'rpc-reply'; id: number; ok: true; value: unknown }
  | { kind: 'rpc-reply'; id: number; ok: false; error: string }
  | { kind: 'error'; error: string };
