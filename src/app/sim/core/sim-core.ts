/**
 * The simulation behind SimCoreApi (docs/SIM_WORKER.md): the GameStateManager
 * with its sim services, built in an Injector of its own (no platform, no
 * app, no root lookups), a world from the main thread, one frame per tick
 * and a packet out. Runs in the worker (sim/worker/sim.worker.ts) and, for
 * the specs, in the same thread.
 */
import { Injector, type StaticProvider } from '@angular/core';
import { GameStateManager } from '../../managers/game-state.manager';
import { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import { SpatialGridService } from '../../services/world/spatial-grid.service';
import { StatusEffectService } from '../../services/combat/status-effect.service';
import { CombatVfxService } from '../../services/combat/combat-vfx.service';
import { DamageApplicationService } from '../../services/combat/damage-application.service';
import { CombatEffectService } from '../../services/combat/combat-effect.service';
import { TowerCombatService } from '../../services/combat/tower-combat.service';
import { EconomyService } from '../../services/economy.service';
import type { GameEvent } from '../../game-engine/game-event-bus';
import { setActiveWaveRules } from '../../director/wave-rules';
import { createWaveSource, isWaveSourceId } from '../../director/wave-source.registry';
import { buildReplayFile, readReplayFile, type ReplayFile } from '../../simulator/replay-file';
import { replayable, type WaveRecord } from '../../simulator/sim-recorder';
import type { WaveSnapshot } from '../../simulator/wave-snapshot';
import type { CommandLogEntry } from '../../managers/game-state/command-log';
import { commandMarkers } from '../../replay/replay-bar-view';
import type { ExportedEvent } from '../protocol/events';
import type { SimFramePacket } from '../protocol/packet';
import type {
  ReplayEntered, SimConfig, SimCoreApi, SimOutput, SimRpc, SimTickInput, SimWorld,
} from '../protocol/messages';
import { TableStore } from '../protocol/table-store';
import { SimCoords } from './sim-coords';
import { SimOps } from './sim-sink';
import { PacketWriter } from './packet-writer';
import { exportEvents } from './event-export';
import { DeliveredLink } from './delivered-link';
import { SimReplay } from './sim-replay';

/** Every service of the simulation, each made by its own constructor in the simulation's injector. */
export const SIM_PROVIDERS: StaticProvider[] = [
  { provide: SimCoords, useFactory: () => new SimCoords(), deps: [] },
  { provide: SimOps, useFactory: () => new SimOps(), deps: [] },
  { provide: GlobalRouteGridService, useFactory: () => new GlobalRouteGridService(), deps: [] },
  { provide: SpatialGridService, useFactory: () => new SpatialGridService(), deps: [] },
  { provide: StatusEffectService, useFactory: () => new StatusEffectService(), deps: [] },
  { provide: EconomyService, useFactory: () => new EconomyService(), deps: [] },
  { provide: CombatVfxService, useFactory: () => new CombatVfxService(), deps: [] },
  { provide: DamageApplicationService, useFactory: () => new DamageApplicationService(), deps: [] },
  { provide: CombatEffectService, useFactory: () => new CombatEffectService(), deps: [] },
  { provide: TowerCombatService, useFactory: () => new TowerCombatService(), deps: [] },
  { provide: GameStateManager, useFactory: () => new GameStateManager(), deps: [] },
];

export interface SimCoreOptions {
  /** Where the packet's tables live; the worker's store shares its memory with the main thread */
  store?: TableStore;
}

export class SimCore implements SimCoreApi {
  readonly injector: Injector;
  readonly gsm: GameStateManager;
  private readonly writer: PacketWriter;
  private readonly combat: TowerCombatService;
  private readonly link = new DeliveredLink();
  private events: ExportedEvent[] = [];
  /** Wall clock of the last tick, for the replay's pace */
  private lastNow: number | null = null;
  /** Something changed the state outside a sub-step (a restore, the replay): the next packet presents */
  private forcePresent = true;
  private worldLoaded = false;
  private replay: SimReplay | null = null;
  /** A replay file read by loadReplayFile */
  private file: Pick<ReplayFile, 'waves' | 'log'> | null = null;
  /** Players out of the run already told to the simulation (SimConfig.playersLeft) */
  private readonly left = new Set<string>();

  constructor(options: SimCoreOptions = {}) {
    this.injector = Injector.create({ providers: SIM_PROVIDERS, name: 'Simulation' });
    this.gsm = this.injector.get(GameStateManager);
    this.combat = this.injector.get(TowerCombatService);
    this.writer = new PacketWriter(this.gsm, this.combat, options.store ?? new TableStore(false));
    exportEvents(this.gsm.getEventBus(), () => this.events, this.writer.routeIndex);
  }

  /** The tables the packets are written into */
  get store(): TableStore {
    return this.writer.store;
  }

  configure(config: SimConfig): void {
    const gsm = this.gsm;
    if (config.waveSource !== undefined && isWaveSourceId(config.waveSource)) {
      setActiveWaveRules(createWaveSource(config.waveSource).rules);
    }
    if (config.players) {
      gsm.setPlayers(config.players.players, config.players.local);
      this.link.playerId = config.players.local;
      this.left.clear();
    }
    if (config.lanes) gsm.setLanes(new Map(config.lanes));
    if (config.cheatsFor !== undefined) {
      const rule = config.cheatsFor;
      gsm.setCheatRule(rule === null ? null : rule === 'all' ? () => true : (playerId) => rule.includes(playerId));
    }
    for (const playerId of config.playersLeft ?? []) {
      if (this.left.has(playerId)) continue;
      this.left.add(playerId);
      gsm.playerLeft(playerId);
    }
    if (config.lockstep !== undefined) {
      this.link.reset();
      gsm.setLockstep(config.lockstep ? this.link : null, config.lockstep?.hashEvery);
    }
    if (config.movementEnabled !== undefined) gsm.setMovementEnabled(config.movementEnabled);
    if (config.damageNumbers !== undefined) gsm.setDamageNumbers(config.damageNumbers);
    if (config.corridorPending !== undefined) gsm.setCorridorPending(config.corridorPending);
  }

  /** A fresh run on `world`, the seed kept (SimCoreApi.loadWorld). */
  loadWorld(world: SimWorld): void {
    this.leaveReplay();
    this.gsm.reset(this.gsm.rng.seed);
    this.gsm.loadWorld(world);
    this.file = null;
    this.worldLoaded = true;
    this.forcePresent = true;
  }

  tick(input: SimTickInput, out: (message: SimOutput) => void): SimFramePacket {
    const gsm = this.gsm;
    this.link.deliver(input.lockstep, out);
    gsm.paused.set(input.paused);
    gsm.gameSpeed.set(input.gameSpeed);
    // At the boundary before this frame's first sub-step, in the order given
    for (const { playerId, command } of input.commands) {
      gsm.receiveCommand(command as unknown as GameEvent, playerId);
    }

    const delta = this.lastNow === null ? 16 : input.now - this.lastNow;
    this.lastNow = input.now;
    let stepsRun = 0;
    const replay = this.replay;
    if (replay) {
      if (input.replay?.playing) stepsRun = replay.play(delta, input.replay.speed);
    } else if (this.worldLoaded) {
      const before = gsm.subStep;
      gsm.update(input.now);
      stepsRun = gsm.subStep - before;
    }

    const presented = input.renderingEnabled && (stepsRun > 0 || this.forcePresent || input.commands.length > 0);
    this.forcePresent = false;
    return this.packet(stepsRun, presented, input);
  }

  private packet(stepsRun: number, presented: boolean, input: Pick<SimTickInput, 'paused' | 'gameSpeed'>): SimFramePacket {
    // The flames of the frame go out once, the last of its sub-steps
    this.combat.flushBeams();
    const ops = this.gsm.ops.take();
    const events = this.events;
    this.events = [];
    return this.writer.write(
      {
        stepsRun,
        presented,
        paused: input.paused,
        gameSpeed: input.gameSpeed,
        replay: this.replay?.state() ?? null,
      },
      ops,
      events,
    );
  }

  rpc<K extends keyof SimRpc>(method: K, ...args: Parameters<SimRpc[K]>): ReturnType<SimRpc[K]> {
    const handler = this.rpcHandlers[method] as (...a: Parameters<SimRpc[K]>) => ReturnType<SimRpc[K]>;
    if (!handler) throw new Error(`SimCore: no rpc ${String(method)}`);
    return handler(...args);
  }

  private readonly rpcHandlers: SimRpc = {
    reset: (seed) => {
      this.leaveReplay();
      this.gsm.reset(seed);
      this.forcePresent = true;
    },
    worldKey: () => this.gsm.worldKey(),
    stateHash: () => this.gsm.stateHash(),
    hashBreakdownAt: (tick) => this.gsm.hashBreakdownAt(tick),
    captureWaveSnapshot: () => this.gsm.captureWaveSnapshot(),
    restoreWaveSnapshot: (snapshot, reason) => {
      this.gsm.restoreWaveSnapshot(snapshot as WaveSnapshot, reason);
      this.gsm.resyncPresentation();
      this.forcePresent = true;
    },
    replayFile: (head) => {
      const records = this.file?.waves ?? this.gsm.simRecorder.records;
      const log = this.file?.log ?? this.gsm.commandLog.entries;
      const file = buildReplayFile(records, log, {
        worldKey: this.gsm.worldKey(),
        configHash: head.configHash,
        seed: this.gsm.rng.seed,
        gameVersion: head.gameVersion,
        commit: head.commit,
      });
      if (file.waves.length === 0) return null;
      return { text: JSON.stringify(file), waves: file.waves.map((wave) => wave.wave) };
    },
    loadReplayFile: (text, here) => {
      const read = readReplayFile(text, { worldKey: this.gsm.worldKey(), ...here });
      if (read.refusal) return { refusal: read.refusal, note: null, waves: [] };
      this.file = { waves: read.file.waves, log: read.file.log };
      return { refusal: null, note: read.note, waves: read.file.waves.map((wave) => wave.wave) };
    },
    replayEnter: (wave, fromFile) => this.enterReplay(wave, fromFile),
    replaySeek: (stepInWave) => {
      this.replay?.seek(stepInWave);
      this.forcePresent = true;
    },
    replayExit: () => {
      this.leaveReplay();
      this.file = null;
    },
    commandLog: () => this.gsm.commandLog.entries.slice(),
  };

  /** The record and log of `wave`: the loaded file's, else the run's own. */
  private recordOf(wave: number, fromFile: boolean): { record: WaveRecord; log: readonly CommandLogEntry[] } | null {
    const file = fromFile ? this.file : null;
    const record = file ? file.waves.find((w) => w.wave === wave) ?? null : this.gsm.simRecorder.get(wave);
    if (!record || !replayable(record)) return null;
    return { record, log: file ? file.log : this.gsm.commandLog.entries };
  }

  private enterReplay(wave: number, fromFile: boolean): ReplayEntered | null {
    const found = this.recordOf(wave, fromFile);
    if (!found) return null;
    const { record, log } = found;
    if (this.replay) {
      this.replay = this.replay.switchTo(record, log);
    } else {
      if (this.gsm.snapshotRefusal() !== null) return null;
      const live = this.gsm.captureSnapshot();
      this.replay = new SimReplay(this.gsm, record, log, live);
      this.replay.enter();
    }
    this.forcePresent = true;
    return {
      wave: record.wave,
      lengthInSteps: record.endStep === null ? null : record.endStep - record.startStep,
      startStep: record.startStep,
      markers: commandMarkers(log, record.startStep, record.endStep ?? record.startStep),
      waves: fromFile && this.file ? this.file.waves.map((w) => w.wave) : this.gsm.simRecorder.replayableWaves(),
    };
  }

  private leaveReplay(): void {
    if (!this.replay) return;
    this.replay.exit();
    this.replay = null;
    this.forcePresent = true;
  }
}
