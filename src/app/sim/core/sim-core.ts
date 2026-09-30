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
  ReplayEntered, SimConfig, TickProfile, SimCoreApi, SimOutput, SimRpc, SimTickInput, SimWorld,
} from '../protocol/messages';
import { TableStore } from '../protocol/table-store';
import { SimCoords } from './sim-coords';
import { SimOps } from './sim-sink';
import { PacketWriter } from './packet-writer';
import { exportEvents } from './event-export';
import { DeliveredLink } from './delivered-link';
import { SimReplay } from './sim-replay';
import { SimProfile } from './sim-profile';
import { towerTargetLines, towerTargetRows, type TowerTargetLookup } from '../../services/debug/tower-target-console';

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
    const gsm = this.gsm;
    exportEvents(gsm.getEventBus(), () => this.events, this.writer.routeIndex, {
      gameTimeMs: () => gsm.gameTimeMs,
      subStep: () => gsm.subStep,
    });
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
    if (config.profile !== undefined) {
      this.parts = config.profile ? new SimProfile() : null;
      gsm.setProfiler(this.parts);
    }
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
    const started = performance.now();
    const gsm = this.gsm;
    this.link.deliver(input.lockstep, out);
    gsm.paused.set(input.paused);
    gsm.gameSpeed.set(input.gameSpeed);
    // At the boundary before this frame's first sub-step, in the order given
    let slowest: TickProfile['slowest'] = null;
    for (const { playerId, command } of input.commands) {
      const c0 = performance.now();
      gsm.receiveCommand(command as unknown as GameEvent, playerId);
      const ms = performance.now() - c0;
      if (!slowest || ms > slowest.ms) slowest = { type: command.type, ms };
    }
    // Commands applied between two ticks (rpc applyCommands) show with this frame
    if (this.commandsBetween) {
      this.commandsBetween = false;
      this.forcePresent = true;
    }
    const commandsDone = performance.now();

    const delta = this.lastNow === null ? 16 : input.now - this.lastNow;
    this.lastNow = input.now;
    let stepsRun = 0;
    const replay = this.replay;
    if (replay) {
      if (replay.isSeeking) {
        stepsRun = replay.advanceSeek();
        // The seek's end sets up the field anew: shown even without a sub-step
        if (!replay.isSeeking) this.forcePresent = true;
      } else if (input.replay?.playing) {
        stepsRun = replay.play(delta, input.replay.speed);
      }
    } else if (this.worldLoaded) {
      const before = gsm.subStep;
      gsm.update(input.now);
      stepsRun = gsm.subStep - before;
    }

    const updateDone = performance.now();
    // A replay's jump shows only where it arrives: its slices on the way are not drawn
    const presented = input.renderingEnabled && !this.replay?.isSeeking
      && (stepsRun > 0 || this.forcePresent || input.commands.length > 0);
    this.forcePresent = false;
    const packet = this.packet(stepsRun, presented, input);
    const end = performance.now();
    packet.scalars.tickMs = end - started;
    const profile = { commandsMs: commandsDone - started, updateMs: updateDone - commandsDone, packetMs: end - updateDone, slowest };
    this.parts?.addTick(profile.commandsMs, profile.updateMs, profile.packetMs, stepsRun);
    const worst = this.profile.worst;
    this.profile = {
      ...profile,
      worst: !worst || end - started > worst.tickMs ? { ...profile, tickMs: end - started, stepsRun } : worst,
    };
    return packet;
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

  /** What the tower target console reads in the simulation: an enemy's cell, a cell still in the grid */
  private targetLookup(): TowerTargetLookup {
    const grid = this.injector.get(GlobalRouteGridService);
    const coords = this.injector.get(SimCoords);
    return {
      cellOf: (enemy) => {
        const local = coords.sync.geoToLocalSimple(enemy.position.lat, enemy.position.lon, 0);
        return grid.getCellAt(local.x, local.z);
      },
      isGridCell: (cell) => grid.getCellAt(cell.x, cell.z) === cell,
    };
  }

  /** Commands came in by rpc since the last tick: its packet is presented */
  private commandsBetween = false;

  /** The perf panel's sums while it is open (SimConfig.profile), see SimRpc.profileSums */
  private parts: SimProfile | null = null;

  /** See SimRpc.tickProfile */
  private profile: TickProfile = { commandsMs: 0, updateMs: 0, packetMs: 0, slowest: null };

  private readonly rpcHandlers: SimRpc = {
    tickProfile: () => this.profile,
    profileSums: () => this.parts?.take() ?? null,
    towerTargets: () => towerTargetRows(this.gsm.towerManager.getAll(), this.gsm.enemyManager.getAlive(), this.targetLookup()),
    towerTargetLines: (ids) => towerTargetLines(
      this.gsm.towerManager.getAll(),
      this.gsm.enemyManager.getAll().filter((enemy) => ids.includes(enemy.id)),
      this.targetLookup(),
    ),
    applyCommands: (commands) => {
      for (const { playerId, command } of commands) this.gsm.receiveCommand(command as unknown as GameEvent, playerId);
      if (commands.length > 0) this.commandsBetween = true;
    },
    reset: (seed) => {
      this.leaveReplay();
      this.gsm.reset(seed);
      this.forcePresent = true;
    },
    worldKey: () => this.gsm.worldKey(),
    falsifyCredits: (amount) => this.gsm.addCredits(amount, 'reset'),
    stateHash: () => this.gsm.stateHash(),
    hashBreakdownAt: (tick) => this.gsm.hashBreakdownAt(tick),
    captureWaveSnapshot: () => this.gsm.captureWaveSnapshot(),
    restoreWaveSnapshot: (snapshot, reason) => {
      // As a replay's seek: the old state's particles, marks, strikes and one-shot sounds go first
      this.gsm.clearShow();
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
