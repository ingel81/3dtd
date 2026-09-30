/**
 * How the SimClient reaches the simulation (docs/SIM_WORKER.md): a Web Worker
 * in the game, the same thread in the specs. The worker loops by itself and
 * publishes packets as it gets on (docs/SIM_DECOUPLE_PLAN.md); the same
 * thread runs one pass per frame and answers at once.
 */
import type {
  FromWorker, SimConfig, SimCoreApi, SimInput, SimOutput, SimRpc, SimWorld, ToWorker,
} from '../protocol/messages';
import type { SimFramePacket } from '../protocol/packet';
import { TableViews } from '../protocol/table-store';
import { fromWire } from '../protocol/wire';

export interface SimTransportHandlers {
  /** A packet the simulation published, with the run it belongs to (SimTransport.epoch) */
  frame(packet: SimFramePacket, epoch: number): void;
  output(message: SimOutput): void;
  error(error: string): void;
}

export interface SimTransport {
  /**
   * Read `packet`'s tables until release(): false when their memory holds a
   * newer packet already (TableViews.claim). Always true where every packet
   * has tables of its own.
   */
  claim(packet: SimFramePacket): boolean;
  release(): void;
  configure(config: SimConfig): void;
  loadWorld(world: SimWorld): void;
  /** The world goes: the simulation runs no sub-step until the next loadWorld */
  unloadWorld(): void;
  /** The packets published from here on belong to the run `epoch` (in the order of the calls before it) */
  epoch(epoch: number): void;
  /** Settings and commands; they act at the next boundary between two sub-steps. `now`: this frame's wall clock */
  input(input: SimInput, now: number): void;
  /**
   * A frame of this thread began. The worker needs none of it; the same
   * thread's simulation runs its pass now, the packet comes through
   * handlers.frame before this returns.
   */
  frame(now: number): void;
  rpc(method: keyof SimRpc, args: unknown[]): Promise<unknown>;
  dispose(): void;
}

/** The simulation in this thread (specs): every call answers at once, a frame runs every sub-step due. */
export class InlineTransport implements SimTransport {
  private run = 0;

  constructor(
    private readonly core: SimCoreApi,
    private readonly handlers: SimTransportHandlers,
  ) {
    core.output((message) => handlers.output(message));
  }

  configure(config: SimConfig): void {
    this.core.configure(config);
  }

  loadWorld(world: SimWorld): void {
    this.core.loadWorld(world);
  }

  claim(): boolean {
    return true;
  }

  release(): void {
    /* nothing held */
  }

  unloadWorld(): void {
    this.core.unloadWorld();
  }

  epoch(epoch: number): void {
    this.run = epoch;
  }

  input(input: SimInput, now: number): void {
    this.core.input(input, now);
  }

  frame(now: number): void {
    const packet = this.core.pass(now);
    if (packet) this.handlers.frame(packet, this.run);
  }

  rpc(method: keyof SimRpc, args: unknown[]): Promise<unknown> {
    try {
      const call = this.core.rpc as (m: keyof SimRpc, ...a: unknown[]) => unknown;
      return Promise.resolve(call.call(this.core, method, ...args));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  dispose(): void {
    /* nothing held */
  }
}

/** The simulation in a module worker (sim/worker/sim.worker.ts). */
export class WorkerTransport implements SimTransport {
  private readonly worker: Worker;
  private nextRpc = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  /** The simulation's tables in shared memory (or this frame's copies without it) */
  private readonly views = new TableViews();
  /** The set of tables each packet not yet released was written into */
  private readonly setOf = new WeakMap<SimFramePacket, number>();

  constructor(private readonly handlers: SimTransportHandlers) {
    this.worker = new Worker(new URL('../worker/sim.worker', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.receive(ev.data);
    this.worker.onerror = (ev) => handlers.error(`worker: ${ev.message}`);
    // A packet that cannot be read is lost with its ops and events: this thread's state would part from the simulation's
    this.worker.onmessageerror = () => handlers.error('worker: a message from the simulation could not be read');
  }

  private post(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  private receive(message: FromWorker): void {
    switch (message.kind) {
      case 'frame': {
        const packet = fromWire(message.frame, this.views);
        this.setOf.set(packet, message.frame.packet.set);
        this.handlers.frame(packet, message.epoch);
        return;
      }
      case 'output':
        this.handlers.output(message.message);
        return;
      case 'rpc-reply': {
        const call = this.pending.get(message.id);
        if (!call) return;
        this.pending.delete(message.id);
        if (message.ok) call.resolve(message.value);
        else call.reject(new Error(message.error));
        return;
      }
      case 'error':
        this.handlers.error(message.error);
        return;
      case 'ready':
        return;
    }
  }

  configure(config: SimConfig): void {
    this.post({ kind: 'configure', config });
  }

  loadWorld(world: SimWorld): void {
    this.post({ kind: 'world', world });
  }

  claim(packet: SimFramePacket): boolean {
    const set = this.setOf.get(packet);
    return set !== undefined && this.views.claim(set, packet.frame);
  }

  release(): void {
    this.views.release();
  }

  unloadWorld(): void {
    this.post({ kind: 'unload' });
  }

  epoch(epoch: number): void {
    this.post({ kind: 'epoch', epoch });
  }

  /** The worker takes its own wall clock when the message arrives */
  input(input: SimInput): void {
    this.post({ kind: 'input', input });
  }

  frame(): void {
    /* the worker loops by itself */
  }

  rpc(method: keyof SimRpc, args: unknown[]): Promise<unknown> {
    const id = this.nextRpc++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ kind: 'rpc', id, method, args });
    });
  }

  dispose(): void {
    this.worker.terminate();
    for (const call of this.pending.values()) call.reject(new Error('simulation worker stopped'));
    this.pending.clear();
  }
}
