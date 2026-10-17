/**
 * The OSM worker: the frame's work off the main thread (OsmFrameCore). It
 * keeps the place's data between the frame's calls, keeps it in the frame
 * store (IndexedDB), decodes elevation tiles on an OffscreenCanvas and
 * answers a made map with the document and its packed file; the big arrays
 * travel as transferables.
 */

/// <reference lib="webworker" />

import { documentTransferables } from '../w3x/w3x-worker.types';
import { browserDecoder } from './dem-tiles';
import { OsmFrameCore } from './osm-frame-core';
import { thinProgress } from './osm-progress';
import { OsmFrameStore } from './osm-frame-store';
import type { OsmWorkerRequest, OsmWorkerResponse } from './osm-worker.types';
import type { OverpassRetry } from './overpass-client';

const core = new OsmFrameCore({ store: new OsmFrameStore(), decode: browserDecoder });

addEventListener('message', (event: MessageEvent<OsmWorkerRequest>) => {
  const request = event.data;
  const { id } = request;
  const send = (response: OsmWorkerResponse, transfer: Transferable[] = []) => postMessage(response, transfer);
  // A step that only counts on goes at most every PROGRESS_EVERY_MS
  const onProgress = thinProgress((progress) => send({ id, kind: 'progress', progress }));
  const onRetry = (retry: OverpassRetry) => send({ id, kind: 'retry', retry });
  void (async () => {
    try {
      switch (request.kind) {
        case 'open':
          send({ id, kind: 'opened', frame: await core.open(request.request, onProgress, undefined, onRetry) });
          break;
        case 'draw':
          send({ id, kind: 'spawns', spawns: core.draw(request.count, request.keep) });
          break;
        case 'drop':
          send({ id, kind: 'dropped', spawn: core.drop(request.at) });
          break;
        case 'make': {
          const made = await core.make(request.spawnsAt, request.options, onProgress);
          const buffers = documentTransferables(made.doc);
          if (made.file.buffer instanceof ArrayBuffer) buffers.push(made.file.buffer);
          if (made.preview?.buffer instanceof ArrayBuffer) buffers.push(made.preview.buffer);
          send({ id, kind: 'made', made }, buffers);
          break;
        }
      }
    } catch (e) {
      send({ id, kind: 'error', error: (e as Error).message ?? String(e) });
    }
  })();
});
