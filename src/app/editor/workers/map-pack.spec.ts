import { createMapDocument } from '../../world/custom-map/map-create';
import { packMapFile, unpackMapFile } from '../../world/custom-map/map-file';
import { fingerprint } from '../model/version-store';
import { packOffThread } from './map-pack';

describe('packOffThread', () => {
  it('packs the map as packMapFile does and fingerprints the bytes (inline without workers)', async () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 256, depth: 256, cellSize: 2, starter: true, now: new Date(0) });
    const packed = await packOffThread(doc, { level: 1 });
    expect(packed.file).toEqual(packMapFile(doc, { level: 1 }));
    expect(packed.sum).toBe(fingerprint(packed.file));
    expect(unpackMapFile(packed.file).doc.meta.id).toBe('m');
  });

  it('rejects a map that could not be saved, as packMapFile throws', async () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 256, depth: 256, cellSize: 2, starter: true, now: new Date(0) });
    doc.terrain.grid.heights = new Float32Array(3);
    await expect(packOffThread(doc)).rejects.toThrow(/not valid/);
  });
});
