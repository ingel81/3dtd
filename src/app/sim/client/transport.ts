/**
 * How the SimClient reaches the simulation (docs/SIM_WORKER.md): a Web Worker
 * in the game, the same thread in the specs. Both deliver the same packets;
 * the worker's arrive a message later.
 */
import type {
  FromWorker, SimConfig, SimCoreApi, SimOutput, SimRpc, SimTickInput, SimWorld, ToWorker,
} from '../protocol/messages';
import type { SimFramePacket } from '../protocol/packet';
import { TableViews } from '../protocol/table-store';
import { fromWire } from '../protocol/wire';

export interface SimTransportHandlers {
  frame(packet: SimFramePacket): void;
  output(message: SimOutput): void;
  error(error: string): void;
}

export interface SimTransport {
  /**
   * The simulation runs beside this thread with sets of tables in shared memory (the worker): a tick may go out
   * while the last packet is not applied yet. False for the same thread, whose tick answers at once.
   */
  readonly concurrent: boolean;
  /**
   * Read `packet`'s tables until release(): false when their memory holds a
   * newer packet already (TableViews.claim). Always true where every packet
   * has tables of its own.
   */
  claim(packet: SimFramePacket): boolean;
  release(): void;
  configure(config: SimConfig): void;
  loadWorld(world: SimWorld): void;
  /** Run one frame; the packet comes through handlers.frame (at once in the same thread) */
  tick(input: SimTickInput): void;
  rpc(method: keyof SimRpc, args: unknown[]): Promise<unknown>;
  dispose(): void;
}

/** The simulation in this thread (specs): every call answers at once. */
export class InlineTransport implements SimTransport {
  readonly concurrent = false;

  constructor(
    private readonly core: SimCoreApi,
    private readonly handlers: SimTransportHandlers,
  ) {}

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

  tick(input: SimTickInput): void {
    const packet = this.core.tick(input, (message) => this.handlers.output(message));
    this.handlers.frame(packet);
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
  /** Only with shared memory: without it every frame carries copies, and the tick waits for the frame as before */
  get concurrent(): boolean {
    return this.shared;
  }
  private shared = false;
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
    // A frame that cannot be read would leave its tick in flight for good
    this.worker.onmessageerror = () => handlers.error('worker: a message from the simulation could not be read');
  }

  private post(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  private receive(message: FromWorker): void {
    switch (message.kind) {
      case 'frame': {
        this.shared = message.frame.shared;
        const packet = fromWire(message.frame, this.views);
        this.setOf.set(packet, message.frame.packet.set);
        this.handlers.frame(packet);
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

  tick(input: SimTickInput): void {
    this.post({ kind: 'tick', input });
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
