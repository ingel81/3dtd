/// <reference lib="webworker" />
/**
 * The simulation's worker (docs/SIM_WORKER.md): a SimCore driven by the
 * messages of the main thread's WorkerTransport (sim/client/transport.ts).
 * Frames go back as WireFrames: the tables stay in the store's memory
 * (shared where the page is cross-origin isolated), the rest is cloned.
 */
import type { FromWorker, SimRpc, ToWorker } from '../protocol/messages';
import { TableStore } from '../protocol/table-store';
import { toWire } from '../protocol/wire';
import { SimCore } from '../core/sim-core';

const store = new TableStore();
const core = new SimCore({ store });

function post(message: FromWorker, transfer: Transferable[] = []): void {
  postMessage(message, transfer);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
}

addEventListener('message', (ev: MessageEvent<ToWorker>) => {
  const message = ev.data;
  switch (message.kind) {
    case 'configure':
      try {
        core.configure(message.config);
      } catch (error) {
        post({ kind: 'error', error: describe(error) });
      }
      return;
    case 'world':
      try {
        core.loadWorld(message.world);
      } catch (error) {
        post({ kind: 'error', error: describe(error) });
      }
      return;
    case 'tick': {
      try {
        const packet = core.tick(message.input, (output) => post({ kind: 'output', message: output }));
        const { frame, transfer } = toWire(packet, store);
        post({ kind: 'frame', frame }, transfer);
      } catch (error) {
        post({ kind: 'error', error: describe(error) });
      }
      return;
    }
    case 'rpc': {
      try {
        const call = core.rpc as (method: keyof SimRpc, ...args: unknown[]) => unknown;
        const value = call.call(core, message.method, ...message.args);
        post({ kind: 'rpc-reply', id: message.id, ok: true, value });
      } catch (error) {
        post({ kind: 'rpc-reply', id: message.id, ok: false, error: describe(error) });
      }
      return;
    }
  }
});

// A tick that cannot be read never answers: the main thread would wait for its frame for good
addEventListener('messageerror', () => {
  post({ kind: 'error', error: 'simulation worker: a message from the main thread could not be read' });
});

post({ kind: 'ready' });
