/**
 * The version history of each map: every manual save, and an autosave at
 * most every few minutes, kept as the packed `.3dtdmap` bytes in this
 * browser's IndexedDB (`3dtd-editor-history`). A crash or a wrong turn costs
 * at most a few minutes. Older versions thin out instead of falling off the
 * end (`thinVersions`: every version of the last hour, one an hour for a
 * day, one a day for a month, one a week before), so frequent saving keeps
 * a way back to last week; a pinned version always stays.
 *
 * A version belongs to one map's life: its id and its creation time, so a
 * new map that takes the id of a deleted one starts without versions (and
 * the old ones go). The list reads only small records; the bytes stay in
 * their own store until a version is put back.
 */

export interface MapVersion {
  /** `<map id>:<time>` */
  key: string;
  mapId: string;
  /** The map's creation time: the map's life the version belongs to */
  created: string;
  savedAt: string;
  manual: boolean;
  /** Size of the packed file */
  size: number;
  /** A cheap fingerprint, so an unchanged map is not kept twice */
  sum: number;
  /** Kept whatever the thinning says */
  pinned?: boolean;
}

export interface VersionBackend {
  list(mapId: string): Promise<MapVersion[]>;
  put(version: MapVersion, bytes: Uint8Array): Promise<void>;
  /** A version's record anew (its bytes stay) */
  update(version: MapVersion): Promise<void>;
  bytes(key: string): Promise<Uint8Array | null>;
  delete(keys: readonly string[]): Promise<void>;
}

export class MemoryVersionBackend implements VersionBackend {
  private readonly items = new Map<string, { version: MapVersion; bytes: Uint8Array }>();
  async list(mapId: string): Promise<MapVersion[]> {
    return [...this.items.values()].filter((v) => v.version.mapId === mapId).map((v) => v.version);
  }
  async put(version: MapVersion, bytes: Uint8Array): Promise<void> {
    this.items.set(version.key, { version, bytes });
  }
  async update(version: MapVersion): Promise<void> {
    const item = this.items.get(version.key);
    if (item) item.version = version;
  }
  async bytes(key: string): Promise<Uint8Array | null> {
    return this.items.get(key)?.bytes ?? null;
  }
  async delete(keys: readonly string[]): Promise<void> {
    for (const k of keys) this.items.delete(k);
  }
}

const DB_NAME = '3dtd-editor-history';
/** The first history kept the bytes in the list; it goes */
const OLD_DB_NAME = '3dtd-editor-versions';
const META = 'versions';
const BYTES = 'bytes';

export class IndexedDbVersionBackend implements VersionBackend {
  private db: Promise<IDBDatabase> | null = null;

  async list(mapId: string): Promise<MapVersion[]> {
    const db = await this.open();
    return request<MapVersion[]>(db.transaction(META, 'readonly').objectStore(META).index('mapId').getAll(mapId));
  }

  async put(version: MapVersion, bytes: Uint8Array): Promise<void> {
    await this.write((tx) => {
      tx.objectStore(META).put(version);
      tx.objectStore(BYTES).put({ key: version.key, bytes });
    });
  }

  async update(version: MapVersion): Promise<void> {
    await this.write((tx) => tx.objectStore(META).put(version));
  }

  async bytes(key: string): Promise<Uint8Array | null> {
    const db = await this.open();
    const row = await request<{ bytes: Uint8Array } | undefined>(db.transaction(BYTES, 'readonly').objectStore(BYTES).get(key));
    return row?.bytes ?? null;
  }

  async delete(keys: readonly string[]): Promise<void> {
    if (!keys.length) return;
    await this.write((tx) => {
      for (const k of keys) {
        tx.objectStore(META).delete(k);
        tx.objectStore(BYTES).delete(k);
      }
    });
  }

