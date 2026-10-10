import { createMapDocument } from './map-create';
import { contentHash, packMapFile } from './map-file';
import { MapStore, MapStoreError, MemoryMapBackend, type ShippedMapIndex } from './map-store';

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
    await store.delete('valley');
    expect(await store.listOwn()).toEqual([]);
    await expect(store.load('valley')).rejects.toBeInstanceOf(MapStoreError);
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

  it('lists no shipped maps when the index is missing', async () => {
    const store = new MapStore({
      backend: new MemoryMapBackend(),
      fetch: async () => new Response('', { status: 404 }),
      baseUrl: 'http://x/',
    });
    expect(await store.listShipped()).toEqual([]);
  });
});
