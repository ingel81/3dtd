import { createMapDocument } from './map-create';
import type { CustomMapDocument } from './map-document';
import { MapFileError, contentHash, packMapFile, unpackMapFile } from './map-file';
import { fingerprint, packErrorReply } from './map-pack';
import { unpackForLoad, unpackOffThread, unpackedTransferables, type UnpackRequest } from './map-unpack';

function sample(): CustomMapDocument {
  const doc = createMapDocument({ id: 'm', name: 'M', width: 128, depth: 128, cellSize: 2, starter: true, now: new Date(0) });
  const piece = {
    width: 8, depth: 6, cell: 2, columns: 5, rows: 4, heights: new Float32Array(20).fill(0.5),
    paintCell: 1, paintColumns: 8, paintRows: 6, materials: ['grass', 'dirt'], paint: new Uint8Array(96).fill(7),
    water: { mask: new Uint8Array(20).fill(255, 0, 3), level: -0.2, color: '#335566' },
    objects: [], roads: { nodes: [], edges: [] }, prefab: true,
  };
  doc.prefabs = [{ id: 'pf-1', name: 'Grove', createdAt: '2026-10-15T00:00:00Z', preview: null, stamp: piece }];
  return doc;
}

describe('unpackOffThread', () => {
  it('reads the map as unpackMapFile does, with the content hash only when asked for (inline without workers)', async () => {
    const doc = sample();
    const file = packMapFile(doc, { preview: new Uint8Array([1, 2, 3]) });
    const read = await unpackOffThread(file);
    expect(read).toEqual({ ...unpackMapFile(file), contentHash: '' });
    expect((await unpackOffThread(file, { hash: true })).contentHash).toBe(await contentHash(doc));
  });

  it('works out the hash of a map reading set right even unasked: a stored one is the uncorrected map\'s', async () => {
    const doc = sample();
    doc.environment.sky = 'aurora' as never;
    const read = await unpackOffThread(packMapFile(doc));
    expect(read.repaired.length).toBe(1);
    expect(read.contentHash).toBe(await contentHash(read.doc));
  });

  it('rejects what is no map, as unpackMapFile throws', async () => {
    await expect(unpackOffThread(new Uint8Array([1, 2, 3]))).rejects.toThrow(MapFileError);
  });

  describe('in a worker', () => {
    // A worker as the browser runs it: both messages through a structured clone with their transfer lists
    class CloneWorker {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: unknown = null;
      postMessage(message: UnpackRequest, transfer: Transferable[]): void {
        const request = structuredClone(message, { transfer });
        void unpackForLoad(request).then(
          (reply) => this.onmessage?.({ data: structuredClone(reply, { transfer: unpackedTransferables(reply) }) }),
          (err: unknown) => this.onmessage?.({ data: structuredClone(packErrorReply(err)) }),
        );
      }
      terminate(): void {
        // nothing to stop
      }
    }
    beforeEach(() => vi.stubGlobal('Worker', CloneWorker));
    afterEach(() => vi.unstubAllGlobals());

    it('hands every array back without a copy, prefabs and the picture included', async () => {
      const file = packMapFile(sample(), { preview: new Uint8Array([1, 2, 3]) });
      const inline = unpackMapFile(file);
      const read = await unpackOffThread(file);
      // Arrays of the test DOM's realm come back as Node's: compared by the bytes they pack to
      expect(fingerprint(packMapFile(read.doc))).toBe(fingerprint(packMapFile(inline.doc)));
      expect([...read.preview!]).toEqual([1, 2, 3]);
      const buffers = unpackedTransferables(read);
      // Heights, splat 0 and 1, the prefab's heights, paint and water, the picture
      expect(buffers.length).toBe(7);
      // Copied, not taken: the caller keeps its file
      expect(file.byteLength).toBeGreaterThan(0);
    });

    it('takes the caller\'s bytes over only when told to', async () => {
      const file = packMapFile(sample());
      await unpackOffThread(file, { transfer: true });
      expect(file.byteLength).toBe(0);
    });

    it('keeps the problems of a broken map across the edge', async () => {
      const doc = sample();
      const file = packMapFile(doc);
      const thrown = await unpackOffThread(file.slice(0, 40)).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(MapFileError);
    });
  });
});
