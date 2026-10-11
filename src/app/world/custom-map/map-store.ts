/**
 * Where maps live: the player's own in IndexedDB (database `3dtd-maps`), the
 * shipped ones under `public/maps/` (listed in `maps/index.json`, read-only;
 * the editor duplicates one to change it). Own maps are kept packed as
 * `.3dtdmap` bytes with a small summary and the thumbnail beside them, so
 * the list reads neither files nor unpacks a map. The content hash of an
 * own map may be left out at an autosave; loading fills it in.
 *
 * `MapStore.load(id)` is what the game uses for `?world=map:<id>`: an own map
 * of that id wins over a shipped one.
 */
import { defaultMapBackend, FolderMapBackend, mapFolderId } from './folder-map-backend';
import type { CustomMapDocument, MapBiome } from './map-document';
import { contentHash, packMapFile, unpackMapFile } from './map-file';
import { slugMapId } from './map-create';

/**
 * Where a map came from: made or imported here ('own'), shipped with the
 * game, or received from a coop host ('shared', a copy the next version of
 * the host's map replaces; the editor opens it only as a copy)
 */
export type MapOrigin = 'own' | 'shipped' | 'shared';

export interface MapSummary {
  id: string;
  name: string;
  author: string;
  description: string;
  width: number;
  depth: number;
  updatedAt: string;
  origin: MapOrigin;
  contentHash: string;
  objects: number;
  spawns: number;
  /** Look of sky, light and air (MapEnvironment.biome); absent in summaries of before the field */
  biome?: MapBiome;
  /** The w3x file a map came from */
  importedFrom?: string;
}

/** One own map as stored */
export interface StoredMap {
  summary: MapSummary;
  file: Uint8Array;
  /** PNG thumbnail */
  preview: Uint8Array | null;
}

export interface LoadedMap {
  doc: CustomMapDocument;
  summary: MapSummary;
  preview: Uint8Array | null;
}

/** The storage the store needs; IndexedDB in the browser, a Map in tests */
export interface MapStorageBackend {
  get(id: string): Promise<StoredMap | undefined>;
  /** Stores file and summary; the thumbnail too unless `preview` is undefined (it stays as it is) */
  put(map: Omit<StoredMap, 'preview'> & { preview?: Uint8Array | null }): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<MapSummary[]>;
  /** The thumbnail alone, without reading the file */
  preview(id: string): Promise<Uint8Array | null>;
  setPreview(id: string, preview: Uint8Array | null): Promise<void>;
}

export interface SaveOptions {
  /** Work out the content hash now (default); an autosave leaves it for loading */
  hash?: boolean;
}

/** An entry of `maps/index.json` */
export interface ShippedMapEntry {
  id: string;
  name: string;
  file: string;
  author?: string;
  description?: string;
  width?: number;
  depth?: number;
  updatedAt?: string;
  contentHash?: string;
  preview?: string;
  spawns?: number;
  biome?: MapBiome;
}

export interface ShippedMapIndex {
  maps: ShippedMapEntry[];
}

export class MapStoreError extends Error {
  override name = 'MapStoreError';
}

export interface MapStoreOptions {
  backend?: MapStorageBackend;
  /** Fetches shipped files; relative to `baseUrl` */
  fetch?: (url: string) => Promise<Response>;
  /** Base for `maps/…`, the document's base URI by default */
  baseUrl?: string;
}

export class MapStore {
  private readonly backend: MapStorageBackend;
  private readonly fetcher: (url: string) => Promise<Response>;
  private readonly baseUrl: string;
  private shippedIndex: Promise<ShippedMapEntry[]> | null = null;

  constructor(options: MapStoreOptions = {}) {
    this.backend = options.backend ?? defaultMapBackend();
    this.fetcher = options.fetch ?? ((url) => fetch(url));
    this.baseUrl = options.baseUrl ?? (typeof document !== 'undefined' ? document.baseURI : '/');
  }

  async listOwn(): Promise<MapSummary[]> {
    const list = await this.backend.list();
    // A broken summary must not empty the list: missing times sort last
    const time = (m: MapSummary) => (typeof m.updatedAt === 'string' ? m.updatedAt : '');
    return list.filter((m) => m && typeof m.id === 'string').sort((a, b) => time(b).localeCompare(time(a)));
  }

  async listShipped(): Promise<MapSummary[]> {
    const entries = await this.readIndex();
    return entries.map((e) => shippedSummary(e));
  }

  /** URL of a shipped map's thumbnail, or null */
  async shippedPreviewUrl(id: string): Promise<string | null> {
    const entry = (await this.readIndex()).find((e) => e.id === id);
    return entry?.preview ? this.url(`maps/${entry.preview}`) : null;
  }

  async previewOf(id: string): Promise<Uint8Array | null> {
    return this.backend.preview(id);
  }

  async has(id: string): Promise<boolean> {
    if (await this.backend.get(id)) return true;
    return (await this.readIndex()).some((e) => e.id === id);
  }