  private async write(op: (tx: IDBTransaction) => void): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([META, BYTES], 'readwrite');
      op(tx);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      // A full disk aborts the transaction without an error event
      tx.onabort = () => reject(tx.error ?? new Error('The version was not kept (storage full?).'));
    });
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('This browser keeps no versions (IndexedDB is off).'));
        return;
      }
      try {
        indexedDB.deleteDatabase(OLD_DB_NAME);
      } catch {
        // nothing to clean up
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(META, { keyPath: 'key' }).createIndex('mapId', 'mapId');
        req.result.createObjectStore(BYTES, { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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

/** Unpinned versions kept per map at most, after thinning */
export const VERSIONS_KEPT = 40;
/** An autosave becomes a version at most this often */
export const AUTOSAVE_VERSION_MS = 3 * 60 * 1000;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Up to this age every version stays, then one per bucket of the given size */
const THINNING: readonly { upTo: number; bucket: number }[] = [
  { upTo: HOUR, bucket: 0 },
  { upTo: DAY, bucket: HOUR },
  { upTo: 30 * DAY, bucket: DAY },
  { upTo: Infinity, bucket: 7 * DAY },
];

/**
 * The versions to drop from one map's list: of each hour of the last day,
 * each day of the last month and each week before only the newest stays;
 * the last hour keeps all, pinned ones always stay, and past VERSIONS_KEPT
 * the oldest unpinned go.
 */
export function thinVersions(list: readonly MapVersion[], now: number): string[] {
  const newestFirst = [...list].sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  const seen = new Set<string>();
  const keep: MapVersion[] = [];
  const drop: string[] = [];
  for (const v of newestFirst) {
    if (v.pinned) continue;
    const at = Date.parse(v.savedAt);
    const age = Math.max(0, now - at);
    const rule = THINNING.find((r) => age < r.upTo)!;
    const bucket = rule.bucket ? `${rule.bucket}:${Math.floor(at / rule.bucket)}` : v.key;
    if (seen.has(bucket)) drop.push(v.key);
    else {
      seen.add(bucket);
      keep.push(v);
    }
  }
  return [...drop, ...keep.slice(VERSIONS_KEPT).map((v) => v.key)];
}

export class VersionHistory {
  constructor(private readonly backend: VersionBackend = new IndexedDbVersionBackend()) {}

  /** The versions of this life of the map, newest first */
  async list(mapId: string, created: string): Promise<MapVersion[]> {
    return (await this.backend.list(mapId)).filter((v) => v.created === created).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  /** A version's packed file */
  bytes(version: MapVersion): Promise<Uint8Array | null> {
    return this.backend.bytes(version.key);
  }

  /**
   * Keeps the bytes as a version unless they equal the newest one, or an
   * autosave comes too soon after the last version; thins the older ones
   * (thinVersions) and drops those of an earlier map of the same id.
   * Returns the new version, or null when nothing was kept.
   */
  async record(mapId: string, created: string, bytes: Uint8Array, manual: boolean, now = new Date()): Promise<MapVersion | null> {
    const all = await this.backend.list(mapId);
    const stale = all.filter((v) => v.created !== created).map((v) => v.key);
    const list = all.filter((v) => v.created === created).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    const sum = fingerprint(bytes);
    const newest = list[0];
    if (stale.length) await this.backend.delete(stale);
    if (newest && newest.sum === sum && newest.size === bytes.byteLength) return null;
    if (!manual && newest && now.getTime() - Date.parse(newest.savedAt) < AUTOSAVE_VERSION_MS) return null;
    const version: MapVersion = { key: `${mapId}:${now.getTime()}`, mapId, created, savedAt: now.toISOString(), manual, size: bytes.byteLength, sum };
    await this.backend.put(version, bytes.slice());
    await this.backend.delete(thinVersions([version, ...list], now.getTime()));
    return version;
  }

  /** Pins a version (thinning leaves it) or lets it go again */
  async pin(version: MapVersion, pinned: boolean): Promise<MapVersion> {
    const next: MapVersion = { ...version };
    if (pinned) next.pinned = true;
    else delete next.pinned;
    await this.backend.update(next);
    return next;
  }

  /** The versions of one life of a map go with it to another id (it came back from the trash under a free one) */
  async move(fromId: string, toId: string, created: string): Promise<void> {
    if (fromId === toId) return;
    const list = (await this.backend.list(fromId)).filter((v) => v.created === created);
    for (const v of list) {
      const bytes = await this.backend.bytes(v.key);
      if (!bytes) continue;
      const at = Date.parse(v.savedAt);
      await this.backend.put({ ...v, key: `${toId}:${at}`, mapId: toId }, bytes);
    }
    await this.backend.delete(list.map((v) => v.key));
  }

  /** Every version of one life of a map id (the map left the trash for good) */
  async clear(mapId: string, created: string): Promise<void> {
    await this.backend.delete((await this.backend.list(mapId)).filter((v) => v.created === created).map((v) => v.key));
  }
}

/** FNV-1a over the bytes */
export function fingerprint(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return h >>> 0;
}
