/// <reference lib="webworker" />
/**
 * The simulation's worker (docs/SIM_WORKER.md): a SimCore that loops by
 * itself (SimLoop, docs/SIM_DECOUPLE_PLAN.md) and takes the messages of the
 * main thread's WorkerTransport (sim/client/transport.ts) between two passes.
 * Packets go back as WireFrames: the tables stay in the store's memory
 * (shared where the page is cross-origin isolated), the rest is cloned.
 */
import type { FromWorker, SimRpc, ToWorker } from '../protocol/messages';
import { TableStore } from '../protocol/table-store';
import { toWire } from '../protocol/wire';
import { SimCore } from '../core/sim-core';
import { SimLoop } from './sim-loop';

const store = new TableStore();
const core = new SimCore({ store });
/** The run the packets belong to, as the main thread last said (SimClient.newRun) */
let epoch = 0;

function post(message: FromWorker, transfer: Transferable[] = []): void {
  postMessage(message, transfer);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
}

const loop = new SimLoop(
  core,
  (packet) => {
    const { frame, transfer } = toWire(packet, store);
    post({ kind: 'frame', frame, epoch }, transfer);
  },
  (error) => post({ kind: 'error', error: describe(error) }),
);
core.output((message) => post({ kind: 'output', message }));

/** A message that is no call: a throw leaves the state half updated, the loop stops for good */
function take(message: Exclude<ToWorker, { kind: 'rpc' }>): void {
  switch (message.kind) {
    case 'configure':
      core.configure(message.config);
      return;
    case 'world':
      core.loadWorld(message.world);
      return;
    case 'unload':
      core.unloadWorld();
      return;
    case 'epoch':
      epoch = message.epoch;
      return;
    case 'input':
      core.input(message.input, performance.now());
      return;
  }
}

addEventListener('message', (ev: MessageEvent<ToWorker>) => {
  const message = ev.data;
  if (message.kind === 'rpc') {
    try {
      const call = core.rpc as (method: keyof SimRpc, ...args: unknown[]) => unknown;
      const value = call.call(core, message.method, ...message.args);
      post({ kind: 'rpc-reply', id: message.id, ok: true, value });
    } catch (error) {
      post({ kind: 'rpc-reply', id: message.id, ok: false, error: describe(error) });
    }
  } else {
    try {
      take(message);
    } catch (error) {
      loop.stop();
      post({ kind: 'error', error: describe(error) });
      return;
    }
  }
  // Whatever came may have work for the loop: it looks at once
  loop.wake();
});

// An input that cannot be read is lost: the main thread stops rather than play on without it
addEventListener('messageerror', () => {
  post({ kind: 'error', error: 'simulation worker: a message from the main thread could not be read' });
});

post({ kind: 'ready' });
