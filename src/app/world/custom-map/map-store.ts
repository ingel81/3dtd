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
import { mapDataFetch, mapDataRoot } from './map-data';
import { defaultMapBackend, FolderMapBackend, mapFolderId } from './folder-map-backend';
import type { CustomMapDocument, MapBiome } from './map-document';
import { contentHash, packMapFile, unpackMapFile } from './map-file';
import { slugMapId } from './map-create';

/**
 * Where a map came from: made or imported here ('own'), shipped with the
 * game, or received from a coop host ('shared', a copy the next version of
 * the host's map replaces; the editor opens it only as a copy). A deleted own
 * map waits in the trash ('trashed') under a key of its own, TRASH_DAYS long.
 */
export type MapOrigin = 'own' | 'shipped' | 'shared' | 'trashed';

/** Days a deleted map waits in the trash before it goes for good */
export const TRASH_DAYS = 30;
const TRASH_PREFIX = 'trash-';

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
  /** The map's lasting identity (MapMeta.uid); absent in summaries of maps not saved since the field */
  uid?: string;
  /** In the trash: the id the map had, when it was deleted, its creation time (the life its versions belong to) */
  trash?: { from: string; at: string; created: string };
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
  /** Fetches shipped files; relative to `baseUrl`. The map data's cache by default (map-data.ts) */
  fetch?: (url: string) => Promise<Response>;
  /** Base for `maps/…`, the map data's root by default (mapDataRoot: runtime-config.json `mapData`, else the page) */
  baseUrl?: string;
}

export class MapStore {
  private readonly backend: MapStorageBackend;
  private readonly fetcher: (url: string) => Promise<Response>;
  private readonly baseUrl: string | null;
  private shippedIndex: Promise<ShippedMapEntry[]> | null = null;

  constructor(options: MapStoreOptions = {}) {
    this.backend = options.backend ?? defaultMapBackend();
    this.fetcher = options.fetch ?? ((url) => mapDataFetch(url));
    this.baseUrl = options.baseUrl ?? null;
  }

  /** The own and the coop hosts' maps, newest first (the trash not) */
  async listOwn(): Promise<MapSummary[]> {
    const list = await this.backend.list();
    // A broken summary must not empty the list: missing times sort last
    const time = (m: MapSummary) => (typeof m.updatedAt === 'string' ? m.updatedAt : '');
    return list.filter((m) => m && typeof m.id === 'string' && m.origin !== 'trashed').sort((a, b) => time(b).localeCompare(time(a)));
  }

  /** The maps in the trash, last deleted first */
  async listTrash(): Promise<MapSummary[]> {
    const list = (await this.backend.list()).filter((m) => m?.origin === 'trashed' && m.trash);
    return list.sort((a, b) => b.trash!.at.localeCompare(a.trash!.at));
  }

  /**
   * Moves an own map to the trash: it leaves the lists (and in the desktop
   * app the map folder) and waits under a key of its own, so a new map may
   * take its id meanwhile. Returns the trash key.
   */
  async trash(id: string, now = new Date()): Promise<string> {
    const stored = await this.backend.get(id);
    if (!stored || stored.summary.origin !== 'own') throw new MapStoreError(`There is no own map "${id}" to delete.`);
    const { doc } = unpackMapFile(stored.file);
    const key = `${TRASH_PREFIX}${now.getTime()}-${id}`;
    const summary: MapSummary = { ...stored.summary, id: key, origin: 'trashed', trash: { from: id, at: now.toISOString(), created: doc.meta.createdAt } };
    await this.backend.put({ summary, file: stored.file, preview: stored.preview });
    await this.backend.delete(id);
    return key;
  }

