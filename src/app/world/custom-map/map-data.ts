/**
 * Where the files of the custom maps come from and how they are kept
 * (TODO E134): `maps/index.json`, the shipped maps and `maps/assets/` (the
 * catalogue, ground materials and models, some 190 MB). The release does not
 * carry them; the first map opened loads what it needs from the site
 * (`mapData` in runtime-config.json, else beside the page, as the dev server
 * serves `public/maps`), with progress, and keeps it in the browser's Cache
 * Storage. The desktop app keeps that cache in its profile on disk.
 *
 * The cache outlives releases: `maps/manifest.json` (tools/maps/map-manifest.ts)
 * names every file with a hash of its content, and a file is kept under that
 * hash. A release that leaves a file as it was loads nothing again, one that
 * changed it loads it anew, and the entries no file names any more go
 * (tidyMapData, a while after the manifest came). Index and manifest are
 * asked of the network first, and so is a file the manifest does not name
 * (the cache keeps it only for offline). The caches of the builds before,
 * one per version, go (dropOldMapData). Framework-free: the game's progress
 * line listens with onMapDataProgress.
 *
 * Every file's load leaves a `performance.measure` named
 * `map-data <source> <path>` (MAP_DATA_MEASURE), source `cache`, `network`,
 * `stale` (from the cache, offline) or `failed`, with `{ url, source, bytes }`
 * as detail: a slow load says which file and from where. From the network
 * it spans the whole download (until the cache's copy is in); from the cache
 * the lookup (the body is read by whoever asked for the file). The newest
 * MAX_MAP_DATA_MEASURES stay, the older go: the browser keeps measures for
 * the page's life, and a session of many maps would gather thousands.
 *
 * A response goes back to who asked as soon as it comes: the cache takes its
 * copy alongside and counts its bytes, nothing waits for it.
 */

/** The caches of the builds before, one per version */
const CACHE_PREFIX = '3dtd-map-data-';
/** The cache, the same for every build */
export const MAP_DATA_CACHE = '3dtd-map-data';
/** After the manifest came, the cache drops what no file names any more this long later, ms */
const TIDY_DELAY_MS = 20_000;

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
 * models change under it, and the manifest is not written as they do
 */
let alwaysFresh = false;

/** Ask every map file of the network first (the dev server), or only index and manifest (a release) */
export function setMapDataFresh(on: boolean): void {
  alwaysFresh = on;
}

/** The files that name what is current: asked past every cache */
const NAMES_CURRENT = /\/maps\/(index|manifest)\.json(\?|$)/;

/** Whether a URL is asked of the network first: the index and the manifest, or all in dev */
function networkFirst(url: string): boolean {
  return alwaysFresh || NAMES_CURRENT.test(url);
}

/** The hashes of the files by their path under `maps/`, null where there is no manifest; loaded once a page */
let manifest: Promise<Record<string, string> | null> | null = null;

function manifestFiles(): Promise<Record<string, string> | null> {
  manifest ??= mapDataFetch(mapDataUrl('maps/manifest.json'))
    .then(async (res) => (res.ok ? (((await res.json()) as { files?: Record<string, string> }).files ?? null) : null))
    .catch(() => null)
    .then((files) => {
      if (files) setTimeout(() => void tidyMapData(files), TIDY_DELAY_MS);
      return files;
    });
  return manifest;
}

/** A file's path under `maps/` (`assets/models/rock.glb`), null for a URL outside the map data */
function mapPath(url: string): string | null {
  const root = mapDataUrl('maps/');
  return url.startsWith(root) ? url.slice(root.length).split('?')[0] : null;
}

/** The key a file's content is kept under: its URL with the content's hash */
function keyOf(url: string, hash: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}h=${hash}`;
}

/**
 * Fetch a map file: from the cache when its content is there (the
 * manifest's hash), else from the network, kept for the next time as it
 * comes. What names the current files, and a file without a hash, goes to
 * the network first and falls back to the cache offline. Counts every file
 * for the progress line, done once it is whole.
 */
export async function mapDataFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (init?.method && init.method !== 'GET') return fetch(input, init);
  progress.requested++;
  tell();
  const start = performance.now();
  // Done once the file is whole: at once, or when the cache's copy is in (keep)
  let later = false;
  try {
    const cache = await openCache();
    const path = networkFirst(url) ? null : mapPath(url);
    const hash = path === null ? null : ((await manifestFiles())?.[path] ?? null);
    // Kept under its content where the manifest names it, else under its URL (for offline only)
    const key = hash ? keyOf(url, hash) : url;
    if (cache && hash) {
      const hit = await cache.match(key);
      if (hit) {
        measureLoad(url, 'cache', start, lengthOf(hit));
        return hit;
      }
    }
    try {
      // Index and manifest past every cache; in dev the browser's cache may answer after asking the server (304)
      const asked = NAMES_CURRENT.test(url) ? { ...init, cache: 'no-store' as const } : alwaysFresh ? { ...init, cache: 'no-cache' as const } : init;
      const response = await fetch(url, asked);
      if (!response.ok) {
        measureLoad(url, 'failed', start, null);
        return response;
      }
      progress.fetched++;
      if (cache && response.body) {
        later = true;
        void keep(cache, key, response.clone(), url, start).finally(finish);
      } else {
        const bytes = lengthOf(response);
        progress.bytes += bytes ?? 0;
        measureLoad(url, 'network', start, bytes);
      }
      return response;
    } catch (error) {
      const stale = await cache?.match(key);
      measureLoad(url, stale ? 'stale' : 'failed', start, stale ? lengthOf(stale) : null);
      if (stale) return stale;
      throw error;
    }
  } finally {
    if (!later) finish();
  }
}

function finish(): void {
  progress.done++;
  tell();
}

/** `response`'s copy into the cache under `key`, its bytes counted as they pass; the measure once it is whole */
async function keep(cache: Cache, key: string, response: Response, url: string, start: number): Promise<void> {
  let bytes = 0;
  const count = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, out) {
      bytes += chunk.byteLength;
      progress.bytes += chunk.byteLength;
      out.enqueue(chunk);
    },
  });
  const counted = new Response(response.body!.pipeThrough(count), { status: response.status, statusText: response.statusText, headers: response.headers });
  try {
    await cache.put(key, counted);
  } catch {
    // A full disk, a cache gone: the file came all the same
  }
  measureLoad(url, 'network', start, bytes);
}

/** The caches of the builds before, one per version, go: the cache is one for all builds now */
export async function dropOldMapData(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX)) await caches.delete(name);
  } catch {
    /* no cache to tidy */
  }
}

/**
 * The entries of the cache no file names any more go: a file's content
 * under another hash than `files` gives it (an older release's), one of a
 * file gone, and the copies kept by URL alone (from before the manifest);
 * index and manifest stay for offline
 */
export async function tidyMapData(files: Readonly<Record<string, string>>): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  try {
    for (const request of await cache.keys()) {
      if (NAMES_CURRENT.test(request.url)) continue;
      const path = mapPath(request.url);
      if (path === null) continue;
      const kept = new URL(request.url).searchParams.get('h');
      if (!kept || files[path] !== kept) await cache.delete(request);
    }
  } catch {
    /* no cache to tidy */
  }
}

/** For specs: the progress back to nothing, the manifest asked for again */
export function resetMapDataProgress(): void {
  Object.assign(progress, { requested: 0, done: 0, fetched: 0, bytes: 0 });
  manifest = null;
}
