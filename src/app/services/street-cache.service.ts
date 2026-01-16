import { Injectable } from '@angular/core';
import { StreetNetwork, StreetNode } from './osm-street.service';

/**
 * IndexedDB-based cache for street network data with LRU eviction.
 * Supports much larger data than localStorage (50-100+ MB vs 5-10 MB).
 */
@Injectable({
  providedIn: 'root',
})
export class StreetCacheService {
  private readonly DB_NAME = 'td_street_cache';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'streets';
  private readonly INDEX_STORE = 'lru_index';
  private readonly MAX_ENTRIES = 5; // LRU: Keep max 5 locations

  private db: IDBDatabase | null = null;
  private dbReady: Promise<IDBDatabase> | null = null;

  /**
   * Initialize IndexedDB connection
   */
  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    if (!this.dbReady) {
      this.dbReady = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

        request.onerror = () => {
          console.error('[StreetCache] IndexedDB error:', request.error);
          reject(request.error);
        };

        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // Store for street network data
          if (!db.objectStoreNames.contains(this.STORE_NAME)) {
            db.createObjectStore(this.STORE_NAME, { keyPath: 'key' });
          }

          // Store for LRU index (tracks access order)
          if (!db.objectStoreNames.contains(this.INDEX_STORE)) {
            db.createObjectStore(this.INDEX_STORE, { keyPath: 'id' });
          }
        };
      });
    }

    return this.dbReady;
  }

  /**
   * Generate cache key from coordinates
   */
  getCacheKey(lat: number, lon: number, radius: number): string {
    const roundedLat = Math.round(lat * 10000) / 10000;
    const roundedLon = Math.round(lon * 10000) / 10000;
    return `v1_${roundedLat}_${roundedLon}_${radius}`;
  }

  /**
   * Load street network from cache
   */
  async load(key: string): Promise<StreetNetwork | null> {
    try {
      const db = await this.getDB();

      return new Promise((resolve) => {
        const transaction = db.transaction([this.STORE_NAME, this.INDEX_STORE], 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
          const result = request.result;
          if (!result) {
            resolve(null);
            return;
          }

          // Update LRU timestamp
          this.updateLRU(key);

          // Reconstruct Map from array
          const nodes = new Map<number, StreetNode>();
          for (const [id, node] of result.nodesArray) {
            nodes.set(id, node);
          }

          resolve({
            streets: result.streets,
            nodes,
            bounds: result.bounds,
          });
        };

        request.onerror = () => {
          console.error('[StreetCache] Load error:', request.error);
          resolve(null);
        };
      });
    } catch {
      return null;
    }
  }

  /**
   * Save street network to cache with LRU eviction
   */
  async save(key: string, network: StreetNetwork): Promise<void> {
    try {
      const db = await this.getDB();

      // Prepare data (convert Map to array for storage)
      const data = {
        key,
        streets: network.streets,
        nodesArray: Array.from(network.nodes.entries()),
        bounds: network.bounds,
        timestamp: Date.now(),
      };

      // Enforce LRU limit before saving
      await this.enforceLRULimit();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.STORE_NAME, this.INDEX_STORE], 'readwrite');
        const store = transaction.objectStore(this.STORE_NAME);

        const request = store.put(data);

        request.onsuccess = () => {
          // Update LRU index
          this.updateLRU(key);
          resolve();
        };

        request.onerror = () => {
          console.error('[StreetCache] Save error:', request.error);
          reject(request.error);
        };
      });
    } catch (error) {
      console.error('[StreetCache] Save failed:', error);
    }
  }

  /**
   * Update LRU index - move key to front (most recently used)
   */
  private async updateLRU(key: string): Promise<void> {
    try {
      const db = await this.getDB();

      const transaction = db.transaction(this.INDEX_STORE, 'readwrite');
      const store = transaction.objectStore(this.INDEX_STORE);

      // Store with current timestamp
      store.put({ id: key, timestamp: Date.now() });
    } catch {
      // Silent fail - LRU is best-effort
    }
  }

  /**
   * Enforce LRU limit - remove oldest entries if over limit
   */
  private async enforceLRULimit(): Promise<void> {
    try {
      const db = await this.getDB();

      // Get all LRU entries
      const entries = await new Promise<{ id: string; timestamp: number }[]>((resolve) => {
        const transaction = db.transaction(this.INDEX_STORE, 'readonly');
        const store = transaction.objectStore(this.INDEX_STORE);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      });

      // If under limit, nothing to do
      if (entries.length < this.MAX_ENTRIES) {
        return;
      }

      // Sort by timestamp (oldest first)
      entries.sort((a, b) => a.timestamp - b.timestamp);

      // Remove oldest entries until under limit
      const toRemove = entries.slice(0, entries.length - this.MAX_ENTRIES + 1);

      const transaction = db.transaction([this.STORE_NAME, this.INDEX_STORE], 'readwrite');
      const streetStore = transaction.objectStore(this.STORE_NAME);
      const indexStore = transaction.objectStore(this.INDEX_STORE);

      for (const entry of toRemove) {
        streetStore.delete(entry.id);
        indexStore.delete(entry.id);
      }
    } catch (error) {
      console.error('[StreetCache] LRU enforcement failed:', error);
    }
  }

  /**
   * Clear all cached data
   */
  async clearAll(): Promise<void> {
    try {
      const db = await this.getDB();

      const transaction = db.transaction([this.STORE_NAME, this.INDEX_STORE], 'readwrite');
      transaction.objectStore(this.STORE_NAME).clear();
      transaction.objectStore(this.INDEX_STORE).clear();
    } catch (error) {
      console.error('[StreetCache] Clear failed:', error);
    }
  }

  /**
   * Clear specific cache entry
   */
  async clear(key: string): Promise<void> {
    try {
      const db = await this.getDB();

      const transaction = db.transaction([this.STORE_NAME, this.INDEX_STORE], 'readwrite');
      transaction.objectStore(this.STORE_NAME).delete(key);
      transaction.objectStore(this.INDEX_STORE).delete(key);
    } catch (error) {
      console.error('[StreetCache] Clear entry failed:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ count: number; keys: string[] }> {
    try {
      const db = await this.getDB();

      return new Promise((resolve) => {
        const transaction = db.transaction(this.INDEX_STORE, 'readonly');
        const store = transaction.objectStore(this.INDEX_STORE);
        const request = store.getAll();

        request.onsuccess = () => {
          const entries = request.result || [];
          resolve({
            count: entries.length,
            keys: entries.map((e) => e.id),
          });
        };

        request.onerror = () => resolve({ count: 0, keys: [] });
      });
    } catch {
      return { count: 0, keys: [] };
    }
  }
}
