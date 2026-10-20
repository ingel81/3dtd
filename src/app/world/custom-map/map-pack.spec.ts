import { createMapDocument } from './map-create';
import { contentHash, packMapFile, unpackMapFile } from './map-file';
import { MapFileError } from './map-file-kind';
import { fingerprint, packErrorReply, packForSave, packOffThread, packReplyError } from './map-pack';
import { rejectionWords, words } from './testing/map-words';

describe('packOffThread', () => {
  it('packs the map as packMapFile does and fingerprints the bytes (inline without workers)', async () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 256, depth: 256, cellSize: 2, starter: true, now: new Date(0) });
    const packed = await packOffThread(doc, { level: 1 });
    expect(packed.file).toEqual(packMapFile(doc, { level: 1 }));
    expect(packed.sum).toBe(fingerprint(packed.file));
    expect(unpackMapFile(packed.file).doc.meta.id).toBe('m');
    expect(packed.summary).toMatchObject({ id: 'm', name: 'M', contentHash: '' });
    expect((await packOffThread(doc, {}, true)).summary.contentHash).toBe(await contentHash(doc));
  });

  it('rejects a map that could not be saved, as packMapFile throws', async () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 256, depth: 256, cellSize: 2, starter: true, now: new Date(0) });
    doc.terrain.grid.heights = new Float32Array(3);
    expect(await rejectionWords(packOffThread(doc))).toMatch(/not valid/);
  });

  it('keeps the problems of an invalid map across the edge of the worker', async () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 64, depth: 64, now: new Date(0) });
    doc.hq = { x: Number.NaN, y: 0 };
    const thrown = await packForSave({ doc, options: {} }).catch((e: unknown) => e);
    // What the worker posts goes through a structured clone
    const error = packReplyError(structuredClone(packErrorReply(thrown)));
    expect(error).toBeInstanceOf(MapFileError);
    expect(words((error as MapFileError).problems)).toEqual(['the HQ has no position']);
    expect(packReplyError(packErrorReply(new Error('boom')))).not.toBeInstanceOf(MapFileError);
  });
});
