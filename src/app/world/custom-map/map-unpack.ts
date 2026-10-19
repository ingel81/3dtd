/**
 * Reading a map file off the page's thread: the unzip, the split arrays put
 * back, the repair and the check (and the content hash when asked for) took
 * 20 to 45 ms on a shipped map and 170 ms on a 4 km one. Every place that
 * reads a `.3dtdmap` for the game or the editor goes through
 * `unpackOffThread` (map-store.ts load, imports, the map folder, a coop
 * host's map, a kept version); a worker of its own per call reads it and
 * hands the document's arrays back without a copy; inline where there are
 * no workers (tests).
 */
import { documentTransferables } from './map-document';
import type { UnpackedMap } from './map-file';
import { packReplyError, type PackError } from './map-pack';

export interface UnpackRequest {
  bytes: Uint8Array;
  /** Work out the content hash too */
  hash?: boolean;
}

export interface UnpackedFile extends UnpackedMap {
  /**
   * The content hash, when asked for or when reading set something right
   * (a stored hash is then the uncorrected map's); empty otherwise
   */
  contentHash: string;
}

export type UnpackReply = UnpackedFile | PackError;

export interface UnpackOptions {
  hash?: boolean;
  /** Hand `bytes` to the worker instead of copying them: the caller is done with them */
  transfer?: boolean;
}

/** What the worker does with a request; also the inline path */
export async function unpackForLoad(request: UnpackRequest): Promise<UnpackedFile> {
  const { contentHash, unpackMapFile } = await import('./map-file');
  const unpacked = unpackMapFile(request.bytes);
  const hash = request.hash || unpacked.repaired.length ? await contentHash(unpacked.doc) : '';
  return { ...unpacked, contentHash: hash };
}

/** The buffers of a read map that leave the worker without a copy */
export function unpackedTransferables(unpacked: UnpackedFile): ArrayBuffer[] {
  const buffers = documentTransferables(unpacked.doc);
  const preview = unpacked.preview?.buffer;
  if (preview && Object.prototype.toString.call(preview) === '[object ArrayBuffer]' && !buffers.includes(preview as ArrayBuffer)) {
    buffers.push(preview as ArrayBuffer);
  }
  return buffers;
}

/** A `.3dtdmap` file read into a document; rejects as unpackMapFile throws (no map, a broken one) */
export function unpackOffThread(bytes: Uint8Array, options: UnpackOptions = {}): Promise<UnpackedFile> {
  const hash = options.hash ?? false;
  if (typeof Worker === 'undefined') return unpackForLoad({ bytes, hash });
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./map-unpack.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<UnpackReply>) => {
      worker.terminate();
      if ('error' in e.data) reject(packReplyError(e.data));
      else resolve(e.data);
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'The map unpack worker failed'));
    };
    // A view into a larger buffer is copied either way: only a whole buffer is handed over
    const whole = options.transfer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer;
    worker.postMessage({ bytes, hash } satisfies UnpackRequest, whole ? [bytes.buffer as ArrayBuffer] : []);
  });
}
