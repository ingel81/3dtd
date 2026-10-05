/**
 * Where the save game's slots are kept in this browser: IndexedDB, the head
 * of each slot apart from its text, so the menu's list does not read every
 * save (docs/SAVE_LOAD_PLAN.md, decision 2). Like the run log's store, every
 * call catches its own errors: a private window or a full quota costs the
 * slot, never the game. An open that never answers (some private windows, a
 * second tab holding an older version) gives up after OPEN_TIMEOUT_MS, so
 * the save game's queue never waits for good.
 */

/** A slot whose text the browser would not hand out (storage blocked, the database gone), apart from an empty one */
export const UNREADABLE = Symbol('unreadable');

/** Longest wait for the database to open, ms */
export const OPEN_TIMEOUT_MS = 5000;

/** What the list shows of a slot */
export interface StoredSlotMeta {
  id: string;
  name: string;
  wave: number;
  location: string;
  savedAt: string;
  gameVersion: string;
  configHash: string;
}

/** The slots, wherever they are kept */
export interface SaveSlotStore {
  list(): Promise<StoredSlotMeta[]>;
  /** The save's text, null for an empty slot, UNREADABLE when the browser would not hand it out */
  read(id: string): Promise<string | null | typeof UNREADABLE>;
  /** False when it could not be kept */
  write(meta: StoredSlotMeta, text: string): Promise<boolean>;
  remove(id: string): Promise<void>;
}

const DB_NAME = '3dtd-saves';
const DB_VERSION = 1;
const META = 'meta';
const DATA = 'data';

function openDb(timeoutMs: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error('IndexedDB did not answer'));
    }, timeoutMs);
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      // Answered after the wait was given up: nobody holds it
      if (settled) return request.result.close();
      settled = true;
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(request.error);
    };
  });
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export class IdbSaveSlotStore implements SaveSlotStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly openTimeoutMs = OPEN_TIMEOUT_MS) {}

  /** Opened once; a failed or closed connection is forgotten and opened again next time (as RunLogStore) */
  private connect(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    const opening = openDb(this.openTimeoutMs).then(
      (db) => {
        db.onclose = () => {
          if (this.db === opening) this.db = null;
        };
        // Another tab wants a newer version: let it, and open again next time
        db.onversionchange = () => {
          db.close();
          if (this.db === opening) this.db = null;
        };
        return db;
      },
      (error: unknown) => {
        if (this.db === opening) this.db = null;
        throw error;
      },
    );
    this.db = opening;
    return opening;
  }

  async list(): Promise<StoredSlotMeta[]> {
    try {
      const db = await this.connect();
      return await asPromise(db.transaction(META, 'readonly').objectStore(META).getAll() as IDBRequest<StoredSlotMeta[]>);
    } catch {
      return [];
    }
  }

  async read(id: string): Promise<string | null | typeof UNREADABLE> {
    try {
      const db = await this.connect();
      const row = await asPromise(db.transaction(DATA, 'readonly').objectStore(DATA).get(id) as IDBRequest<{ text: string } | undefined>);
      return row?.text ?? null;
    } catch {
      return UNREADABLE;
    }
  }

  async write(meta: StoredSlotMeta, text: string): Promise<boolean> {
    try {
      const db = await this.connect();
      // One transaction: the list never names a slot whose text did not land
      const tx = db.transaction([META, DATA], 'readwrite');
      tx.objectStore(DATA).put({ id: meta.id, text });
      tx.objectStore(META).put(meta);
      await done(tx);
      return true;
    } catch {
      return false;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      const db = await this.connect();
      const tx = db.transaction([META, DATA], 'readwrite');
      tx.objectStore(META).delete(id);
      tx.objectStore(DATA).delete(id);
      await done(tx);
    } catch {
      // The slot simply stays
    }
  }
}
