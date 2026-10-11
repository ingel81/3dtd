import { createMapDocument } from './map-create';
import { contentHash, packMapFile } from './map-file';
import { MapStore, MemoryMapBackend } from './map-store';
import { storeSharedMap } from './map-share';

describe('storeSharedMap (coop with a custom map)', () => {
  const doc = (name = 'Valley') => createMapDocument({ id: 'valley', name, width: 32, depth: 32, now: new Date(0) });
  const emptyStore = () => new MapStore({
    backend: new MemoryMapBackend(),
    fetch: async () => new Response(JSON.stringify({ maps: [] }), { status: 200 }),
    baseUrl: 'http://x/',
  });

  it('keeps the host\'s map as an own map, once it is the map the host named', async () => {
    const store = emptyStore();
    const map = doc();
    const hash = await contentHash(map);
    expect(await storeSharedMap(packMapFile(map), { mapId: 'valley', hash }, store)).toBeNull();
    expect((await store.load('valley')).summary).toMatchObject({ origin: 'own', contentHash: hash });
    // Here already: nothing to do
    expect(await storeSharedMap(packMapFile(map), { mapId: 'valley', hash }, store)).toBeNull();
  });

  it('refuses bytes that are no map or another map than named, and never overwrites an own map', async () => {
    const store = emptyStore();
    const map = doc();
    const hash = await contentHash(map);
    expect(await storeSharedMap(new Uint8Array([1, 2, 3]), { mapId: 'valley', hash }, store)).toContain('did not arrive whole');
    expect(await storeSharedMap(packMapFile(map), { mapId: 'valley', hash: 'other' }, store)).toContain('as the host has it');

    const mine = doc('Mine');
    mine.terrain.grid.heights[0] = 5;
    await store.save(mine);
    expect(await storeSharedMap(packMapFile(map), { mapId: 'valley', hash }, store)).toContain('map of your own called "Mine"');
    expect((await store.load('valley')).doc.meta.name).toBe('Mine');
  });
});
