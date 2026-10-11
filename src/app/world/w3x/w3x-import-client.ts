/**
 * Imports a Warcraft 3 map in a Web Worker so the page stays responsive
 * (a large map takes a few hundred milliseconds to seconds). Where workers
 * are missing (Node, specs) it imports on the calling thread.
 */

import { type W3xImportOptions, type W3xImportResult, importW3x } from './import-w3x';
import type { W3xWorkerRequest, W3xWorkerResponse } from './w3x-worker.types';

let nextId = 1;

export async function importW3xInWorker(file: Blob | ArrayBuffer, options: W3xImportOptions = {}): Promise<W3xImportResult> {
  // The bytes move to the worker; a caller's buffer is copied so it stays usable
  const bytes = file instanceof ArrayBuffer ? file.slice(0) : await file.arrayBuffer();
  const named = typeof File !== 'undefined' && file instanceof File && !options.fileName ? { ...options, fileName: file.name } : options;
  if (typeof Worker === 'undefined') return importW3x(bytes, named);

  const worker = new Worker(new URL('./w3x.worker', import.meta.url), { type: 'module' });
  const id = nextId++;
  try {
    return await new Promise<W3xImportResult>((resolve, reject) => {
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
    worker.terminate();
  }
}
