import { Injectable, inject, signal } from '@angular/core';
import { GameStore } from '../../store/game.store';
import type { CommandData } from '../../managers/game-state/command-data';
import { toPlainData } from '../../managers/game-state/command-log';
import type { LockstepLink } from '../../coop/lockstep';
import type {
  LockstepDelivery, QueuedCommand, SimConfig, SimOutput, SimRpc, SimWorld,
} from '../protocol/messages';
import type { SimFramePacket, SimScalars } from '../protocol/packet';
import type { SimMirrorApi, SimPresenterApi } from './contracts';
import { createMainEventBus, type MainEventBus, type ViewEvent } from './view-events';
import { WorkerTransport, type SimTransport, type SimTransportHandlers } from './transport';

/** Inputs the UI gives on the main bus; everything else on it came from the simulation. */
export function isSimInput(type: string): boolean {
  return type.startsWith('command:') || (type.startsWith('debug:') && type !== 'debug:sound');
}

/**
 * The main thread's end of the simulation (docs/SIM_WORKER.md). Everything on
 * the main thread reaches the simulation through this service:
 *  - `bus`: the simulation's events as views; commands (`command:*`,
 *    cheat `debug:*`) emitted on it go to the simulation with the next tick.
 *  - `mirror`: what the simulation looked like after the last packet.
 *  - `rpc`: calls with an answer (replay file, snapshots, hashes).
 *
 * One tick is in flight at a time: the next goes when its packet is back, so
 * a slow simulation slows the game instead of piling up frames. A packet is
 * applied at the start of the main thread's next frame, before it renders.
 * Where a tick takes longer than a frame (many enemies, high speed) and the
 * worker has two sets of tables (SimTransport.concurrent), the next tick goes
 * out as soon as the packet is back instead of with the next frame: the
 * simulation works on while this thread applies and draws, rather than
 * waiting for it. It never writes the set this thread still reads: a tick
 * goes early only while the packet just back is the only one not applied.
 *
 * A run has an epoch (newRun): commands and packets of an older run are
 * dropped. A simulation that failed (a throw in its tick, a worker that did
 * not load) stops for good: no further tick on a half-updated state, the
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
  private inFlight = false;
  private pendingPackets: SimFramePacket[] = [];
  private commands: QueuedCommand[] = [];
  private lockstep: LockstepLink | null = null;
  /** See SimTickInput.replay; set by the replay UI (ReplayService) */
  replay: { playing: boolean; speed: number } | null = null;
  /** Last relay tick handed to the simulation */
  private deliveredTick = -1;
  /** Game time of the last applied packet, for the presenter's advance() */
  private lastGameTimeMs: number | null = null;
  /** Called after each applied packet (the loop's per-frame readers: bot, run log, auto wave) */
  private readonly frameListeners = new Set<(packet: SimFramePacket) => void>();
  /** The run the commands and packets belong to, see newRun() */
  private epoch = 0;
  /** The epoch of the tick in flight: its packet is dropped when a new run began meanwhile */
  private tickEpoch = 0;
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
      frame: (packet) => {
        this.inFlight = false;
        if (this.tickEpoch !== this.epoch || this.failure() !== null) return;
        this.pendingPackets.push(packet);
        this.lastTickMs = packet.scalars.tickMs;
        this.sendEarly();
      },
      output: (message) => this.output(message),
      error: (error) => this.fail(error),
    };
    this.transport = transport ? transport(handlers) : new WorkerTransport(handlers);
  }

  /** What a started or stopped simulation forgets: the world, what is in flight or queued, the links and the failure. */
  private resetSession(): void {
    this.epoch++;
    this.worldLoaded = false;
    this.inFlight = false;
    this.pendingPackets = [];
    this.commands = [];
    this.lockstep = null;
    this.replay = null;
    this.deliveredTick = -1;
    this.lastGameTimeMs = null;
    this.resetShown = false;
    this.lastTickMs = 0;
    this.lastFrameAt = null;
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
   * after seconds of corridor build. Its queued commands and a packet still
   * in flight are dropped (ids start over: a line of sight for tower-3 must
   * not reach the new tower-3); mirror and presentation are cleared, and the
   * stores and services hear game:reset now. The simulation's own resets
   * that come with the new world's first packet are not handed on again.
   *
   * A tick in flight stays in flight until its packet is back (dropped by
   * its epoch): a second tick meanwhile would have the worker write the
   * tables while this thread reads them.
   */
  newRun(): void {
    this.epoch++;
    this.commands = [];
    this.pendingPackets = [];
    this.lastGameTimeMs = null;
    this.mirrorImpl?.clear();
    this.presenterImpl?.clear();
    this.bus.emit({ type: 'game:reset' });
    this.resetShown = true;
  }

  /** The last tick's time in the simulation, ms (SimScalars.tickMs) */
  private lastTickMs = 0;
  /** Wall clock between this thread's frames, smoothed; see sendEarly() */
  private frameIntervalMs = 16;
  private lastFrameAt: number | null = null;

  /**
   * The packet just back is the only one not applied, and the tick took
   * longer than a frame: the next tick goes now rather than with the next
   * frame. Its tables go into the other set, the one of the packet before,
   * which is applied.
   */
  private sendEarly(): void {
    const transport = this.transport;
    if (!transport?.concurrent || this.pendingPackets.length !== 1 || !(this.lastTickMs > this.frameIntervalMs)) return;
    if (!this.worldLoaded || this.inFlight || this.failure() !== null) return;
    this.sendTick(performance.now(), this.gameStore.renderingEnabled());
  }

  /** Called once when the simulation fails (coop leaves the room). */
  onFailure(listener: (error: string) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  /**
   * The simulation threw (its tick, its load, the worker itself). Its state
   * may be half updated: no further tick, no retry. The game stands with a
   * message; coop lets the lockstep go so the partners are not left waiting.
   */
  private fail(error: string): void {
    console.error('[Sim]', error);
    if (this.failure() !== null) return;
    const firstLine = error.split('\n')[0];
    this.failure.set(firstLine);
    this.inFlight = false;
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

  /** The world goes (a new place is being built): no tick until the next loadWorld. */
  unloadWorld(): void {
    this.worldLoaded = false;
  }

  get hasWorld(): boolean {
    return this.worldLoaded;
  }

  /**
   * Coop: the relay link. Its delivered ticks go to the simulation with every
   * tick; what the simulation sends back (commands, hashes, smoothness) goes to
   * it. Null for the single player game.
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
   * One frame of the main thread's loop: apply what came back, then send the
   * next tick if none is out.
   */
  frame(now: number, renderingEnabled = this.gameStore.renderingEnabled()): void {
    if (this.lastFrameAt !== null) this.frameIntervalMs += (Math.min(now - this.lastFrameAt, 100) - this.frameIntervalMs) * 0.1;
    this.lastFrameAt = now;
    this.applyPending();
    if (!this.transport || !this.worldLoaded || this.inFlight || this.failure() !== null) return;
    this.sendTick(now, renderingEnabled);
    // The same thread answers at once
    this.applyPending();
  }

  /** The next tick out, with the commands given since the last one. */
  private sendTick(now: number, renderingEnabled: boolean): void {
    const transport = this.transport!;
    this.inFlight = true;
    this.tickEpoch = this.epoch;
    const commands = this.commands;
    this.commands = [];
    try {
      transport.tick({
        now,
        gameSpeed: this.gameStore.gameSpeed(),
        paused: this.gameStore.paused(),
        renderingEnabled,
        commands,
        lockstep: this.lockstepDelivery(),
        replay: this.replay,
      });
    } catch (error) {
      // The same thread's simulation (InlineTransport) throws here
      this.fail(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
    }
  }

  /**
   * A call with an answer. The commands given since the last tick go ahead
   * of it (applyCommands), so the call acts on the state they leave: the
   * replay's begin leaves the manned tower first, then enters the replay.
   */
  rpc<K extends keyof SimRpc>(method: K, ...args: Parameters<SimRpc[K]>): Promise<ReturnType<SimRpc[K]>> {
    if (this.failure() !== null) return Promise.reject(new Error(`simulation stopped: ${this.failure()}`));
    const transport = this.requireTransport();
    if (this.commands.length > 0 && method !== 'applyCommands') {
      const commands = this.commands;
      this.commands = [];
      transport.rpc('applyCommands', [commands]).catch((error: unknown) => console.error('[Sim] applyCommands', error));
    }
    return transport.rpc(method, args) as Promise<ReturnType<SimRpc[K]>>;
  }

  private requireTransport(): SimTransport {
    if (!this.transport) throw new Error('SimClient: not started');
    return this.transport;
  }

  private lockstepDelivery(): LockstepDelivery | null {
    const link = this.lockstep;
    if (!link) return null;
    const confirmed = link.confirmedTick();
    const ticks: LockstepDelivery['ticks'] = [];
    for (let t = this.deliveredTick + 1; t <= confirmed; t++) {
      ticks.push({ tick: t, commands: link.commandsAt(t) });
      link.release(t);
    }
    if (confirmed > this.deliveredTick) this.deliveredTick = confirmed;
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

  private applyPending(): void {
    if (this.pendingPackets.length === 0) return;
    const packets = this.pendingPackets;
    this.pendingPackets = [];
    for (const packet of packets) this.apply(packet);
  }

  /**
   * Main-thread ms of the last packet's apply, by part: the mirror's state,
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
