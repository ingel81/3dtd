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
import { OsmFrameCore, type OsmStep } from './osm-frame-core';
import { OsmFrameStore } from './osm-frame-store';
import type { OsmWorkerRequest, OsmWorkerResponse } from './osm-worker.types';

const core = new OsmFrameCore({ store: new OsmFrameStore(), decode: browserDecoder });

addEventListener('message', (event: MessageEvent<OsmWorkerRequest>) => {
  const request = event.data;
  const { id } = request;
  const send = (response: OsmWorkerResponse, transfer: Transferable[] = []) => postMessage(response, transfer);
  const onStep = (step: OsmStep) => send({ id, kind: 'step', step });
  void (async () => {
    try {
      switch (request.kind) {
        case 'open':
          send({ id, kind: 'opened', frame: await core.open(request.place, request.count, request.spawnsAt, onStep) });
          break;
        case 'draw':
          send({ id, kind: 'spawns', spawns: core.draw(request.count, request.keep) });
          break;
        case 'drop':
          send({ id, kind: 'dropped', spawn: core.drop(request.at) });
          break;
        case 'make': {
          const made = core.make(request.spawnsAt, request.options, onStep);
          const buffers = documentTransferables(made.doc);
          if (made.file.buffer instanceof ArrayBuffer) buffers.push(made.file.buffer);
          send({ id, kind: 'made', made }, buffers);
          break;
        }
      }
    } catch (e) {
      send({ id, kind: 'error', error: (e as Error).message ?? String(e) });
    }
  })();
});
