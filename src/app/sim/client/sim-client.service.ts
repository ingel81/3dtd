import { Injectable, inject, signal } from '@angular/core';
import { GameStore } from '../../store/game.store';
import type { CommandData } from '../../managers/game-state/command-data';
import { toPlainData } from '../../managers/game-state/command-log';
import type { LockstepLink } from '../../coop/lockstep';
import type {
  LockstepDelivery, QueuedCommand, SimConfig, SimInput, SimOutput, SimRpc, SimWorld,
} from '../protocol/messages';
import type { SimFramePacket, SimScalars } from '../protocol/packet';
import type { SimMirrorApi, SimPresenterApi } from './contracts';
import { createMainEventBus, type MainEventBus, type ViewEvent } from './view-events';
import { WorkerTransport, type SimTransport, type SimTransportHandlers } from './transport';
import { mergePackets } from './merge-packets';

/** Inputs the UI gives on the main bus; everything else on it came from the simulation. */
export function isSimInput(type: string): boolean {
  return type.startsWith('command:') || (type.startsWith('debug:') && type !== 'debug:sound');
}

/**
 * The main thread's end of the simulation (docs/SIM_WORKER.md). Everything on
 * the main thread reaches the simulation through this service:
 *  - `bus`: the simulation's events as views; commands (`command:*`,
 *    cheat `debug:*`) emitted on it go to the simulation with this frame's
 *    input.
 *  - `mirror`: what the simulation looked like after the last packet.
 *  - `rpc`: calls with an answer (replay file, snapshots, hashes).
 *
 * The simulation runs by its own clock (docs/SIM_DECOUPLE_PLAN.md): it waits
 * for no frame of this thread to compute. It publishes a packet when this
 * thread took the last one (the demand at the start of frame()), so its
 * tables are written once per frame here, not per sub-step. This thread sends it
 * what changed (commands, speed, pause, the replay's controls, the relay's
 * ticks) once per frame (flushInput), and applies the packets that came
 * since its last frame as one, before it renders (applyPending). The simulation never writes the set of tables this
 * thread reads (the claim in applyPending, TableViews.claim).
 *
 * A run has an epoch (newRun): commands and packets of an older run are
 * dropped. A simulation that failed (a throw in a pass, a worker that did
 * not load) stops for good: nothing further on a half-updated state, the
 * error in `failure` (the game loop puts it in the banner), the coop
 * lockstep let go.
 */
@Injectable({ providedIn: 'root' })
export class SimClient {
  private readonly gameStore = inject(GameStore);
  readonly bus: MainEventBus = createMainEventBus();
  private mirrorImpl: SimMirrorApi | null = null;
  private presenterImpl: SimPresenterApi | null = null;
  private transport: SimTransport | null = null;

  private worldLoaded = false;
  private pendingPackets: SimFramePacket[] = [];
  private commands: QueuedCommand[] = [];
  private lockstep: LockstepLink | null = null;
  /** See SimInput.replay; set by the replay UI (ReplayService) */
  replay: { playing: boolean; speed: number } | null = null;
  /** A demand for a packet is out and none came since (frame()) */
  private demandOut = false;
  /** The settings the simulation has (the last input sent), null before the first */
  private sent: Omit<SimInput, 'commands' | 'lockstep'> | null = null;
  /** Last relay tick handed to the simulation */
  private deliveredTick = -1;
  /** Game time of the last applied packet, for the presenter's advance() */
  private lastGameTimeMs: number | null = null;
  /** Called after each applied packet (the loop's per-frame readers: bot, run log, auto wave) */
  private readonly frameListeners = new Set<(packet: SimFramePacket) => void>();
  /** The run the commands and packets belong to, see newRun() */
  private epoch = 0;
  /** newRun() emitted game:reset here already: the new run's first packet brings its own, not handed on */
  private resetShown = false;
  /** Why the simulation stopped, null while it runs (see fail()) */
  readonly failure = signal<string | null>(null);
  private readonly failureListeners = new Set<(error: string) => void>();

