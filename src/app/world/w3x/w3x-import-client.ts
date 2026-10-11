/**
 * Imports a Warcraft 3 map in a Web Worker so the page stays responsive
 * (a large map takes a few hundred milliseconds to seconds). Where workers
 * are missing (Node, specs) it imports on the calling thread.
 *
 * A worker import ends after `timeoutMs` or when `signal` aborts: the worker
 * is terminated, whatever it was doing (a hostile map that keeps it busy).
 */

import { type W3xImportOptions, type W3xImportResult, importW3x } from './import-w3x';
import type { W3xWorkerRequest, W3xWorkerResponse } from './w3x-worker.types';

let nextId = 1;

/** A worker import that has not answered after this long is ended */
export const W3X_IMPORT_TIMEOUT_MS = 120_000;

export interface W3xImportControl {
  /** Aborting ends the import (the worker is terminated) */
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function importW3xInWorker(
  file: Blob | ArrayBuffer,
  options: W3xImportOptions = {},
  control: W3xImportControl = {},
): Promise<W3xImportResult> {
  const { signal, timeoutMs = W3X_IMPORT_TIMEOUT_MS } = control;
  const cancelled = (): Error => new Error('The import was cancelled');
  if (signal?.aborted) throw cancelled();
  // The bytes move to the worker; a caller's buffer is copied so it stays usable
  const bytes = file instanceof ArrayBuffer ? file.slice(0) : await file.arrayBuffer();
  const named = typeof File !== 'undefined' && file instanceof File && !options.fileName ? { ...options, fileName: file.name } : options;
  if (typeof Worker === 'undefined') {
    const result = await importW3x(bytes, named);
    if (signal?.aborted) throw cancelled();
    return result;
  }

  const worker = new Worker(new URL('./w3x.worker', import.meta.url), { type: 'module' });
  const id = nextId++;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  try {
    return await new Promise<W3xImportResult>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`The import took longer than ${Math.round(timeoutMs / 1000)} s and was stopped`)), timeoutMs);
      onAbort = () => reject(cancelled());
      signal?.addEventListener('abort', onAbort, { once: true });
      worker.onmessage = (event: MessageEvent<W3xWorkerResponse>) => {
        const r = event.data;
        if (r.id !== id) return;
        if (r.ok) resolve(r.result);
        else reject(new Error(r.error));
      };
      worker.onerror = (event) => reject(new Error(event.message || 'Warcraft map import failed in the worker'));
      const request: W3xWorkerRequest = { id, bytes, options: named };
      worker.postMessage(request, [bytes]);
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    worker.terminate();
  }
}
