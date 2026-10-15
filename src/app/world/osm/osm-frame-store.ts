/**
 * What an OSM world is made of, kept per frame (place and side): the
 * Overpass answer and the heights, so the frame opened again and a second
 * making fetch nothing (docs/OSM_WORLD_PLAN.md, step 3). IndexedDB database
 * `3dtd-osm-frames`, the most recently used OSM_FRAMES_KEPT frames. Without
 * IndexedDB (Node, specs) a Map. Angular-free, used in the OSM worker.
 */
import type { DemMosaic } from './dem-tiles';
import type { OverpassResponse } from './overpass-client';

/** Frames kept; a city centre's answer is 15 to 20 MB */
export const OSM_FRAMES_KEPT = 6;

export interface StoredFrame {
  key: string;
  lat: number;
  lon: number;
  sideM: number;
  /** ISO time the Overpass answer came */
  fetchedAt: string;
  overpass: OverpassResponse;
  /** Null: no elevation source delivered; the next opening asks again */
  dem: DemMosaic | null;
  /** Why the sources failed, for the report */
  demFailed: string[];
  /** Last opened, ms since 1970 */
  usedAt: number;
}

export interface FrameBackend {
  get(key: string): Promise<StoredFrame | undefined>;
  put(frame: StoredFrame): Promise<void>;
  /** Keys with their last use, without reading the answers */
  uses(): Promise<{ key: string; usedAt: number }[]>;
  /** Marks a frame used now, without writing its answer again */
  touch(key: string, usedAt: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** The key of a frame: its place to about a metre, and its side */
export function frameKey(lat: number, lon: number, sideM: number): string {
  return `v1_${lat.toFixed(5)}_${lon.toFixed(5)}_${sideM}`;
}

export class OsmFrameStore {
  constructor(private readonly backend: FrameBackend = defaultFrameBackend()) {}

  /** The frame stored for this place, marked as used; null when none is (or the database does not open) */
  async load(lat: number, lon: number, sideM: number): Promise<StoredFrame | null> {
    try {
      const frame = await this.backend.get(frameKey(lat, lon, sideM));
      if (!frame) return null;
      frame.usedAt = Date.now();
      await this.backend.touch(frame.key, frame.usedAt);
      return frame;
    } catch {
      return null;
    }
  }

  /** Keeps a frame, dropping the least recently used beyond OSM_FRAMES_KEPT; a failure only costs the next download */
  async save(frame: Omit<StoredFrame, 'key' | 'usedAt'>): Promise<void> {
    try {
      const key = frameKey(frame.lat, frame.lon, frame.sideM);
      await this.backend.put({ ...frame, key, usedAt: Date.now() });
      const uses = (await this.backend.uses()).sort((a, b) => b.usedAt - a.usedAt);
      for (const old of uses.slice(OSM_FRAMES_KEPT)) await this.backend.delete(old.key);
    } catch (e) {
      console.warn('[OSM world] the frame was not kept', e);
    }
  }
}

/** A Map in place of the database */
export class MemoryFrameBackend implements FrameBackend {
  readonly frames = new Map<string, StoredFrame>();
  async get(key: string): Promise<StoredFrame | undefined> {
    return this.frames.get(key);
  }
  async put(frame: StoredFrame): Promise<void> {
    this.frames.set(frame.key, frame);
  }
  async uses(): Promise<{ key: string; usedAt: number }[]> {
    return [...this.frames.values()].map((f) => ({ key: f.key, usedAt: f.usedAt }));
  }
  async touch(key: string, usedAt: number): Promise<void> {
    const frame = this.frames.get(key);
    if (frame) frame.usedAt = usedAt;
  }
  async delete(key: string): Promise<void> {
    this.frames.delete(key);
  }
}

const DB_NAME = '3dtd-osm-frames';
const FRAMES = 'frames';
/** Last use per key, so eviction reads no answers */
const USES = 'uses';

class IdbFrameBackend implements FrameBackend {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(FRAMES, { keyPath: 'key' });
        request.result.createObjectStore(USES, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.db = null;
        reject(request.error);
      };
    });
    return this.db;
  }

  private async run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      const request = work(tx);
      tx.oncomplete = () => resolve(request ? request.result : (undefined as T));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  get(key: string): Promise<StoredFrame | undefined> {
    return this.run<StoredFrame | undefined>([FRAMES], 'readonly', (tx) => tx.objectStore(FRAMES).get(key));
  }

  put(frame: StoredFrame): Promise<void> {
    return this.run<void>([FRAMES, USES], 'readwrite', (tx) => {
      tx.objectStore(FRAMES).put(frame);
      tx.objectStore(USES).put({ key: frame.key, usedAt: frame.usedAt });
    });
  }

  uses(): Promise<{ key: string; usedAt: number }[]> {
    return this.run<{ key: string; usedAt: number }[]>([USES], 'readonly', (tx) => tx.objectStore(USES).getAll());
  }

  touch(key: string, usedAt: number): Promise<void> {
    return this.run<void>([USES], 'readwrite', (tx) => {
      tx.objectStore(USES).put({ key, usedAt });
    });
  }

  delete(key: string): Promise<void> {
    return this.run<void>([FRAMES, USES], 'readwrite', (tx) => {
      tx.objectStore(FRAMES).delete(key);
      tx.objectStore(USES).delete(key);
    });
  }
}

function defaultFrameBackend(): FrameBackend {
  return typeof indexedDB === 'undefined' ? new MemoryFrameBackend() : new IdbFrameBackend();
}
