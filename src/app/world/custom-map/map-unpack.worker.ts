/// <reference lib="webworker" />
/**
 * The map unpack worker (map-unpack.ts unpackOffThread): reads the file it
 * gets into a document, with the content hash when asked for; the arrays go
 * back transferred.
 */
import { packErrorReply } from './map-pack';
import { unpackForLoad, unpackedTransferables, type UnpackRequest } from './map-unpack';

addEventListener('message', async (e: MessageEvent<UnpackRequest>) => {
  try {
    const unpacked = await unpackForLoad(e.data);
    postMessage(unpacked, unpackedTransferables(unpacked));
  } catch (err) {
    postMessage(packErrorReply(err));
  }
});