  /** An own map, else a shipped one of that id */
  async load(id: string, origin?: MapOrigin): Promise<LoadedMap> {
    if (origin !== 'shipped') {
      const own = await this.backend.get(id);
      if (own) {
        const { doc, preview } = unpackMapFile(own.file);
        const summary = own.summary.contentHash ? own.summary : { ...own.summary, contentHash: await contentHash(doc) };
        return { doc, summary, preview: own.preview ?? preview };
      }
      if (origin === 'own') throw new MapStoreError(`There is no own map "${id}" in this browser; it may have been deleted.`);
    }
    const entry = (await this.readIndex()).find((e) => e.id === id);
    if (!entry) throw new MapStoreError(`There is no map "${id}" in this browser; it may have been deleted.`);
    const response = await this.fetcher(this.url(`maps/${entry.file}`));
    if (!response.ok) throw new MapStoreError(`The map "${entry.name}" did not load (${response.status}).`);
    const { doc, preview } = unpackMapFile(new Uint8Array(await response.arrayBuffer()));
    const hash = await contentHash(doc);
    return { doc, summary: { ...summarize(doc, 'shipped', hash) }, preview };
  }

  /** Packs and stores an own map (or stores `file`, packed already); returns its new summary */
  async save(
    doc: CustomMapDocument,
    preview: Uint8Array | null = null,
    file: Uint8Array = packMapFile(doc),
    options: SaveOptions = {},
  ): Promise<MapSummary> {
    const summary = summarize(doc, 'own', options.hash === false ? '' : await contentHash(doc));
    // Without a new picture the stored one stays: the file is not read for it
    await this.backend.put({ summary, file, ...(preview ? { preview } : {}) });
    return summary;
  }

  /**
   * Stores a map a coop host sent (`file` as it came) as 'shared': the
   * host's next version replaces it, an own map is never written over
   * (map-share.ts decides)
   */
  async saveShared(doc: CustomMapDocument, preview: Uint8Array | null, file: Uint8Array): Promise<MapSummary> {
    const summary = summarize(doc, 'shared', await contentHash(doc));
    await this.backend.put({ summary, file, preview });
    return summary;
  }

  /** The id of the own map a file of the desktop map folder holds (a double-clicked map) */
  async folderMapId(fileName: string): Promise<string> {
    return (this.backend instanceof FolderMapBackend ? await this.backend.idOfFile(fileName) : null) ?? mapFolderId(fileName);
  }

  /** Whether the game ships a map of this id (maps/index.json) */
  async isShipped(id: string): Promise<boolean> {
    return (await this.readIndex()).some((e) => e.id === id);
  }

  /** Stores a `.3dtdmap` file as an own map, under a fresh id when the id is taken */
  async importFile(bytes: Uint8Array): Promise<LoadedMap> {
    const { doc, preview } = unpackMapFile(bytes);
    if (await this.has(doc.meta.id)) doc.meta.id = await this.freeId(doc.meta.id);
    const summary = await this.save(doc, preview);
    return { doc, summary, preview };
  }

  /** A new thumbnail for an own map, its content untouched */
  async setPreview(id: string, preview: Uint8Array): Promise<void> {
    await this.backend.setPreview(id, preview);
  }

  async delete(id: string): Promise<void> {
    await this.backend.delete(id);
  }

  /** A copy of any map as a new own map */
  async duplicate(id: string, name?: string, origin?: MapOrigin): Promise<LoadedMap> {
    const { doc, preview } = await this.load(id, origin);
    const now = new Date().toISOString();
    doc.meta.name = name ?? `${doc.meta.name} (copy)`;
    doc.meta.id = await this.freeId(slugMapId(doc.meta.name));
    doc.meta.createdAt = now;
    doc.meta.updatedAt = now;
    const summary = await this.save(doc, preview);
    return { doc, summary, preview };
  }

  /** `base`, or `base-2`, `base-3` … whichever no map uses yet */
  async freeId(base: string): Promise<string> {
    const stem = slugMapId(base).replace(/-\d+$/, '') || 'map';
    const taken = new Set([...(await this.backend.list()).map((m) => m.id), ...(await this.readIndex()).map((e) => e.id)]);
    if (!taken.has(base) && /^[a-z0-9]/.test(base) && slugMapId(base) === base) return base;
    for (let n = 2; ; n++) {
      const id = `${stem}-${n}`;
      if (!taken.has(id)) return id;
    }
  }

  private readIndex(): Promise<ShippedMapEntry[]> {
    this.shippedIndex ??= this.fetcher(this.url('maps/index.json'))
      .then(async (r) => (r.ok ? ((await r.json()) as ShippedMapIndex).maps ?? [] : []))
      .catch(() => []);
    return this.shippedIndex;
  }

  private url(path: string): string {
    return new URL(path, this.baseUrl).toString();
  }
}

export function summarize(doc: CustomMapDocument, origin: MapOrigin, hash: string): MapSummary {
  return {
    id: doc.meta.id,
    name: doc.meta.name,
    author: doc.meta.author,
    description: doc.meta.description,
    width: doc.terrain.width,
    depth: doc.terrain.depth,
    updatedAt: doc.meta.updatedAt,
    origin,
    contentHash: hash,
    objects: doc.objects.length,
    spawns: doc.spawns.length,
    biome: doc.environment.biome ?? 'temperate',
    importedFrom: doc.meta.source?.file,
  };
}

