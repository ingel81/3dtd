/**
 * Warcraft 3 map import off the main thread. Receives the file's bytes and
 * the import options, answers with the document and the report; the
 * document's big arrays travel as transferables.
 */

/// <reference lib="webworker" />

import { importW3xSync } from './import-w3x';
import { type W3xWorkerRequest, type W3xWorkerResponse, documentTransferables } from './w3x-worker.types';

addEventListener('message', (event: MessageEvent<W3xWorkerRequest>) => {
  const { id, bytes, options } = event.data;
  try {
    const result = importW3xSync(bytes, options);
    const response: W3xWorkerResponse = { id, ok: true, result };
    postMessage(response, documentTransferables(result.doc));
  } catch (e) {
    const response: W3xWorkerResponse = { id, ok: false, error: (e as Error).message ?? String(e) };
    postMessage(response);
  }
});