  constructor() {
    this.bus.onAny((event) => {
      if (!isSimInput(event.type)) return;
      this.commands.push({
        playerId: this.mirrorImpl?.scalars.localPlayerId ?? '',
        command: toPlainData(event) as CommandData,
      });
    });
  }

  get mirror(): SimMirrorApi {
    if (!this.mirrorImpl) throw new Error('SimClient: no mirror attached');
    return this.mirrorImpl;
  }

  /** The numbers of the last packet (shortcut for mirror.scalars). */
  get scalars(): SimScalars {
    return this.mirror.scalars;
  }

  get presenter(): SimPresenterApi | null {
    return this.presenterImpl;
  }

  /** The mirror, and the presenter once an engine stands (null before and after one). */
  attach(mirror: SimMirrorApi, presenter: SimPresenterApi | null = this.presenterImpl): void {
    this.mirrorImpl = mirror;
    this.presenterImpl = presenter;
  }

  setPresenter(presenter: SimPresenterApi | null): void {
    this.presenterImpl = presenter;
  }

  /**
   * Start the simulation. `transport` for the specs (InlineTransport over a
   * SimCore); the game takes the worker.
   */
  start(transport?: (handlers: SimTransportHandlers) => SimTransport): void {
    this.transport?.dispose();
    this.resetSession();
    const handlers: SimTransportHandlers = {
      frame: (packet, epoch) => {
        this.demandOut = false;
        if (epoch !== this.epoch || this.failure() !== null) return;
        this.pendingPackets.push(packet);
      },
      output: (message) => this.output(message),
      error: (error) => this.fail(error),
    };
    this.transport = transport ? transport(handlers) : new WorkerTransport(handlers);
    this.transport.epoch(this.epoch);
  }

  /** What a started or stopped simulation forgets: the world, what is queued, the links and the failure. */
  private resetSession(): void {
    this.epoch++;
    this.worldLoaded = false;
    this.demandOut = false;
    this.sent = null;
    this.pendingPackets = [];
    this.commands = [];
    this.lockstep = null;
    this.replay = null;
    this.deliveredTick = -1;
    this.lastGameTimeMs = null;
    this.resetShown = false;
    this.failure.set(null);
  }

  get started(): boolean {
    return this.transport !== null;
  }

  stop(): void {
    this.transport?.dispose();
    this.transport = null;
    this.resetSession();
  }

  /**
   * A new run on a new place (MainWorldService.resetRun): the old run goes
   * from the main thread at once, not only with the new world's first packet
   * after seconds of corridor build. Its queued commands and its packets
   * still on their way are dropped (ids start over: a line of sight for
   * tower-3 must not reach the new tower-3); mirror and presentation are
   * cleared, and the stores and services hear game:reset now. The
   * simulation's own resets that come with the new world's first packet are
   * not handed on again.
   *
   * The simulation lets its world go first and runs no sub-step until the
   * next loadWorld: every packet it publishes after it took the new epoch
   * is the new run's.
   */
  newRun(): void {
    this.epoch++;
    this.worldLoaded = false;
    if (this.transport && this.failure() === null) {
      this.transport.unloadWorld();
      this.transport.epoch(this.epoch);
    }
    this.commands = [];
    this.pendingPackets = [];
    this.lastGameTimeMs = null;
    this.mirrorImpl?.clear();
    this.presenterImpl?.clear();
    this.bus.emit({ type: 'game:reset' });
    this.resetShown = true;
  }