  /** Puts a map from the trash back among the own maps, under its id or a free one when that is taken; returns the id */
  async restoreFromTrash(key: string): Promise<string> {
    const stored = await this.backend.get(key);
    if (!stored?.summary.trash) throw new MapStoreError('That map is no longer in the trash.');
    const { doc, preview } = unpackMapFile(stored.file);
    doc.meta.id = await this.freeId(stored.summary.trash.from, key);
    await this.save(doc, stored.preview ?? preview);
    await this.backend.delete(key);
    return doc.meta.id;
  }

  /** Maps longer than TRASH_DAYS in the trash go for good; returns what went */
  async purgeTrash(now = new Date()): Promise<MapSummary[]> {
    const limit = now.getTime() - TRASH_DAYS * 86_400_000;
    const old = (await this.listTrash()).filter((m) => Date.parse(m.trash!.at) < limit);
    for (const m of old) await this.backend.delete(m.id);
    return old;
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
      const stored = await this.backend.get(id);
      // A map in the trash plays nowhere until it comes back
      const own = stored?.summary.origin === 'trashed' ? undefined : stored;
      if (own) {
        const { doc, preview } = unpackMapFile(own.file);
        const summary = own.summary.contentHash ? own.summary : { ...own.summary, contentHash: await contentHash(doc) };
        return { doc, summary, preview: own.preview ?? preview };
      }
      if (origin === 'own') throw new MapStoreError(`There is no own map "${id}" in this browser; it may have been deleted.`);
    }
    const entry = (await this.readIndex()).find((e) => e.id === id);
    if (!entry) throw new MapStoreError(`There is no map "${id}" in this browser; it may have been deleted.`);
    // Named with its content: the cache keeps each version of the map apart
    const version = entry.contentHash ? `?v=${encodeURIComponent(entry.contentHash)}` : '';
    const response = await this.fetcher(this.url(`maps/${entry.file}${version}`));
    if (!response.ok) throw new MapStoreError(`The map "${entry.name}" did not load (${response.status}).`);
    const { doc, preview } = unpackMapFile(new Uint8Array(await response.arrayBuffer()));
    const hash = await contentHash(doc);
    return { doc, summary: { ...summarize(doc, 'shipped', hash) }, preview };
  }

  /** Packs and stores an own map (or stores `file`, packed already); returns its new summary */
  async save(
    doc: CustomMapDocument,
    preview: Uint8Array | null = null,
    file?: Uint8Array,
    options: SaveOptions = {},
  ): Promise<MapSummary> {
    // The first save gives the map its identity; a file packed before carries none yet
    if (!doc.meta.uid) {
      doc.meta.uid = newMapUid();
      file = undefined;
    }
    file ??= packMapFile(doc);
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

  /**
   * Stores a read file as a new own map: under a fresh id when the id is
   * taken, with a new identity when an own map has the file's (both stay)
   */
  async importDocument({ doc, preview }: Pick<LoadedMap, 'doc' | 'preview'>): Promise<LoadedMap> {
    if ((await this.has(doc.meta.id)) || (await this.idsInUse()).has(doc.meta.id)) doc.meta.id = await this.freeId(doc.meta.id);
    if (doc.meta.uid && (await this.listOwn()).some((m) => m.uid === doc.meta.uid)) doc.meta.uid = newMapUid();
    const summary = await this.save(doc, preview);
    return { doc, summary, preview };
  }

  /** Stores a `.3dtdmap` file as a new own map (importDocument) */
  async importFile(bytes: Uint8Array): Promise<LoadedMap> {
    return this.importDocument(unpackMapFile(bytes));
  }

  /**
   * The own map a read file is another version of: the same identity
   * (MapMeta.uid), or for a Warcraft import the same source file
   */
  async ownMatch(doc: CustomMapDocument): Promise<MapSummary | null> {
    const own = (await this.listOwn()).filter((m) => m.origin === 'own');
    const uid = doc.meta.uid;
    const source = doc.meta.source?.file;
    return own.find((m) => (uid && m.uid === uid) || (!uid && source && m.importedFrom === source)) ?? null;
  }

  /**
   * Puts a read file's content in place of an own map: its id, identity and
   * creation time stay (so its versions stay its own); returns the map's
   * file from before, for a version to go back to
   */
  async replaceWith(id: string, { doc, preview }: Pick<LoadedMap, 'doc' | 'preview'>): Promise<{ before: Uint8Array; created: string }> {
    const stored = await this.backend.get(id);
    if (!stored || stored.summary.origin !== 'own') throw new MapStoreError(`There is no own map "${id}" to replace.`);
    const old = unpackMapFile(stored.file).doc.meta;
    doc.meta = { ...doc.meta, id, uid: old.uid ?? doc.meta.uid, createdAt: old.createdAt, updatedAt: new Date().toISOString() };
    await this.save(doc, preview);
    return { before: stored.file, created: old.createdAt };
  }

  /** A new thumbnail for an own map, its content untouched */
  async setPreview(id: string, preview: Uint8Array): Promise<void> {
    await this.backend.setPreview(id, preview);
  }

  /** Removes a map for good (an own map: use trash; this is for the trash and coop maps) */
  async delete(id: string): Promise<void> {
    await this.backend.delete(id);
  }

  /** A copy of any map as a new own map */
  async duplicate(id: string, name?: string, origin?: MapOrigin): Promise<LoadedMap> {
    return this.saveCopy(await this.load(id, origin), name);
  }

  /** A loaded map stored as a new own map (fresh id and times, "(copy)" after the name unless `name` is given) */
  async saveCopy({ doc, preview }: Pick<LoadedMap, 'doc' | 'preview'>, name?: string): Promise<LoadedMap> {
    // A copy is a map of its own: a file of it read in later must not replace the original
    doc.meta.uid = newMapUid();
    const now = new Date().toISOString();
    doc.meta.name = name ?? `${doc.meta.name} (copy)`;
    doc.meta.id = await this.freeId(slugMapId(doc.meta.name));
    doc.meta.createdAt = now;
    doc.meta.updatedAt = now;
    const summary = await this.save(doc, preview);
    return { doc, summary, preview };
  }

  /**
   * `base`, or `base-2`, `base-3` … whichever no map uses yet. The id a map
   * in the trash had counts as used: its versions are kept under it, and a
   * new map of that id would drop them as those of an earlier map with its
   * first save (VersionHistory.record). `leaving`: the trash key of a map
   * coming back, whose own old id is free for it
   */
  async freeId(base: string, leaving?: string): Promise<string> {
    const stem = slugMapId(base).replace(/-\d+$/, '') || 'map';
    const taken = await this.idsInUse(leaving);
    if (!taken.has(base) && /^[a-z0-9]/.test(base) && slugMapId(base) === base) return base;
    for (let n = 2; ; n++) {
      const id = `${stem}-${n}`;
      if (!taken.has(id)) return id;
    }
  }

  /** The ids of stored and shipped maps and the ids the maps in the trash had (freeId) */
  private async idsInUse(leaving?: string): Promise<Set<string>> {
    const stored = await this.backend.list();
    return new Set([...stored.map((m) => m.id), ...stored.flatMap((m) => (m.trash && m.id !== leaving ? [m.trash.from] : [])), ...(await this.readIndex()).map((e) => e.id)]);
  }

  private readIndex(): Promise<ShippedMapEntry[]> {
    this.shippedIndex ??= this.fetcher(this.url('maps/index.json'))
      .then(async (r) => (r.ok ? ((await r.json()) as ShippedMapIndex).maps ?? [] : []))
      .catch(() => []);
    return this.shippedIndex;
  }

  private url(path: string): string {
    return new URL(path, this.baseUrl ?? mapDataRoot()).toString();
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
    ...(doc.meta.uid ? { uid: doc.meta.uid } : {}),
  };
}

/** A new lasting identity for a map */
export function newMapUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from({ length: 4 }, () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')).join('-');
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
