import { createMapDocument } from './map-create';
import { contentHash, packMapFile } from './map-file';
import { MapStore, MapStoreError, MemoryMapBackend, TRASH_DAYS, type ShippedMapIndex } from './map-store';

function shippedFetch(index: ShippedMapIndex, files: Record<string, Uint8Array>) {
  const calls: string[] = [];
  const fetcher = async (url: string): Promise<Response> => {
    calls.push(url);
    const path = new URL(url).pathname.replace(/^\/game\//, '');
    if (path === 'maps/index.json') return new Response(JSON.stringify(index), { status: 200 });
    const file = files[path];
    return file ? new Response(file as Uint8Array<ArrayBuffer>, { status: 200 }) : new Response('', { status: 404 });
  };
  return { fetcher, calls };
}

describe('MapStore', () => {
  const doc = () => createMapDocument({ id: 'valley', name: 'Valley', width: 32, depth: 32, now: new Date(0) });

  it('saves, lists, loads and deletes own maps', async () => {
    const store = new MapStore({ backend: new MemoryMapBackend(), fetch: shippedFetch({ maps: [] }, {}).fetcher, baseUrl: 'http://x/game/' });
    const summary = await store.save(doc(), new Uint8Array([1, 2]));
    expect(summary).toMatchObject({ id: 'valley', name: 'Valley', origin: 'own', spawns: 1 });
    expect(summary.contentHash).toBe(await contentHash(doc()));
    expect((await store.listOwn()).map((m) => m.id)).toEqual(['valley']);
    const loaded = await store.load('valley');
    expect(loaded.doc).toEqual(doc());
    expect(loaded.preview).toEqual(new Uint8Array([1, 2]));
    // Saving again without a preview keeps the old one
    await store.save(doc());
    expect(await store.previewOf('valley')).toEqual(new Uint8Array([1, 2]));
    await store.setPreview('valley', new Uint8Array([3]));
    expect(await store.previewOf('valley')).toEqual(new Uint8Array([3]));
    await store.delete('valley');
    expect(await store.listOwn()).toEqual([]);
    await expect(store.load('valley')).rejects.toBeInstanceOf(MapStoreError);
  });

  it('leaves the hash out at an autosave and fills it in on loading; a broken summary does not empty the list', async () => {
    const backend = new MemoryMapBackend();
    const store = new MapStore({ backend, fetch: shippedFetch({ maps: [] }, {}).fetcher, baseUrl: 'http://x/game/' });
    const summary = await store.save(doc(), null, packMapFile(doc(), { level: 1 }), { hash: false });
    expect(summary.contentHash).toBe('');
    expect((await store.load('valley')).summary.contentHash).toBe(await contentHash(doc()));
    // A summary with a number for its time (an old or tampered entry)
    const other = createMapDocument({ id: 'other', name: 'Other', width: 32, depth: 32, now: new Date(0) });
    await store.save(other);
    const stored = (await backend.get('other'))!;
    await backend.put({ ...stored, summary: { ...stored.summary, updatedAt: 5 as unknown as string } });
    expect((await store.listOwn()).map((m) => m.id).sort()).toEqual(['other', 'valley']);
  });

  it('reads shipped maps from maps/index.json under the base URL', async () => {
    const shipped = createMapDocument({ id: 'harbour', name: 'Harbour', width: 16, depth: 16 });
    const { fetcher, calls } = shippedFetch(
      { maps: [{ id: 'harbour', name: 'Harbour', file: 'harbour.3dtdmap', preview: 'harbour.png', width: 16, depth: 16 }] },
      { 'maps/harbour.3dtdmap': packMapFile(shipped) },
    );
    const store = new MapStore({ backend: new MemoryMapBackend(), fetch: fetcher, baseUrl: 'http://x/game/' });
    expect((await store.listShipped())[0]).toMatchObject({ id: 'harbour', origin: 'shipped' });
    expect(await store.shippedPreviewUrl('harbour')).toBe('http://x/game/maps/harbour.png');
    const loaded = await store.load('harbour');
    expect(loaded.doc.meta.name).toBe('Harbour');
    expect(loaded.summary.origin).toBe('shipped');
    expect(calls).toContain('http://x/game/maps/harbour.3dtdmap');
    // The index is read once
    expect(calls.filter((c) => c.endsWith('index.json'))).toHaveLength(1);
  });

  it('duplicates a shipped map into a new own map', async () => {
    const shipped = createMapDocument({ id: 'harbour', name: 'Harbour', width: 16, depth: 16 });
    const { fetcher } = shippedFetch(
      { maps: [{ id: 'harbour', name: 'Harbour', file: 'harbour.3dtdmap' }] },
      { 'maps/harbour.3dtdmap': packMapFile(shipped) },
    );
    const store = new MapStore({ backend: new MemoryMapBackend(), fetch: fetcher, baseUrl: 'http://x/game/' });
    const copy = await store.duplicate('harbour');
    expect(copy.doc.meta.name).toBe('Harbour (copy)');
    expect(copy.doc.meta.id).toBe('harbour-copy');
    const again = await store.duplicate('harbour', 'Harbour copy');
    expect(again.doc.meta.id).toBe('harbour-copy-2');
    expect((await store.listOwn()).map((m) => m.id).sort()).toEqual(['harbour-copy', 'harbour-copy-2']);
  });

  it('imports a file under a free id when the id is taken', async () => {
    const store = new MapStore({ backend: new MemoryMapBackend(), fetch: shippedFetch({ maps: [] }, {}).fetcher, baseUrl: 'http://x/' });
    await store.save(doc());
    const imported = await store.importFile(packMapFile(doc()));
    expect(imported.doc.meta.id).toBe('valley-2');
    expect(await store.freeId('fresh')).toBe('fresh');
  });

  it('keeps a deleted map in the trash under its own key, a new map may take its id, the old one comes back beside it', async () => {
    const store = new MapStore({ backend: new MemoryMapBackend(), fetch: shippedFetch({ maps: [] }, {}).fetcher, baseUrl: 'http://x/' });
    await store.save(doc());
    const at = new Date('2026-10-14T08:00:00Z');
    const key = await store.trash('valley', at);
    expect(await store.listOwn()).toEqual([]);
    const [trashed] = await store.listTrash();
    expect(trashed).toMatchObject({ id: key, origin: 'trashed', trash: { from: 'valley', at: at.toISOString(), created: doc().meta.createdAt } });
    await expect(store.load('valley')).rejects.toBeInstanceOf(MapStoreError);
    await store.save(createMapDocument({ id: 'valley', name: 'New valley', width: 32, depth: 32 }));
    expect(await store.restoreFromTrash(key)).toBe('valley-2');
    expect((await store.load('valley-2')).doc.meta.name).toBe('Valley');
    expect(await store.listTrash()).toEqual([]);
    await expect(store.trash('nope')).rejects.toBeInstanceOf(MapStoreError);
  });

  it('empties maps older than TRASH_DAYS from the trash', async () => {
    const store = new MapStore({ backend: new MemoryMapBackend(), fetch: shippedFetch({ maps: [] }, {}).fetcher, baseUrl: 'http://x/' });
    await store.save(doc());
    await store.save(createMapDocument({ id: 'hill', name: 'Hill', width: 32, depth: 32 }));
    const now = Date.parse('2026-10-14T08:00:00Z');
    await store.trash('valley', new Date(now - (TRASH_DAYS + 1) * 86_400_000));
    const recent = await store.trash('hill', new Date(now - 86_400_000));
    expect((await store.purgeTrash(new Date(now))).map((m) => m.trash!.from)).toEqual(['valley']);
    expect((await store.listTrash()).map((m) => m.id)).toEqual([recent]);
  });

  it('lists no shipped maps when the index is missing', async () => {
    const store = new MapStore({
      backend: new MemoryMapBackend(),
      fetch: async () => new Response('', { status: 404 }),
      baseUrl: 'http://x/',
    });
    expect(await store.listShipped()).toEqual([]);
  });
});
