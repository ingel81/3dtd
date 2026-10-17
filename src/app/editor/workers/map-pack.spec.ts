import { createMapDocument } from '../../world/custom-map/map-create';
import { MapFileError, contentHash, packMapFile, unpackMapFile } from '../../world/custom-map/map-file';
import { fingerprint } from '../model/version-store';
import { packErrorReply, packForSave, packOffThread, packReplyError } from './map-pack';

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
    await expect(packOffThread(doc)).rejects.toThrow(/not valid/);
  });

  it('keeps the problems of an invalid map across the edge of the worker', async () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 64, depth: 64, now: new Date(0) });
    doc.objects.push({ id: 'o1', asset: 'tree', x: Number.NaN, y: 0, z: 0, rotation: 0, scale: 1 });
    const thrown = await packForSave({ doc, options: {} }).catch((e: unknown) => e);
    // What the worker posts goes through a structured clone
    const error = packReplyError(structuredClone(packErrorReply(thrown)));
    expect(error).toBeInstanceOf(MapFileError);
    expect((error as MapFileError).problems).toEqual(['object o1 has a bad placement']);
    expect(packReplyError(packErrorReply(new Error('boom')))).not.toBeInstanceOf(MapFileError);
  });
});
