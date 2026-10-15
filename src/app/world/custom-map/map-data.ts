/**
 * Where the files of the custom maps come from and how they are kept
 * (TODO E134): `maps/index.json`, the shipped maps and `maps/assets/` (the
 * catalogue, ground materials and models, some 190 MB). The release does not
 * carry them; the first map opened loads what it needs from the site
 * (`mapData` in runtime-config.json, else beside the page, as the dev server
 * serves `public/maps`), with progress, and keeps it in the browser's Cache
 * Storage. The desktop app keeps that cache in its profile on disk.
 *
 * The cache belongs to a build: a new version may change the assets, so it
 * starts empty and the old one goes (dropOldMapData). The index is asked of
 * the network first; a shipped map's file is named with its content hash.
 * Framework-free: the game's progress line listens with onMapDataProgress.
 *
 * Every file's load leaves a `performance.measure` named
 * `map-data <source> <path>` (MAP_DATA_MEASURE), source `cache`, `network`,
 * `stale` (the index from the cache, offline) or `failed`, with `{ url,
 * source, bytes }` as detail: a slow load says which file and from where.
 * From the network it spans the whole download; from the cache the lookup
 * (the body is read by whoever asked for the file). The newest
 * MAX_MAP_DATA_MEASURES stay, the older go: the browser keeps measures for
 * the page's life, and a session of many maps would gather thousands.
 */
import { BUILD_VERSION } from '../../configs/build-info.config';

const CACHE_PREFIX = '3dtd-map-data-';
/** The cache of this build */
export const MAP_DATA_CACHE = `${CACHE_PREFIX}${BUILD_VERSION}`;

/** The name every map file's performance.measure starts with */
export const MAP_DATA_MEASURE = 'map-data';
/** Map file measures kept at most, some three map loads */
export const MAX_MAP_DATA_MEASURES = 300;
/** The names of the measures kept, oldest first */
const measured: string[] = [];

export type MapDataSource = 'cache' | 'network' | 'stale' | 'failed';

/** A map file's load as a performance.measure (see the head of the file); never fails the load */
function measureLoad(url: string, source: MapDataSource, start: number, bytes: number | null): void {
  try {
    const root = mapDataRoot();
    const path = url.startsWith(root) ? url.slice(root.length) : url;
    const name = `${MAP_DATA_MEASURE} ${source} ${path}`;
    performance.measure(name, { start, end: performance.now(), detail: { url, source, bytes } });
    measured.push(name);
    // The oldest go (clearMeasures takes every measure of a name: a file loaded twice goes as one)
    while (measured.length > MAX_MAP_DATA_MEASURES) {
      const old = measured.shift()!;
      if (!measured.includes(old)) performance.clearMeasures(old);
    }
  } catch {
    // No User Timing (an old browser, a test without it): nothing to note
  }
}

/** Bytes a response says it carries, null where it does not */
function lengthOf(response: Response): number | null {
  const length = Number(response.headers.get('content-length'));
  return Number.isFinite(length) && length > 0 ? length : null;
}

/** What the map files' loads have done since the page opened */
export interface MapDataProgress {
  /** Files asked for */
  requested: number;
  /** Files there, from the cache or the network, or failed */
  done: number;
  /** Of them, from the network */
  fetched: number;
  /** Bytes from the network */
  bytes: number;
}

let base: string | null = null;
const progress: MapDataProgress = { requested: 0, done: 0, fetched: 0, bytes: 0 };
const listeners = new Set<(p: Readonly<MapDataProgress>) => void>();

/** The site that serves the map files (runtime-config.json `mapData`); null: beside the page */
export function setMapDataBase(url: string | null | undefined): void {
  base = url ? (url.endsWith('/') ? url : `${url}/`) : null;
}

/** The root the map files' paths (`maps/…`) resolve against */
export function mapDataRoot(): string {
  return base ?? (typeof document !== 'undefined' ? document.baseURI : '/');
}

/** A map file's URL: `path` as `maps/assets/catalog.json` */
export function mapDataUrl(path: string): string {
  return new URL(path, mapDataRoot()).toString();
}

/** Hear the progress of the map files' loads; returns the unsubscribe */
export function onMapDataProgress(listener: (p: Readonly<MapDataProgress>) => void): () => void {
  listeners.add(listener);
  listener({ ...progress });
  return () => listeners.delete(listener);
}

function tell(): void {
  const now = { ...progress };
  for (const listener of listeners) listener(now);
}

/** The cache, null where the browser has none (an insecure origin, a test) or refuses it */
async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(MAP_DATA_CACHE);
  } catch {
    return null;
  }
}

/**
 * Every file asked of the network first, the cache only offline: the dev
 * server's build keeps the package version while the catalogue and the
 * models change under it, and a cache kept by version would serve them stale
 */
let alwaysFresh = false;

/** Ask every map file of the network first (the dev server), or only the index (a release) */
export function setMapDataFresh(on: boolean): void {
  alwaysFresh = on;
}

/** Whether a URL is asked of the network first: the index, which names what is current, or all in dev */
function networkFirst(url: string): boolean {
  return alwaysFresh || INDEX.test(url);
}

const INDEX = /\/maps\/index\.json(\?|$)/;

/**
 * Fetch a map file: from the cache when it is there, else from the network,
 * kept for the next time when it came whole. The index goes to the network
 * first and falls back to the cache offline. Counts every file for the
 * progress line.
 */
export async function mapDataFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (init?.method && init.method !== 'GET') return fetch(input, init);
  progress.requested++;
  tell();
  const start = performance.now();
  try {
    const cache = await openCache();
    if (cache && !networkFirst(url)) {
      const hit = await cache.match(url);
      if (hit) {
        measureLoad(url, 'cache', start, lengthOf(hit));
        return hit;
      }
    }
    try {
      // The index past every cache; in dev the browser's cache may answer after asking the server (304)
      const isIndex = INDEX.test(url);
      const response = await fetch(url, isIndex ? { ...init, cache: 'no-store' } : alwaysFresh ? { ...init, cache: 'no-cache' } : init);
      let bytes: number | null = null;
      if (response.ok) {
        const body = await response.clone().arrayBuffer();
        bytes = body.byteLength;
        progress.fetched++;
        progress.bytes += body.byteLength;
        await cache?.put(url, response.clone()).catch(() => undefined);
      }
      measureLoad(url, response.ok ? 'network' : 'failed', start, bytes);
      return response;
    } catch (error) {
      const stale = networkFirst(url) ? await cache?.match(url) : undefined;
      measureLoad(url, stale ? 'stale' : 'failed', start, stale ? lengthOf(stale) : null);
      if (stale) return stale;
      throw error;
    }
  } finally {
    progress.done++;
    tell();
  }
}

/** The caches of earlier builds go; their assets may differ from this build's */
export async function dropOldMapData(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX) && name !== MAP_DATA_CACHE) await caches.delete(name);
  } catch {
    /* no cache to tidy */
  }
}

/** For specs: the progress back to nothing */
export function resetMapDataProgress(): void {
  Object.assign(progress, { requested: 0, done: 0, fetched: 0, bytes: 0 });
}
