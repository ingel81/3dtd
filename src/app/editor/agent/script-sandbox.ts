/**
 * Runs an AI agent's map script in the sandbox worker (script-sandbox.worker.ts,
 * served as `agent/script-worker.js`): a fresh worker per script, a copy of
 * the map, the time limit. Resolves with the kept commands or why there are
 * none; the worker is ended either way.
 */
import type { MapAssetCatalog } from '../catalog/asset-catalog';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import type { ScriptRunResult } from './map-script';
import type { SandboxRequest } from './script-sandbox.worker';

/** Where the built worker lies, from the page's base */
export const SCRIPT_WORKER_PATH = 'agent/script-worker.js';

/** How long a script may run, ms */
export const SCRIPT_TIME_LIMIT_MS = 30_000;

export interface SandboxOptions {
  timeoutMs?: number;
  /** Makes the worker (tests hand in their own) */
  createWorker?: () => Worker;
  /** Ends the worker early (the player pressed Stop); nothing of the script is kept */
  signal?: AbortSignal;
}

export function runScriptInSandbox(
  source: string,
  doc: CustomMapDocument,
  catalog: MapAssetCatalog,
  seed: number,
  options: SandboxOptions = {},
): Promise<ScriptRunResult> {
  const timeoutMs = options.timeoutMs ?? SCRIPT_TIME_LIMIT_MS;
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = options.createWorker?.() ?? new Worker(new URL(SCRIPT_WORKER_PATH, document.baseURI));
    } catch (e) {
      resolve({ ok: false, error: `the script sandbox did not start (${(e as Error).message})`, logs: [] });
      return;
    }
    const finish = (result: ScriptRunResult) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', stopped);
      worker.terminate();
      resolve(result);
    };
    const stopped = () => finish({ ok: false, error: 'the player stopped the script; nothing of it is kept', logs: [] });
    const timer = setTimeout(() => finish({ ok: false, error: `the script ran longer than ${Math.round(timeoutMs / 1000)} s and was stopped; nothing of it is kept`, logs: [] }), timeoutMs);
    worker.onmessage = (event: MessageEvent<ScriptRunResult>) => finish(event.data);
    worker.onerror = (event) => {
      event.preventDefault?.();
      finish({ ok: false, error: `the script sandbox failed (${event.message || 'no message'})`, logs: [] });
    };
    const request: SandboxRequest = { source, doc, catalog, seed };
    if (options.signal?.aborted) return stopped();
    options.signal?.addEventListener('abort', stopped, { once: true });
    worker.postMessage(request);
  });
}
