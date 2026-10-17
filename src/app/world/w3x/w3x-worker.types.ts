import type { W3xImportOptions, W3xImportResult } from './import-w3x';

export interface W3xWorkerRequest {
  id: number;
  bytes: ArrayBuffer;
  options: W3xImportOptions;
}

export type W3xWorkerResponse = { id: number; ok: true; result: W3xImportResult } | { id: number; ok: false; error: string };
