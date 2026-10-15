import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_MAP_DATA_MEASURES, MAP_DATA_CACHE, dropOldMapData, mapDataFetch, mapDataUrl, onMapDataProgress, resetMapDataProgress, setMapDataBase, setMapDataFresh,
  type MapDataProgress,
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
      put: async (url: string, response: Response) => void store.set(url, response),
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

describe('map data (TODO E134)', () => {
  let net: ReturnType<typeof vi.fn>;
  let cache: ReturnType<typeof fakeCaches>;

  beforeEach(() => {
    resetMapDataProgress();
    setMapDataBase(null);
    cache = fakeCaches();
    vi.stubGlobal('caches', cache.api);
    net = vi.fn(async (url: string) => new Response(`body of ${url}`, { status: url.includes('missing') ? 404 : 200 }));
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
    const url = mapDataUrl('maps/assets/models/rock.glb');
    await mapDataFetch(url);
    await mapDataFetch(url);
    await mapDataFetch(mapDataUrl('maps/missing.glb'));
    const loads = performance.getEntriesByType('measure').filter((m) => m.name.startsWith('map-data '));
    expect(loads.map((m) => m.name)).toEqual([
      'map-data network maps/assets/models/rock.glb',
      'map-data cache maps/assets/models/rock.glb',
      'map-data failed maps/missing.glb',
    ]);
    expect((loads[0] as PerformanceMeasure).detail).toEqual({ url, source: 'network', bytes: `body of ${url}`.length });
  });

  it('keeps only the newest measures, so a long session does not gather them', async () => {
    performance.clearMeasures();
    for (let k = 0; k < MAX_MAP_DATA_MEASURES + 20; k++) await mapDataFetch(mapDataUrl(`maps/assets/models/m${k}.glb`));
    const loads = performance.getEntriesByType('measure').filter((m) => m.name.startsWith('map-data '));
    expect(loads).toHaveLength(MAX_MAP_DATA_MEASURES);
    expect(loads[0].name).toBe('map-data network maps/assets/models/m20.glb');
  });

  it('loads a file once from the network and from the cache after, counting both', async () => {
    const seen: MapDataProgress[] = [];
    const off = onMapDataProgress((p) => seen.push(p));
    const url = 'https://data.example.test/maps/assets/models/rock.glb';
    expect(await (await mapDataFetch(url)).text()).toBe(`body of ${url}`);
    expect(await (await mapDataFetch(url)).text()).toBe(`body of ${url}`);
    off();
    expect(net).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toMatchObject({ requested: 2, done: 2, fetched: 1, bytes: `body of ${url}`.length });
    expect(cache.stores.get(MAP_DATA_CACHE)!.has(url)).toBe(true);
  });

  it('asks the network first for the index and falls back to the cache offline; keeps no failed file', async () => {
    const index = 'https://data.example.test/maps/index.json';
    await mapDataFetch(index);
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

  it('drops the caches of earlier builds', async () => {
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
