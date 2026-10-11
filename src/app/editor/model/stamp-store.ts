/**
 * The stamp library: saved map pieces with a name and a picture, kept in
 * this browser's IndexedDB (`3dtd-editor-stamps`), shared by all maps.
 */
import type { Stamp } from '../ops/stamp';

export interface SavedStamp {
  id: string;
  name: string;
  createdAt: string;
  /** PNG data URL, the piece from above */
  preview: string | null;
  stamp: Stamp;
}

export interface StampBackend {
  list(): Promise<SavedStamp[]>;
  put(stamp: SavedStamp): Promise<void>;
  delete(id: string): Promise<void>;
}

export class MemoryStampBackend implements StampBackend {
  private readonly items = new Map<string, SavedStamp>();
  async list(): Promise<SavedStamp[]> {
    return [...this.items.values()];
  }
  async put(stamp: SavedStamp): Promise<void> {
    this.items.set(stamp.id, stamp);
  }
  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

const DB_NAME = '3dtd-editor-stamps';
const STORE = 'stamps';

export class IndexedDbStampBackend implements StampBackend {
  private db: Promise<IDBDatabase> | null = null;

  async list(): Promise<SavedStamp[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as SavedStamp[]);
      req.onerror = () => reject(req.error);
    });
  }

  async put(stamp: SavedStamp): Promise<void> {
    await this.write((store) => store.put(stamp));
  }

  async delete(id: string): Promise<void> {
    await this.write((store) => store.delete(id));
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
        reject(new Error('This browser keeps no stamps (IndexedDB is off).'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }
}

export class StampLibrary {
  constructor(private readonly backend: StampBackend = new IndexedDbStampBackend()) {}

  async list(): Promise<SavedStamp[]> {
    return (await this.backend.list()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async save(name: string, stamp: Stamp, preview: string | null, now = new Date()): Promise<SavedStamp> {
    const saved: SavedStamp = {
      id: `st-${now.getTime().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name: name.trim() || 'Stamp',
      createdAt: now.toISOString(),
      preview,
      stamp,
    };
    await this.backend.put(saved);
    return saved;
  }

  async rename(saved: SavedStamp, name: string): Promise<void> {
    await this.backend.put({ ...saved, name: name.trim() || saved.name });
  }

  async delete(id: string): Promise<void> {
    await this.backend.delete(id);
  }
}
