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
 */
import { BUILD_VERSION } from '../../configs/build-info.config';

const CACHE_PREFIX = '3dtd-map-data-';
/** The cache of this build */
export const MAP_DATA_CACHE = `${CACHE_PREFIX}${BUILD_VERSION}`;

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

/** Whether a URL is asked of the network first: the index, which names what is current */
function networkFirst(url: string): boolean {
  return /\/maps\/index\.json(\?|$)/.test(url);
}

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
  try {
    const cache = await openCache();
    if (cache && !networkFirst(url)) {
      const hit = await cache.match(url);
      if (hit) return hit;
    }
    try {
      const response = await fetch(url, networkFirst(url) ? { ...init, cache: 'no-store' } : init);
      if (response.ok) {
        const body = await response.clone().arrayBuffer();
        progress.fetched++;
        progress.bytes += body.byteLength;
        await cache?.put(url, response.clone()).catch(() => undefined);
      }
      return response;
    } catch (error) {
      const stale = networkFirst(url) ? await cache?.match(url) : undefined;
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
