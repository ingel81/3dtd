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

/** Coop: what the relay delivered since the last tick (the worker's LockstepLink reads it). */
export interface LockstepDelivery {
  confirmedTick: number;
  ticks: { tick: number; commands: readonly StampedCommand[] }[];
}

/** One frame's input. */
export interface SimTickInput {
  /** performance.now() of the main thread's frame */
  now: number;
  gameSpeed: number;
  paused: boolean;
  /** The renderers show the frame; off in headless training tabs */
  renderingEnabled: boolean;
  /** In the order they were given; they act at the boundary before this frame's first sub-step */
  commands: QueuedCommand[];
  lockstep: LockstepDelivery | null;
}

/** What the simulation sends besides frames. */
export type SimOutput =
  | { kind: 'lockstep-send'; command: CommandData }
  | { kind: 'lockstep-hash'; tick: number; hash: number; parts?: readonly number[] }
  | { kind: 'lockstep-frame'; steps: number; blocked: boolean; behind: number };

export interface SimCoreApi {
  /** Settings of the run that come from the main thread (wave source, dev flags); see SimConfig */
  configure(config: SimConfig): void;
  /** Build the world; before it the simulation runs no sub-step */
  loadWorld(world: SimWorld): void;
  /** One frame: commands in, sub-steps, the packet out */
  tick(input: SimTickInput, out: (message: SimOutput) => void): SimFramePacket;
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
  lockstep?: { hashEvery?: number } | null;
  /** Debug: enemies stand still (display option `movement`) */
  movementEnabled?: boolean;
  /** Debug: damage numbers (display option) */
  damageNumbers?: boolean;
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
  replayFile(head: { configHash: string; gameVersion: string; commit: string }): string;
  loadReplayFile(text: string, here: { configHash: string; gameVersion: string }): { refusal: string | null; note: string | null; waves: number[] };
  replayEnter(wave: number): { lengthInSteps: number | null } | null;
  replayStep(steps: number): { stepInWave: number; finished: boolean; divergedAt: number | null };
  replaySeek(stepInWave: number): { stepInWave: number };
  replayExit(): void;
  commandLog(): unknown[];
}

// ── Worker messages ──

export type ToWorker =
  | { kind: 'configure'; config: SimConfig }
  | { kind: 'world'; world: SimWorld }
  | { kind: 'tick'; input: SimTickInput }
  | { kind: 'rpc'; id: number; method: keyof SimRpc; args: unknown[] };

export type FromWorker =
  | { kind: 'ready' }
  | { kind: 'frame'; frame: WireFrame }
  | { kind: 'output'; message: SimOutput }
  | { kind: 'rpc-reply'; id: number; ok: true; value: unknown }
  | { kind: 'rpc-reply'; id: number; ok: false; error: string }
  | { kind: 'error'; error: string };
