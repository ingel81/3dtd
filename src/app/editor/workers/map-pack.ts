/**
 * Packing the open map for a save off the page's thread (editor autosave):
 * the check, the split into JSON and arrays, the zip and the version
 * fingerprint took a frame of 60 to 140 ms on a 512 m map, a hitch two
 * seconds after every change. The worker gets a copy of the document as it
 * was asked for (the editor may go on changing it); inline where there are
 * no workers (tests).
 */
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { packMapFile, type PackOptions } from '../../world/custom-map/map-file';
import { fingerprint } from '../model/version-store';

export interface PackedMap {
  file: Uint8Array;
  /** fingerprint(file), for the version history */
  sum: number;
}

export interface PackRequest {
  doc: CustomMapDocument;
  options: PackOptions;
}

export type PackReply = PackedMap | { error: string };

/** What the worker does with a request; also the inline path */
export function packForSave(request: PackRequest): PackedMap {
  const file = packMapFile(request.doc, request.options);
  return { file, sum: fingerprint(file) };
}

/** The packed file of `doc` and its fingerprint; rejects as packMapFile throws (an invalid map) */
export function packOffThread(doc: CustomMapDocument, options: PackOptions = {}): Promise<PackedMap> {
  if (typeof Worker === 'undefined') {
    try {
      return Promise.resolve(packForSave({ doc, options }));
    } catch (e) {
      return Promise.reject(e);
    }
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./map-pack.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<PackReply>) => {
      worker.terminate();
      if ('error' in e.data) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The map pack worker failed'));
    };
    // Structured clone: the worker packs the map as it is now
    worker.postMessage({ doc, options } satisfies PackRequest);
  });
}
