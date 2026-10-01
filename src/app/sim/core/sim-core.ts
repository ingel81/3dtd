/**
 * The simulation behind SimCoreApi (docs/SIM_WORKER.md): the GameStateManager
 * with its sim services, built in an Injector of its own (no platform, no
 * app, no root lookups), a world from the main thread, inputs as they come
 * and a packet out per pass of the loop (docs/SIM_DECOUPLE_PLAN.md). Runs in
 * the worker (sim/worker/sim.worker.ts, driven by SimLoop) and, for the
 * specs, in the same thread (a pass per frame).
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
  PacketDemand, ReplayEntered, SimConfig, TickProfile, SimCoreApi, SimInput, SimOutput, SimRpc, SimWorld,
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

/**
 * The longest the simulation keeps what it ran to itself while the main
 * thread asks for no packet (ms of wall clock): events of a main thread that
 * stands still do not wait for good. Start value, to be matched with the
 * backpressure (docs/SIM_DECOUPLE_PLAN.md, TODO E85).
 */
export const MAX_PUBLISH_GAP_MS = 100;

/**
 * The time between two packets that answer a demand (ms of wall clock):
 * about 30 states per second. Every packet costs the simulation the tables
 * and the main thread an apply; the picture stays smooth because the bodies
 * slide between two states (state-lerp.ts, TODO E86). An input, a setting or
 * a call still publishes at once. Kept as a schedule, not as a distance to
 * the last packet: a pass that came a moment late does not push the next
 * packet a whole sub-step further (two never come closer than half of it).
 */
export const MIN_PUBLISH_GAP_MS = 33;

/**
 * Backpressure: the longest the simulation runs on without the main thread
 * asking for a packet (ms of wall clock since its last demand). Past it the
 * loop waits for the next demand: a main thread that stands (a hidden tab, a
 * long hang) gets no pile of packets, and the game does not play on unseen.
 * In a running game the demand comes every frame. Start value (TODO E85).
 */
