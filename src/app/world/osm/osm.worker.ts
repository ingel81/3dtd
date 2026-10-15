/**
 * An OSM world made off the main thread: downloads the place's Overpass
 * answer and elevation tiles (decoded on an OffscreenCanvas), converts them
 * and answers with the document and the report; the document's big arrays
 * travel as transferables.
 */

/// <reference lib="webworker" />

import { documentTransferables } from '../w3x/w3x-worker.types';
import { convertOsm, fetchOsmInput } from './import-osm';
import type { OsmWorkerRequest, OsmWorkerResponse } from './osm-worker.types';

addEventListener('message', (event: MessageEvent<OsmWorkerRequest>) => {
  const { id, lat, lon, address, options } = event.data;
  const send = (response: OsmWorkerResponse, transfer: Transferable[] = []) => postMessage(response, transfer);
  void (async () => {
    try {
      send({ id, kind: 'step', step: 'download' });
      const { input, download } = await fetchOsmInput(lat, lon, { address, sideM: options.sideM });
      send({ id, kind: 'step', step: 'convert' });
      const start = performance.now();
      const result = convertOsm(input, options);
      send({ id, kind: 'done', result, download, convertMs: Math.round(performance.now() - start) }, documentTransferables(result.doc));
    } catch (e) {
      send({ id, kind: 'error', error: (e as Error).message ?? String(e) });
    }
  })();
});