function shippedSummary(e: ShippedMapEntry): MapSummary {
  return {
    id: e.id,
    name: e.name,
    author: e.author ?? '',
    description: e.description ?? '',
    width: e.width ?? 0,
    depth: e.depth ?? 0,
    updatedAt: e.updatedAt ?? '',
    origin: 'shipped',
    contentHash: e.contentHash ?? '',
    objects: 0,
    spawns: e.spawns ?? 0,
    ...(e.biome ? { biome: e.biome } : {}),
  };
}

/** In memory, for tests and when IndexedDB is not there */
export class MemoryMapBackend implements MapStorageBackend {
  private readonly maps = new Map<string, StoredMap>();
  async get(id: string): Promise<StoredMap | undefined> {
    return this.maps.get(id);
  }
  async put(map: Omit<StoredMap, 'preview'> & { preview?: Uint8Array | null }): Promise<void> {
    const preview = map.preview !== undefined ? map.preview : (this.maps.get(map.summary.id)?.preview ?? null);
    this.maps.set(map.summary.id, { summary: map.summary, file: map.file, preview });
  }
  async delete(id: string): Promise<void> {
    this.maps.delete(id);
  }
  async preview(id: string): Promise<Uint8Array | null> {
    return this.maps.get(id)?.preview ?? null;
  }
  async setPreview(id: string, preview: Uint8Array | null): Promise<void> {
    const m = this.maps.get(id);
    if (m) m.preview = preview;
  }
  async list(): Promise<MapSummary[]> {
    return [...this.maps.values()].map((m) => m.summary);
  }
}

const DB_NAME = '3dtd-maps';
const DB_VERSION = 2;
/** Packed maps by id */
const FILES = 'files';
/** Summaries by id, so the list never reads the files */
const SUMMARIES = 'summaries';
/** Thumbnails by id (version 2; before, they sat in the file records) */
const PREVIEWS = 'previews';

export class IndexedDbMapBackend implements MapStorageBackend {
  private db: Promise<IDBDatabase> | null = null;

  async get(id: string): Promise<StoredMap | undefined> {
    const db = await this.open();
    const tx = db.transaction([FILES, SUMMARIES, PREVIEWS], 'readonly');
    const [file, summary, preview] = await Promise.all([
      request<{ id: string; file: Uint8Array; preview?: Uint8Array | null } | undefined>(tx.objectStore(FILES).get(id)),
      request<MapSummary | undefined>(tx.objectStore(SUMMARIES).get(id)),
      request<{ id: string; preview: Uint8Array } | undefined>(tx.objectStore(PREVIEWS).get(id)),
    ]);
    if (!file || !summary) return undefined;
    return { summary, file: file.file, preview: preview?.preview ?? file.preview ?? null };
  }

  async put(map: Omit<StoredMap, 'preview'> & { preview?: Uint8Array | null }): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([FILES, SUMMARIES, PREVIEWS], 'readwrite');
    tx.objectStore(FILES).put({ id: map.summary.id, file: map.file });
    tx.objectStore(SUMMARIES).put(map.summary);
    if (map.preview) tx.objectStore(PREVIEWS).put({ id: map.summary.id, preview: map.preview });
    else if (map.preview === null) tx.objectStore(PREVIEWS).delete(map.summary.id);
    await done(tx);
  }

  async delete(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([FILES, SUMMARIES, PREVIEWS], 'readwrite');
    tx.objectStore(FILES).delete(id);
    tx.objectStore(SUMMARIES).delete(id);
    tx.objectStore(PREVIEWS).delete(id);
    await done(tx);
  }

  async preview(id: string): Promise<Uint8Array | null> {
    const db = await this.open();
    const row = await request<{ preview: Uint8Array } | undefined>(db.transaction(PREVIEWS, 'readonly').objectStore(PREVIEWS).get(id));
    if (row) return row.preview;
    // A map saved before the thumbnails had their own store
    const old = await request<{ preview?: Uint8Array | null } | undefined>(db.transaction(FILES, 'readonly').objectStore(FILES).get(id));
    return old?.preview ?? null;
  }

  async setPreview(id: string, preview: Uint8Array | null): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(PREVIEWS, 'readwrite');
    if (preview) tx.objectStore(PREVIEWS).put({ id, preview });
    else tx.objectStore(PREVIEWS).delete(id);
    await done(tx);
  }

  async list(): Promise<MapSummary[]> {
    const db = await this.open();
    return request<MapSummary[]>(db.transaction(SUMMARIES, 'readonly').objectStore(SUMMARIES).getAll());
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new MapStoreError('This browser keeps no maps (IndexedDB is off).'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(SUMMARIES)) db.createObjectStore(SUMMARIES, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(PREVIEWS)) db.createObjectStore(PREVIEWS, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new MapStoreError('The map storage did not open.'));
    });
    return this.db;
  }
}

function request<T>(req: IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new MapStoreError('The map was not saved.'));
  });
}
