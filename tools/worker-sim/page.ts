// The lab's page: runs an operation on the main thread or in the worker, as the runner asks
// (e2e/perf/worker-sim.ts calls window.labRun).
interface Reply { id: number; ok: boolean; value?: unknown; error?: string }
let worker: Worker | null = null;
let seq = 1;
const pending = new Map<number, (r: Reply) => void>();

function startWorker(): Promise<void> {
  return new Promise((resolve, reject) => {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onerror = (e) => reject(new Error(`worker error: ${e.message}`));
    worker.onmessage = (ev: MessageEvent<Reply>) => {
      if (ev.data.id === 0) return resolve();
      pending.get(ev.data.id)?.(ev.data);
      pending.delete(ev.data.id);
    };
  });
}

async function run(where: 'main' | 'worker', op: string, ...args: unknown[]): Promise<unknown> {
  if (where === 'main') {
    const lab = (await import('./lab')) as unknown as Record<string, (...a: unknown[]) => unknown>;
    return lab[op](...args);
  }
  if (!worker) await startWorker();
  const id = seq++;
  const r = await new Promise<Reply>((resolve) => {
    pending.set(id, resolve);
    worker!.postMessage({ id, op, args });
  });
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

Object.assign(window, { labRun: run, labReady: true });
