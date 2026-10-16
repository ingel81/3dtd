import { InjectionToken } from '@angular/core';
import { LEGACY_AUTOSAVE_MAP_SLOT, AUTOSAVE_BUILT_SLOT } from './save-game.port';

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
  /** The place's HQ, to tell whether the save is at the place loaded; slots from before 0.7 have none */
  hq?: { lat: number; lon: number };
  /** The custom map the run plays on; absent on a real place */
  map?: { id: string; name: string };
  /** The world of the globes the run plays in (an autosave's is its slot's); absent in slots of before */
  world?: 'real' | 'osm' | 'maps';
}

/** The slots, wherever they are kept */
export interface SaveSlotStore {
  /** `listener` hears every write and removal, so who lists the slots reads them again (WatchedSlotStore); returns the unsubscribe */
  watch?(listener: () => void): () => void;
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

/**
 * The slots of this browser as the game and the globes share them: every
 * write and removal is told to the watchers, so a list shown anywhere (the
 * globes' Continue, the Load page, a game kept behind the globes) reads them
 * again at once (docs/WORLDS_STATE_PLAN.md, 6). Before the first list, a
 * slot of the shared map autosave of before (LEGACY_AUTOSAVE_MAP_SLOT) moves
 * to the Built Worlds' autosave: the OpenStreetMap maps of then count as
 * Built Worlds (decision 6).
 */
export class WatchedSlotStore implements SaveSlotStore {
  private readonly listeners = new Set<() => void>();
  private migrated: Promise<void> | null = null;

  constructor(private readonly inner: SaveSlotStore) {}

  async list(): Promise<StoredSlotMeta[]> {
    await (this.migrated ??= this.migrate());
    return this.inner.list();
  }

  async read(id: string): Promise<string | null | typeof UNREADABLE> {
    await (this.migrated ??= this.migrate());
    return this.inner.read(id);
  }

  async write(meta: StoredSlotMeta, text: string): Promise<boolean> {
    const written = await this.inner.write(meta, text);
    this.changed();
    return written;
  }

  async remove(id: string): Promise<void> {
    await this.inner.remove(id);
    this.changed();
  }

  watch(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private async migrate(): Promise<void> {
    const slots = await this.inner.list();
    const legacy = slots.find((m) => m.id === LEGACY_AUTOSAVE_MAP_SLOT);
    if (!legacy) return;
    if (!slots.some((m) => m.id === AUTOSAVE_BUILT_SLOT)) {
      const text = await this.inner.read(LEGACY_AUTOSAVE_MAP_SLOT);
      if (typeof text !== 'string' || !(await this.inner.write({ ...legacy, id: AUTOSAVE_BUILT_SLOT, world: 'maps' }, text))) return;
    }
    await this.inner.remove(LEGACY_AUTOSAVE_MAP_SLOT);
  }
}

/** The slots of this browser, one store for the game and the globes; a spec hands in its own */
export const SAVE_SLOT_STORE = new InjectionToken<SaveSlotStore>('SAVE_SLOT_STORE', {
  providedIn: 'root',
  factory: () => new WatchedSlotStore(new IdbSaveSlotStore()),
});
