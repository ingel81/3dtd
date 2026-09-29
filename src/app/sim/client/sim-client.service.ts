import { Injectable, inject } from '@angular/core';
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
    const handlers: SimTransportHandlers = {
      frame: (packet) => {
        this.inFlight = false;
        this.pendingPackets.push(packet);
      },
      output: (message) => this.output(message),
      error: (error) => console.error('[Sim]', error),
    };
    this.transport = transport ? transport(handlers) : new WorkerTransport(handlers);
    this.worldLoaded = false;
    this.inFlight = false;
    this.pendingPackets = [];
    this.commands = [];
    this.deliveredTick = -1;
    this.lastGameTimeMs = null;
  }

  get started(): boolean {
    return this.transport !== null;
  }

  stop(): void {
    this.transport?.dispose();
    this.transport = null;
    this.worldLoaded = false;
    this.inFlight = false;
    this.pendingPackets = [];
  }

  /** Settings of the run the simulation reads (wave source, roster, lanes, dev flags). */
  configure(config: SimConfig): void {
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
    this.applyPending();
    if (!this.transport || !this.worldLoaded || this.inFlight) return;
    this.inFlight = true;
    const commands = this.commands;
    this.commands = [];
    this.transport.tick({
      now,
      gameSpeed: this.gameStore.gameSpeed(),
      paused: this.gameStore.paused(),
      renderingEnabled,
      commands,
      lockstep: this.lockstepDelivery(),
      replay: this.replay,
    });
    // The same thread answers at once
    this.applyPending();
  }

  rpc<K extends keyof SimRpc>(method: K, ...args: Parameters<SimRpc[K]>): Promise<ReturnType<SimRpc[K]>> {
    return this.requireTransport().rpc(method, args) as Promise<ReturnType<SimRpc[K]>>;
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
    }
  }

  private applyPending(): void {
    if (this.pendingPackets.length === 0) return;
    const packets = this.pendingPackets;
    this.pendingPackets = [];
    for (const packet of packets) this.apply(packet);
  }

  /** The order of contracts.ts: state, ops, events, tables. */
  private apply(packet: SimFramePacket): void {
    const mirror = this.mirror;
    const presenter = this.presenterImpl;
    mirror.applyState(packet);
    presenter?.applyOps(packet.ops);
    const bus = this.bus;
    for (const event of packet.events) {
      bus.setLiveMuted(!event.live);
      bus.setShowMuted(!event.show);
      bus.emit(mirror.importEvent(event));
    }
    bus.setLiveMuted(false);
    bus.setShowMuted(false);
    const gameTime = packet.scalars.gameTimeMs;
    if (presenter) {
      if (this.lastGameTimeMs !== null && gameTime > this.lastGameTimeMs) presenter.advance(gameTime - this.lastGameTimeMs);
      presenter.present(packet);
    }
    this.lastGameTimeMs = gameTime;
    mirror.afterFrame(packet);
    for (const listener of this.frameListeners) listener(packet);
  }
}
