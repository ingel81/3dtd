/**
 * Packing a map off the page's thread: the check, the split into JSON and
 * arrays, the zip and the version fingerprint took a frame of 60 to 140 ms
 * on a 512 m map. `packForSave` is what the editor's worker runs on its
 * mirror of the open map (editor/workers/editor-core-host.ts);
 * `packOffThread` packs a map the page holds (a coop host's) in a worker of
 * its own that gets a copy of it; inline where there are no workers (tests).
 */
import type { CustomMapDocument } from './map-document';
import type { PackOptions } from './map-file';
import { MapFileError } from './map-file-kind';
import type { MapSummary } from './map-store';
import { summarize } from './map-summary';

export interface PackedMap {
  file: Uint8Array;
  /** fingerprint(file), for the version history */
  sum: number;
  /**
   * The store's summary of the very copy packed, with its content hash
   * when asked for (empty otherwise): file, hash and the list's numbers
   * never mix two states of a map the editor went on changing
   */
  summary: MapSummary;
}

export interface PackRequest {
  doc: CustomMapDocument;
  options: PackOptions;
  /** Work out the content hash too (a manual save; an autosave leaves it for loading) */
  hash?: boolean;
}

/** A failed pack as data: an invalid map keeps its kind and its list of problems across the worker's edge */
export interface PackError {
  error: string;
  problems?: string[];
}

export type PackReply = PackedMap | PackError;

export function packErrorReply(err: unknown): PackError {
  const message = (err as Error)?.message ?? String(err);
  return err instanceof MapFileError ? { error: message, problems: err.problems } : { error: message };
}

/** The error a reply stands for: a MapFileError again for an invalid map, so the editor can say what to fix */
export function packReplyError(reply: PackError): Error {
  return reply.problems ? new MapFileError(reply.error, reply.problems) : new Error(reply.error);
}

/** FNV-1a over the bytes: the packed file's fingerprint (PackedMap.sum, the version history's MapVersion.sum) */
export function fingerprint(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return h >>> 0;
}

/**
 * What the worker does with a request; also the inline path. Everything is
 * read from the document before the first await (contentHash reads its
 * bytes at once), so inline it is one state of the map too
 */
export async function packForSave(request: PackRequest): Promise<PackedMap> {
  const { doc } = request;
  const { contentHash, packMapFile } = await import('./map-file');
  const file = packMapFile(doc, request.options);
  const summary = summarize(doc, 'own', '');
  const hash = request.hash ? contentHash(doc) : null;
  return { file, sum: fingerprint(file), summary: { ...summary, contentHash: hash ? await hash : '' } };
}

/** The packed file of `doc`, its fingerprint and summary; rejects as packMapFile throws (an invalid map) */
export function packOffThread(doc: CustomMapDocument, options: PackOptions = {}, hash = false): Promise<PackedMap> {
  if (typeof Worker === 'undefined') return packForSave({ doc, options, hash });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./map-pack.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<PackReply>) => {
      worker.terminate();
      if ('error' in e.data) reject(packReplyError(e.data));
      else resolve(e.data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The map pack worker failed'));
    };
    // Structured clone: the worker packs the map as it is now
    worker.postMessage({ doc, options, hash } satisfies PackRequest);
  });
}
