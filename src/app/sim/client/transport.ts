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
  configure(config: SimConfig): void;
  loadWorld(world: SimWorld): void;
  /** Run one frame; the packet comes through handlers.frame (at once in the same thread) */
  tick(input: SimTickInput): void;
  rpc(method: keyof SimRpc, args: unknown[]): Promise<unknown>;
  dispose(): void;
}

/** The simulation in this thread (specs): every call answers at once. */
export class InlineTransport implements SimTransport {
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
  private readonly worker: Worker;
  private nextRpc = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  /** The simulation's tables in shared memory (or this frame's copies without it) */
  private readonly views = new TableViews();

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
      case 'frame':
        this.handlers.frame(fromWire(message.frame, this.views));
        return;
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
