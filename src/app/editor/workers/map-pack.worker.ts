/// <reference lib="webworker" />
/**
 * The editor's save worker (workers/map-pack.ts packOffThread): packs the
 * copy of the map it gets into a `.3dtdmap` and fingerprints it; the bytes
 * go back transferred.
 */
import { packErrorReply, packForSave, type PackRequest } from './map-pack';

addEventListener('message', (e: MessageEvent<PackRequest>) => {
  try {
    const packed = packForSave(e.data);
    postMessage(packed, [packed.file.buffer]);
  } catch (err) {
    postMessage(packErrorReply(err));
  }
});
