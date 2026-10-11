/**
 * The version history of each map: every manual save, and an autosave at
 * most every few minutes, kept as the packed `.3dtdmap` bytes in this
 * browser's IndexedDB (`3dtd-editor-versions`), the newest 20 per map. A
 * crash or a wrong turn costs at most a few minutes.
 */

export interface MapVersion {
  /** `<map id>:<time>` */
  key: string;
  mapId: string;
  savedAt: string;
  manual: boolean;
  /** The packed map file */
  bytes: Uint8Array;
  /** A cheap fingerprint, so an unchanged map is not kept twice */
  sum: number;
}

export interface VersionBackend {
  list(mapId: string): Promise<MapVersion[]>;
  put(version: MapVersion): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryVersionBackend implements VersionBackend {
  private readonly items = new Map<string, MapVersion>();
  async list(mapId: string): Promise<MapVersion[]> {
    return [...this.items.values()].filter((v) => v.mapId === mapId);
  }
  async put(version: MapVersion): Promise<void> {
    this.items.set(version.key, version);
  }
  async delete(key: string): Promise<void> {
    this.items.delete(key);
  }
}

const DB_NAME = '3dtd-editor-versions';
const STORE = 'versions';

export class IndexedDbVersionBackend implements VersionBackend {
  private db: Promise<IDBDatabase> | null = null;

  async list(mapId: string): Promise<MapVersion[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).index('mapId').getAll(mapId);
      req.onsuccess = () => resolve(req.result as MapVersion[]);
      req.onerror = () => reject(req.error);
    });
  }

  async put(version: MapVersion): Promise<void> {
    await this.write((store) => store.put(version));
  }

  async delete(key: string): Promise<void> {
    await this.write((store) => store.delete(key));
  }

  private async write(op: (store: IDBObjectStore) => void): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('This browser keeps no versions (IndexedDB is off).'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('mapId', 'mapId');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }
}

/** Versions kept per map */
export const VERSIONS_KEPT = 20;
/** An autosave becomes a version at most this often */
export const AUTOSAVE_VERSION_MS = 3 * 60 * 1000;

export class VersionHistory {
  constructor(private readonly backend: VersionBackend = new IndexedDbVersionBackend()) {}

  /** The map's versions, newest first */
  async list(mapId: string): Promise<MapVersion[]> {
    return (await this.backend.list(mapId)).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  }

  /**
   * Keeps the bytes as a version unless they equal the newest one, or an
   * autosave comes too soon after the last version; drops the oldest past
   * 20. Returns the new version, or null when nothing was kept.
   */
  async record(mapId: string, bytes: Uint8Array, manual: boolean, now = new Date()): Promise<MapVersion | null> {
    const list = await this.list(mapId);
    const sum = fingerprint(bytes);
    const newest = list[0];
    if (newest && newest.sum === sum && newest.bytes.byteLength === bytes.byteLength) return null;
    if (!manual && newest && now.getTime() - Date.parse(newest.savedAt) < AUTOSAVE_VERSION_MS) return null;
    const version: MapVersion = { key: `${mapId}:${now.getTime()}`, mapId, savedAt: now.toISOString(), manual, bytes: bytes.slice(), sum };
    await this.backend.put(version);
    for (const old of [version, ...list].slice(VERSIONS_KEPT)) await this.backend.delete(old.key);
    return version;
  }
}

/** FNV-1a over the bytes */
export function fingerprint(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return h >>> 0;
}
