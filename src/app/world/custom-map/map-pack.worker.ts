/// <reference lib="webworker" />
/**
 * The map pack worker (map-pack.ts packOffThread, a coop host's map): packs
 * the copy of the map it gets into a `.3dtdmap`, fingerprints it and sums it up
 * (with the content hash for a manual save); the bytes go back transferred.
 */
import { packErrorReply, packForSave, type PackRequest } from './map-pack';

addEventListener('message', async (e: MessageEvent<PackRequest>) => {
  try {
    const packed = await packForSave(e.data);
    postMessage(packed, [packed.file.buffer]);
  } catch (err) {
    postMessage(packErrorReply(err));
  }
});
