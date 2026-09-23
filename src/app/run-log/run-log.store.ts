/**
 * Where a player's runs are kept: the last {@link MAX_RUNS} in IndexedDB.
 *
 * Written per wave, not at the end: a closed tab then loses at most the
 * running wave, and nothing hangs on a `beforeunload` hook that browsers are
 * free to skip (docs/RUN_LOG.md).
 *
 * Nothing leaves the machine. Other players export their run and send the
 * file (decision D6).
 */

import type { RunLog, RunLogHead, RunLogRecord } from './run-log.types';

const DB_NAME = '3dtd-run-logs';
const DB_VERSION = 1;
const STORE = 'runs';

/** Runs kept; the oldest goes when a new one arrives. */
export const MAX_RUNS = 20;

/** A run as the store keeps it. */
export interface StoredRun {
  runId: string;
  startedAt: string;
  head: RunLogHead;
  records: RunLogRecord[];
  /** Waves the run reached, for the list in the menu. */
  waveReached: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'runId' }).createIndex('startedAt', 'startedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * The player's own runs in IndexedDB.
 *
 * Every call catches its own errors: a private window, blocked site data or a
 * full quota must never take the game down with them. A run that cannot be
 * kept is still played, it just is not stored.
 */
export class RunLogStore {
  private db: Promise<IDBDatabase> | null = null;

  private connect(): Promise<IDBDatabase> {
    this.db ??= openDb();
    return this.db;
  }

  /** Write the run under its id, replacing the previous state of it. */
  async save(run: RunLog, waveReached: number): Promise<boolean> {
    try {
      const db = await this.connect();
      const tx = db.transaction(STORE, 'readwrite');
      const stored: StoredRun = {
        runId: run.head.runId,
        startedAt: run.head.startedAt,
        head: run.head,
        records: run.records,
        waveReached,
      };
      tx.objectStore(STORE).put(stored);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      await this.trim();
      return true;
    } catch {
      return false;
    }
  }

  /** Every kept run, newest first. */
  async list(): Promise<StoredRun[]> {
    try {
      const db = await this.connect();
      const tx = db.transaction(STORE, 'readonly');
      const all = await asPromise(tx.objectStore(STORE).getAll() as IDBRequest<StoredRun[]>);
      return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    } catch {
      return [];
    }
  }

  /** One run, or null when it is gone. */
  async get(runId: string): Promise<StoredRun | null> {
    try {
      const db = await this.connect();
      const tx = db.transaction(STORE, 'readonly');
      return (await asPromise(tx.objectStore(STORE).get(runId) as IDBRequest<StoredRun | undefined>)) ?? null;
    } catch {
      return null;
    }
  }

  /** Delete one run. */
  async remove(runId: string): Promise<void> {
    try {
      const db = await this.connect();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(runId);
    } catch {
      // nothing to do: the run simply stays
    }
  }

  /** Delete every kept run. */
  async clear(): Promise<void> {
    try {
      const db = await this.connect();
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // nothing to do: the runs simply stay
    }
  }

  /** Keep only the newest MAX_RUNS. */
  private async trim(): Promise<void> {
    const all = await this.list();
    for (const run of all.slice(MAX_RUNS)) {
      await this.remove(run.runId);
    }
  }
}