  /** Called once when the simulation fails (coop leaves the room). */
  onFailure(listener: (error: string) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  /**
   * The simulation threw (a pass, its load, the worker itself). Its state
   * may be half updated: nothing further goes to it, no retry. The game stands with a
   * message; coop lets the lockstep go so the partners are not left waiting.
   */
  private fail(error: string): void {
    console.error('[Sim]', error);
    if (this.failure() !== null) return;
    const firstLine = error.split('\n')[0];
    this.failure.set(firstLine);
    this.commands = [];
    this.lockstep = null;
    this.deliveredTick = -1;
    for (const listener of this.failureListeners) listener(firstLine);
  }

  /** Settings of the run the simulation reads (wave source, roster, lanes, dev flags). */
  configure(config: SimConfig): void {
    if (this.failure() !== null) return;
    this.requireTransport().configure(config);
  }

  /** The finished world; before it the simulation runs no sub-step. */
  loadWorld(world: SimWorld): void {
    this.requireTransport().loadWorld(world);
    this.worldLoaded = true;
  }

  get hasWorld(): boolean {
    return this.worldLoaded;
  }

  /**
   * Coop: the relay link. Its delivered ticks go to the simulation with the
   * frame's input; what the simulation sends back (commands, hashes,
   * smoothness) goes to it. Null for the single player game.
   */
  setLockstep(link: LockstepLink | null, hashEvery?: number): void {
    this.lockstep = link;
    this.deliveredTick = -1;
    this.configure({ lockstep: link ? { hashEvery } : null });
  }

  /** A command from the main thread (the same as emitting it on the bus). */
  send(command: CommandData): void {
    this.bus.emit(command as unknown as ViewEvent);
  }

  onFrame(listener: (packet: SimFramePacket) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /**
   * One frame of the main thread's loop: apply what the simulation published
   * since the last one, then send it what changed here.
   */
  frame(now: number, renderingEnabled = this.gameStore.renderingEnabled()): void {
    const transport = this.transport;
    // The last packet asked for came: the next is asked for before this one is applied and drawn, so the
    // simulation writes it meanwhile (into another set of tables) and it is here for the next frame. One
    // demand per packet: a second while the first is out would bring two packets for one frame
    if (transport && this.worldLoaded && !this.demandOut && this.failure() === null) {
      this.demandOut = true;
      transport.demand();
    }
    this.applyPending();
    if (!transport || !this.worldLoaded || this.failure() !== null) return;
    try {
      this.flushInput(now, renderingEnabled);
      transport.frame(now);
    } catch (error) {
      // The same thread's simulation (InlineTransport) throws here
      this.fail(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    }
    // The same thread answers at once
    this.applyPending();
  }

  /**
   * The input out: the commands given since the last one and the relay's new
   * ticks, with speed, pause, rendering and the replay's controls. Nothing
   * goes when none of it changed.
   */
  private flushInput(now: number, renderingEnabled = this.sent?.renderingEnabled ?? this.gameStore.renderingEnabled()): void {
    const replay = this.replay;
    const gameSpeed = this.gameStore.gameSpeed();
    const paused = this.gameStore.paused();
    const lockstep = this.lockstepDelivery();
    const sent = this.sent;
    if (
      sent && this.commands.length === 0 && !lockstep
      && sent.gameSpeed === gameSpeed && sent.paused === paused && sent.renderingEnabled === renderingEnabled
      && sent.replay?.playing === replay?.playing && sent.replay?.speed === replay?.speed
    ) return;
    const commands = this.commands;
    this.commands = [];
    // A copy: the replay UI changes its object in place
    this.sent = { gameSpeed, paused, renderingEnabled, replay: replay ? { ...replay } : null };
    this.transport!.input({ ...this.sent, commands, lockstep }, now);
  }

  /**
   * A call with an answer. What changed here since the last frame goes
   * ahead of it (flushInput), so the call acts on the state the commands
   * leave: the replay's begin leaves the manned tower first, then enters the
   * replay. The answer comes after everything sent before the call ran.
   */
  rpc<K extends keyof SimRpc>(method: K, ...args: Parameters<SimRpc[K]>): Promise<ReturnType<SimRpc[K]>> {
    if (this.failure() !== null) return Promise.reject(new Error(`simulation stopped: ${this.failure()}`));
    const transport = this.requireTransport();
    try {
      this.flushInput(performance.now());
    } catch (error) {
      this.fail(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
      return Promise.reject(new Error(`simulation stopped: ${this.failure()}`));
    }
    return transport.rpc(method, args) as Promise<ReturnType<SimRpc[K]>>;
  }

  private requireTransport(): SimTransport {
    if (!this.transport) throw new Error('SimClient: not started');
    return this.transport;
  }

  /** Coop: the ticks the relay closed since the last input, null when there are none. */
  private lockstepDelivery(): LockstepDelivery | null {
    const link = this.lockstep;
    if (!link) return null;
    const confirmed = link.confirmedTick();
    if (confirmed <= this.deliveredTick) return null;
    const ticks: LockstepDelivery['ticks'] = [];
    for (let t = this.deliveredTick + 1; t <= confirmed; t++) {
      ticks.push({ tick: t, commands: link.commandsAt(t) });
      link.release(t);
    }
    this.deliveredTick = confirmed;
    return { confirmedTick: confirmed, ticks };
  }

  private output(message: SimOutput): void {
    const link = this.lockstep;
    if (!link) return;
    switch (message.kind) {
      case 'lockstep-send':
        link.send(message.command);
        return;
      case 'lockstep-hash':
        link.reportHash(message.tick, message.hash, message.parts);
        return;
      case 'lockstep-frame':
        link.noteFrame?.(message.steps, message.blocked, message.behind);
        return;
      case 'lockstep-ran':
        link.commandsRan?.(message.count);
        return;
    }
  }

  /**
   * The packets that came since the last frame, folded into one
   * (mergePackets): the newest one's state, every one's ops, events and
   * tower changes in order. When the newest one's tables are written again
   * already (newer packets are on their way), they all wait for the next frame.
   */
  private applyPending(): void {
    const transport = this.transport;
    const packets = this.pendingPackets;
    if (packets.length === 0 || !transport) return;
    if (!transport.claim(packets[packets.length - 1])) return;
    this.pendingPackets = [];
    try {
      this.apply(mergePackets(packets));
    } finally {
      transport.release();
    }
  }

  /**
   * Main-thread ms of the last apply (the packets of a frame), by part: the mirror's state,
   * the renderer ops, the events on the bus, the tables to the renderers, the
   * frame listeners (the frame time's share of the simulation on this thread)
   */
  readonly applyTimes = { state: 0, ops: 0, events: 0, present: 0, listeners: 0 };

  /** The order of contracts.ts: state, ops, events, tables. */
  private apply(packet: SimFramePacket): void {
    const times = this.applyTimes;
    let t = performance.now();
    const lap = (key: keyof SimClient['applyTimes']) => {
      const now = performance.now();
      times[key] = now - t;
      t = now;
    };
    const mirror = this.mirror;
    const presenter = this.presenterImpl;
    mirror.applyState(packet);
    lap('state');
    presenter?.applyOps(packet.ops);
    lap('ops');
    const bus = this.bus;
    const resetShown = this.resetShown;
    this.resetShown = false;
    for (const event of packet.events) {
      const view = mirror.importEvent(event);
      // newRun() handed game:reset on already
      if (resetShown && event.type === 'game:reset') continue;
      bus.setLiveMuted(!event.live);
      bus.setShowMuted(!event.show);
      bus.emit(view);
    }
    bus.setLiveMuted(false);
    bus.setShowMuted(false);
    lap('events');
    const gameTime = packet.scalars.gameTimeMs;
    if (presenter) {
      if (this.lastGameTimeMs !== null && gameTime > this.lastGameTimeMs) presenter.advance(gameTime - this.lastGameTimeMs);
      presenter.present(packet);
    }
    this.lastGameTimeMs = gameTime;
    mirror.afterFrame(packet);
    lap('present');
    for (const listener of this.frameListeners) listener(packet);
    lap('listeners');
  }
}