export const MAX_AHEAD_MS = 250;

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
  /** Wall clock of the replay's last pass, for its pace; null before its first */
  private replayNow: number | null = null;
  /** Something changed the state outside a sub-step (a command, a restore, the replay): the next packet presents */
  private forcePresent = true;
  /** Something came in since the last packet (an input, a setting, a call): a packet goes out even without a sub-step */
  private dirty = false;
  /** The settings of the last input (SimInput); game speed and pause live in the GameStateManager */
  private renderingEnabled = true;
  private replayInput: SimInput['replay'] = null;
  /** Ms and the slowest of the commands since the last packet, for its tickMs and the profile */
  private commandsMs = 0;
  private slowest: TickProfile['slowest'] = null;
  /** Sub-steps and their ms of the passes since the last packet: they go with the next */
  private heldSteps = 0;
  private heldMs = 0;
  /** Wall clock of the last packet (the loop's `now`) */
  private publishedAt = -Infinity;
  /** From when the next demand is answered (MIN_PUBLISH_GAP_MS) */
  private answerFrom = -Infinity;
  /** Wall clock of the last demand taken (the main thread was there) */
  private askedAt = -Infinity;
  /** The loop waits for the main thread's next demand (MAX_AHEAD_MS) */
  private waiting = false;
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
      moment: () => ({
        credits: gsm.players.map((id) => gsm.creditsOf(id)),
        baseHealth: gsm.baseHealth(),
        enemiesAlive: gsm.enemyManager.getAliveCount(),
      }),
    });
  }

  /** The tables the packets are written into */
  get store(): TableStore {
    return this.writer.store;
  }

  configure(config: SimConfig): void {
    const gsm = this.gsm;
    this.dirty = true;
    if (config.waveSource !== undefined && isWaveSourceId(config.waveSource)) {
      setActiveWaveRules(createWaveSource(config.waveSource).rules);
    }
    if (config.players) {
      gsm.setPlayers(config.players.players, config.players.local);
      this.link.playerId = config.players.local;
      this.left.clear();
    }
    if (config.lanes) gsm.setLanes(config.lanes);
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

  unloadWorld(): void {
    this.worldLoaded = false;
  }

  output(out: (message: SimOutput) => void): void {
    this.link.out = out;
  }

  input(input: SimInput, now: number): void {
    const gsm = this.gsm;
    // Only a manned tower's aim, every frame while the mouse moves: it acts at
    // once but goes out with the next packet due, not as a packet of its own
    // (a packet a frame wrote and applied every table 144 times a second)
    const aimOnly = !input.lockstep
      && input.commands.length > 0 && input.commands.every(({ command }) => command.type === 'command:tower-aim')
      && input.paused === gsm.paused() && input.gameSpeed === gsm.gameSpeed()
      && input.renderingEnabled === this.renderingEnabled
      && input.replay?.playing === this.replayInput?.playing && input.replay?.speed === this.replayInput?.speed;
    // The loop slept through a pause or a held replay: their clocks take the
    // wall clock now, or the game would jump by the backlog when they go on
    if (gsm.paused()) gsm.update(now);
    if (!this.replayInput?.playing) this.replayNow = now;
    if (input.lockstep) this.link.deliver(input.lockstep);
    gsm.paused.set(input.paused);
    gsm.gameSpeed.set(input.gameSpeed);
    if (input.renderingEnabled && !this.renderingEnabled) this.forcePresent = true;
    this.renderingEnabled = input.renderingEnabled;
    this.replayInput = input.replay;
    if (!aimOnly) this.dirty = true;
    if (input.commands.length === 0) return;
    // At the boundary between two sub-steps (no pass runs meanwhile), in the order given
    const started = performance.now();
    let c0 = started;
    for (const { playerId, command } of input.commands) {
      gsm.receiveCommand(command as unknown as GameEvent, playerId);
      const c1 = performance.now();
      if (!this.slowest || c1 - c0 > this.slowest.ms) this.slowest = { type: command.type, ms: c1 - c0 };
      c0 = c1;
    }
    this.commandsMs += c0 - started;
    if (!aimOnly) this.forcePresent = true;
  }

  pass(now: number, deadline = Infinity, demand?: PacketDemand): SimFramePacket | null {
    if (!this.worldLoaded) return null;
    // The main thread waits: the sub-step running is the last of this pass, unless the last packet is too
    // young to be followed by another (then the pass uses its budget)
    const spaced = now >= this.answerFrom;
    const stop = demand && spaced ? () => demand.demandPending() : undefined;
    const started = performance.now();
    const gsm = this.gsm;
    // Backpressure: the main thread asked for nothing for too long, no sub-step until it does
    const waits = demand !== undefined && now - this.askedAt > MAX_AHEAD_MS && !demand.demandPending();
    if (!waits && this.waiting) {
      // It goes on: the time it stood is not caught up
      gsm.holdClock(now);
      this.replayNow = now;
    }
    this.waiting = waits;
    let stepsRun = 0;
    const replay = this.replay;
    if (waits) {
      // What ran before goes out below, then the loop sleeps until the demand
    } else if (replay) {
      const delta = this.replayNow === null ? 16 : now - this.replayNow;
      this.replayNow = now;
      if (replay.isSeeking) {
        stepsRun = replay.advanceSeek();
        // The seek's end sets up the field anew: shown even without a sub-step
        if (!replay.isSeeking) this.forcePresent = true;
      } else if (this.replayInput?.playing) {
        stepsRun = replay.play(delta, this.replayInput.speed, deadline, stop);
      }
    } else {
      const before = gsm.subStep;
      gsm.update(now, undefined, deadline, stop);
      stepsRun = gsm.subStep - before;
    }
    const changed = this.forcePresent || this.dirty;
    stepsRun += this.heldSteps;
    if (stepsRun === 0 && !changed) return null;

    const updateDone = performance.now();
    // On demand (docs/SIM_DECOUPLE_PLAN.md): the tables are written and the message goes once per frame of the
    // main thread, not per sub-step. The demand is taken even when something else publishes: one packet answers both
    const dueIn = waits ? Infinity : this.dueInMs();
    const asked = demand ? (spaced || changed) && demand.takeDemand() : true;
    if (asked) this.askedAt = now;
    if (!asked && !changed && dueIn !== Infinity && now - this.publishedAt < MAX_PUBLISH_GAP_MS) {
      this.heldSteps = stepsRun;
      this.heldMs += updateDone - started;
      return null;
    }
    this.publishedAt = now;
    // Never more than one gap ahead: inputs every frame (a manned tower's aim)
    // publish faster than the schedule, and each pushed it a gap further, so
    // after a second of aiming the demands went unanswered for seconds (about
    // 9 packets a second, MAX_PUBLISH_GAP_MS)
    this.answerFrom = Math.min(
      Math.max(this.answerFrom + MIN_PUBLISH_GAP_MS, now + MIN_PUBLISH_GAP_MS / 2),
      now + MIN_PUBLISH_GAP_MS,
    );
    this.heldSteps = 0;
    // A replay's jump shows only where it arrives: its slices on the way are not drawn
    const presented = this.renderingEnabled && !this.replay?.isSeeking && (stepsRun > 0 || this.forcePresent);
    this.forcePresent = false;
    this.dirty = false;
    const packet = this.packet(stepsRun, presented);
    const end = performance.now();
    const profile = {
      commandsMs: this.commandsMs, updateMs: this.heldMs + updateDone - started, packetMs: end - updateDone, slowest: this.slowest,
    };
    this.commandsMs = 0;
    this.heldMs = 0;
    this.slowest = null;
    const tickMs = profile.commandsMs + profile.updateMs + profile.packetMs;
    packet.scalars.tickMs = tickMs;
    this.parts?.addTick(profile.commandsMs, profile.updateMs, profile.packetMs, stepsRun);
    const worst = this.profile.worst;
    this.profile = { ...profile, worst: !worst || tickMs > worst.tickMs ? { ...profile, tickMs, stepsRun } : worst };
    return packet;
  }

  idleMs(): number {
    if (!this.worldLoaded) return Infinity;
    if (this.forcePresent || this.dirty) return 0;
    // Waiting for the main thread: its demand comes as a message
    return this.waiting ? Infinity : this.dueInMs();
  }

  /** Wall ms until the next sub-step is due: 0 when one is, Infinity while only a message brings one */
  private dueInMs(): number {
    const replay = this.replay;
    if (!replay) return this.gsm.dueInMs();
    if (replay.isSeeking) return 0;
    return this.replayInput?.playing ? replay.dueInMs(this.replayInput.speed) : Infinity;
  }

  private packet(stepsRun: number, presented: boolean): SimFramePacket {
    // The flames of the pass go out once, the last of its sub-steps
    this.combat.flushBeams();
    const ops = this.gsm.ops.take();
    const events = this.events;
    this.events = [];
    return this.writer.write(
      {
        stepsRun,
        presented,
        paused: this.gsm.paused(),
        gameSpeed: this.gsm.gameSpeed(),
        replay: this.replay?.state() ?? null,
      },
      ops,
      events,
    );
  }

  rpc<K extends keyof SimRpc>(method: K, ...args: Parameters<SimRpc[K]>): ReturnType<SimRpc[K]> {
    const handler = this.rpcHandlers[method] as (...a: Parameters<SimRpc[K]>) => ReturnType<SimRpc[K]>;
    if (!handler) throw new Error(`SimCore: no rpc ${String(method)}`);
    // What a call changes shows with the next packet
    this.dirty = true;
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
    this.replayNow = null;
    this.forcePresent = true;
  }
}
