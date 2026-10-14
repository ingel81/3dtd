import { createMapDocument } from './map-create';
import { contentHash, packMapFile } from './map-file';
import { MapStore, MemoryMapBackend } from './map-store';
import { hasMapHere, storeSharedMap } from './map-share';

describe('storeSharedMap (coop with a custom map)', () => {
  const doc = (name = 'Valley') => createMapDocument({ id: 'valley', name, width: 32, depth: 32, now: new Date(0) });
  const emptyStore = (backend: MemoryMapBackend = new MemoryMapBackend(), shipped: string[] = []) => new MapStore({
    backend,
    fetch: async (url) => (url.endsWith('index.json')
      ? new Response(JSON.stringify({ maps: shipped.map((id) => ({ id, name: id, file: `${id}.3dtdmap` })) }), { status: 200 })
      : new Response('', { status: 404 })),
    baseUrl: 'http://x/',
  });

  it("keeps the host's map as a shared map, once it is the map the host named", async () => {
    const store = emptyStore();
    const map = doc();
    const hash = await contentHash(map);
    expect(await storeSharedMap(packMapFile(map), { mapId: 'valley', hash }, store)).toBeNull();
    expect((await store.load('valley')).summary).toMatchObject({ origin: 'shared', contentHash: hash });
    // Here already: nothing to do
    expect(await storeSharedMap(packMapFile(map), { mapId: 'valley', hash }, store)).toBeNull();
  });

  it('knows a map is here when the same content is stored, not for another version of it', async () => {
    const store = emptyStore();
    const map = doc();
    const hash = await contentHash(map);
    expect(await hasMapHere({ mapId: 'valley', hash }, store)).toBe(false);
    await storeSharedMap(packMapFile(map), { mapId: 'valley', hash }, store);
    expect(await hasMapHere({ mapId: 'valley', hash }, store)).toBe(true);
    expect(await hasMapHere({ mapId: 'valley', hash: 'another' }, store)).toBe(false);
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

  it("takes the host's next version of a map it shared, but never hides a shipped map", async () => {
    const store = emptyStore();
    const first = doc();
    expect(await storeSharedMap(packMapFile(first), { mapId: 'valley', hash: await contentHash(first) }, store)).toBeNull();
    // The host changed the map and opened it again
    const second = doc('Valley v2');
    second.terrain.grid.heights[0] = 3;
    const hash = await contentHash(second);
    expect(await storeSharedMap(packMapFile(second), { mapId: 'valley', hash }, store)).toBeNull();
    expect((await store.load('valley')).summary).toMatchObject({ origin: 'shared', contentHash: hash, name: 'Valley v2' });

    // A changed copy under a shipped id would hide the shipped map for good
    const shipped = emptyStore(new MemoryMapBackend(), ['valley']);
    const said = await storeSharedMap(packMapFile(second), { mapId: 'valley', hash }, shipped);
    expect(said).toContain('changed copy of the shipped map');
    expect(await shipped.listOwn()).toEqual([]);
  });

  it('says why when the storage fails, instead of leaving the guest waiting', async () => {
    const backend = new MemoryMapBackend();
    backend.put = () => Promise.reject(new Error('QuotaExceededError'));
    const map = doc();
    const said = await storeSharedMap(packMapFile(map), { mapId: 'valley', hash: await contentHash(map) }, emptyStore(backend));
    expect(said).toContain('could not be kept here (QuotaExceededError)');
  });
});
