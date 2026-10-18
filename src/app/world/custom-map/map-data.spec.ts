import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MAP_DATA_MEASURES, MAP_DATA_CACHE, dropOldMapData, mapDataFetch, mapDataUrl, onMapDataProgress, resetMapDataProgress, setMapDataBase, setMapDataFresh,
  tidyMapData, type MapDataProgress,
} from './map-data';
import { mapDataLine } from '../../components/main-menu/loading/loading-plate';

/** Cache Storage as the browser has it, in memory */
function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (url: string) => store.get(url)?.clone(),
      // As the browser does: the body is read whole before the entry stands
      put: async (url: string, response: Response) => void store.set(url, new Response(await response.arrayBuffer(), response)),
      keys: async () => [...store.keys()].map((url) => new Request(url)),
      delete: async (request: Request) => store.delete(request.url),
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
  };
}

/** The manifest's hashes, by path under maps/ */
let manifestFiles: Record<string, string> = {};

/** The calls of `net` for files, not for the manifest */
const fileCalls = (net: ReturnType<typeof vi.fn>) => net.mock.calls.filter(([url]) => !String(url).endsWith('/maps/manifest.json'));

/** The cache's copy is in a moment after the response */
const copied = () => new Promise((resolve) => setTimeout(resolve));

describe('map data (TODO E134)', () => {
  let net: ReturnType<typeof vi.fn>;
  let cache: ReturnType<typeof fakeCaches>;

  beforeEach(() => {
    resetMapDataProgress();
    setMapDataBase(null);
    cache = fakeCaches();
    vi.stubGlobal('caches', cache.api);
    manifestFiles = {};
    // The manifest names the files a test puts in manifestFiles, each with a hash
    net = vi.fn(async (url: string) =>
      url.endsWith('/maps/manifest.json')
        ? new Response(JSON.stringify({ version: 1, files: manifestFiles }))
        : new Response(`body of ${url}`, { status: url.includes('missing') ? 404 : 200 }),
    );
    vi.stubGlobal('fetch', net);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setMapDataBase(null);
    setMapDataFresh(false);
  });

  it('resolves the map files against the site runtime-config names, else beside the page', () => {
    expect(mapDataUrl('maps/index.json')).toBe(new URL('maps/index.json', document.baseURI).toString());
    setMapDataBase('https://data.example.test/3dtd');
    expect(mapDataUrl('maps/assets/catalog.json')).toBe('https://data.example.test/3dtd/maps/assets/catalog.json');
  });

  it('notes every load with its source as a performance.measure', async () => {
    performance.clearMeasures();
    manifestFiles = { 'assets/models/rock.glb': 'aa11' };
    const url = mapDataUrl('maps/assets/models/rock.glb');
    await mapDataFetch(url);
    // The network's measure spans the whole download: it stands once the cache's copy is in
    await copied();
    await mapDataFetch(url);
    await mapDataFetch(mapDataUrl('maps/missing.glb'));
    const loads = performance.getEntriesByType('measure').filter((m) => m.name.startsWith('map-data ') && !m.name.includes('manifest'));
    expect(loads.map((m) => m.name)).toEqual([
      'map-data network maps/assets/models/rock.glb',
      'map-data cache maps/assets/models/rock.glb',
      'map-data failed maps/missing.glb',
    ]);
    expect((loads[0] as PerformanceMeasure).detail).toEqual({ url, source: 'network', bytes: `body of ${url}`.length });
  });

  it('keeps only the newest measures, so a long session does not gather them', async () => {
    performance.clearMeasures();
    vi.stubGlobal('caches', undefined);
    for (let k = 0; k < MAX_MAP_DATA_MEASURES + 20; k++) await mapDataFetch(mapDataUrl(`maps/assets/models/m${k}.glb`));
    const loads = performance.getEntriesByType('measure').filter((m) => m.name.startsWith('map-data '));
    expect(loads).toHaveLength(MAX_MAP_DATA_MEASURES);
    expect(loads[0].name).toBe('map-data network maps/assets/models/m20.glb');
  });

  it('loads a file once from the network and from the cache after, kept under its content, counting both', async () => {
    setMapDataBase('https://data.example.test/');
    manifestFiles = { 'assets/models/rock.glb': 'aa11' };
    const seen: MapDataProgress[] = [];
    const off = onMapDataProgress((p) => seen.push(p));
    const url = 'https://data.example.test/maps/assets/models/rock.glb';
    expect(await (await mapDataFetch(url)).text()).toBe(`body of ${url}`);
    await copied();
    expect(await (await mapDataFetch(url)).text()).toBe(`body of ${url}`);
    off();
    expect(fileCalls(net)).toHaveLength(1);
    // The manifest counts as a file too (fetched, bytes not counted without a cache copy of it)
    expect(seen.at(-1)).toMatchObject({ requested: 3, done: 3, fetched: 2 });
    expect(seen.at(-1)!.bytes).toBeGreaterThanOrEqual(`body of ${url}`.length);
    expect(cache.stores.get(MAP_DATA_CACHE)!.has(`${url}?h=aa11`)).toBe(true);
  });

  it('loads a file a release changed anew, one the manifest does not name from the network each time', async () => {
    setMapDataBase('https://data.example.test/');
    const url = 'https://data.example.test/maps/assets/models/rock.glb';
    manifestFiles = { 'assets/models/rock.glb': 'aa11' };
    await (await mapDataFetch(url)).text();
    await copied();
    // The next release changed the file: its new hash is not in the cache
    resetMapDataProgress();
    manifestFiles = { 'assets/models/rock.glb': 'bb22' };
    await (await mapDataFetch(url)).text();
    expect(fileCalls(net)).toHaveLength(2);
    const other = 'https://data.example.test/maps/assets/models/new.glb';
    await mapDataFetch(other);
    await copied();
    await mapDataFetch(other);
    expect(fileCalls(net)).toHaveLength(4);
  });

  it('drops what no file names any more: older contents, files gone, copies kept by URL alone', async () => {
    setMapDataBase('https://data.example.test/');
    const store = await cache.api.open(MAP_DATA_CACHE);
    const at = (path: string) => `https://data.example.test/maps/${path}`;
    for (const url of [at('assets/a.glb?h=1'), at('assets/a.glb?h=2'), at('assets/b.glb'), at('assets/gone.glb?h=9'), at('assets/plain.glb'), at('index.json'), at('demo.3dtdmap?v=c0ffee&h=7')]) {
      await store.put(url, new Response('x'));
    }
    // A shipped map is asked for with its own content hash (?v=, map-store.ts) beside the manifest's
    await tidyMapData({ 'assets/a.glb': '2', 'assets/b.glb': '5', 'demo.3dtdmap': '7' });
    expect([...cache.stores.get(MAP_DATA_CACHE)!.keys()].sort()).toEqual([at('assets/a.glb?h=2'), at('index.json'), at('demo.3dtdmap?v=c0ffee&h=7')].sort());
  });

  it('asks the network first for the index and falls back to the cache offline; keeps no failed file', async () => {
    const index = 'https://data.example.test/maps/index.json';
    await mapDataFetch(index);
    await copied();
    await mapDataFetch(index);
    expect(net).toHaveBeenCalledTimes(2);
    net.mockRejectedValueOnce(new TypeError('offline'));
    expect(await (await mapDataFetch(index)).text()).toBe(`body of ${index}`);
    await mapDataFetch('https://data.example.test/maps/missing.3dtdmap');
    expect(cache.stores.get(MAP_DATA_CACHE)!.has('https://data.example.test/maps/missing.3dtdmap')).toBe(false);
  });

  it('asks the network first for every file on the dev server, so a changed catalogue is never stale', async () => {
    setMapDataFresh(true);
    const catalog = 'https://data.example.test/maps/assets/catalog.json';
    await mapDataFetch(catalog);
    await copied();
    await mapDataFetch(catalog);
    expect(net).toHaveBeenCalledTimes(2);
    expect(net.mock.calls[1][1]).toMatchObject({ cache: 'no-cache' });
    net.mockRejectedValueOnce(new TypeError('offline'));
    expect(await (await mapDataFetch(catalog)).text()).toBe(`body of ${catalog}`);
  });

  it('works without Cache Storage', async () => {
    vi.stubGlobal('caches', undefined);
    expect((await mapDataFetch('https://data.example.test/maps/a.glb')).ok).toBe(true);
    expect((await mapDataFetch('https://data.example.test/maps/a.glb')).ok).toBe(true);
    expect(net).toHaveBeenCalledTimes(2);
  });

  it('drops the caches of earlier builds, one per version', async () => {
    await cache.api.open('3dtd-map-data-0.7.3');
    await cache.api.open('3dtd-map-data-v0.5.0');
    await cache.api.open(MAP_DATA_CACHE);
    await cache.api.open('something-else');
    await dropOldMapData();
    expect([...cache.stores.keys()].sort()).toEqual([MAP_DATA_CACHE, 'something-else'].sort());
  });

  it('says on the loading plate how far the files are, only while some come from the network', () => {
    expect(mapDataLine({ requested: 0, done: 0, fetched: 0, bytes: 0 })).toBeNull();
    expect(mapDataLine({ requested: 40, done: 12, fetched: 0, bytes: 0 })).toBeNull();
    expect(mapDataLine({ requested: 48, done: 12, fetched: 10, bytes: 3_400_000 })).toBe('Map data 12 of 48 files, 3.4 MB');
    expect(mapDataLine({ requested: 48, done: 30, fetched: 30, bytes: 42_600_000 })).toBe('Map data 30 of 48 files, 43 MB');
    expect(mapDataLine({ requested: 48, done: 48, fetched: 48, bytes: 9e7 })).toBeNull();
  });
});
