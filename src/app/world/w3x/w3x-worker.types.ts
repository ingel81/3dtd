import type { CustomMapDocument } from '../custom-map/map-document';
import type { W3xImportOptions, W3xImportResult } from './import-w3x';

export interface W3xWorkerRequest {
  id: number;
  bytes: ArrayBuffer;
  options: W3xImportOptions;
}

export type W3xWorkerResponse = { id: number; ok: true; result: W3xImportResult } | { id: number; ok: false; error: string };

/** The document's array buffers, handed over instead of copied */
export function documentTransferables(doc: CustomMapDocument): ArrayBuffer[] {
  const t = doc.terrain;
  const arrays: ArrayBufferView[] = [t.grid.heights, ...t.splat.maps];
  if (t.water) arrays.push(t.water.mask);
  for (const body of t.waterBodies ?? []) arrays.push(body.mask);
  const buffers = new Set<ArrayBuffer>();
  for (const a of arrays) if (a.buffer instanceof ArrayBuffer) buffers.add(a.buffer);
  return [...buffers];
}
