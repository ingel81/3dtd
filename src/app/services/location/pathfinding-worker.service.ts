import { Injectable } from '@angular/core';
import { StreetNetwork, StreetNode } from '../../interfaces/street-network-provider.interface';
import type {
  SerializedStreetNetwork,
  WorkerInMessage,
  WorkerOutMessage,
} from '../../workers/pathfinding.worker';

/**
 * PathfindingWorkerService
 *
 * Manages a Web Worker for offloading A* pathfinding from the main thread.
 * Falls back to synchronous (main-thread) pathfinding if Web Workers
 * are not supported or if the worker fails to initialize.
 *
 * Usage:
 *   1. Call `initialize(network, fallbackFindPath)` with the street network
 *   2. Call `findPath(...)` which returns a Promise<StreetNode[]>
 *   3. If worker is unavailable, the fallback function is used synchronously
 */
@Injectable({ providedIn: 'root' })
export class PathfindingWorkerService {
  private worker: Worker | null = null;
  private workerReady = false;
  private pendingRequests = new Map<string, {
    resolve: (path: StreetNode[]) => void;
    reject: (err: Error) => void;
  }>();
  private requestCounter = 0;

  /** Fallback: synchronous findPath for when worker is unavailable */
  private fallbackFindPath:
    | ((network: StreetNetwork, startLat: number, startLon: number, endLat: number, endLon: number) => StreetNode[])
    | null = null;
  private fallbackNetwork: StreetNetwork | null = null;

  /**
   * Whether the worker is available and ready
   */
  get isWorkerAvailable(): boolean {
    return this.worker !== null && this.workerReady;
  }

  /**
   * Initialize the worker with a street network.
   * If Web Workers aren't supported, silently falls back to main thread.
   *
   * @param network The street network to use for pathfinding
   * @param fallbackFindPath Synchronous findPath function for fallback
   * @returns Promise that resolves when worker is ready (or immediately if fallback)
   */
  async initialize(
    network: StreetNetwork,
    fallbackFindPath: (
      network: StreetNetwork,
      startLat: number,
      startLon: number,
      endLat: number,
      endLon: number
    ) => StreetNode[]
  ): Promise<void> {
    this.fallbackFindPath = fallbackFindPath;
    this.fallbackNetwork = network;

    // Check Web Worker support
    if (typeof Worker === 'undefined') {
      console.warn('[PathfindingWorker] Web Workers not supported, using main thread fallback');
      return;
    }

    try {
      // Terminate previous worker if any
      this.dispose();

      // Create worker using Angular's worker syntax
      this.worker = new Worker(
        new URL('../../workers/pathfinding.worker', import.meta.url),
        { type: 'module' }
      );

      // Set up message handler
      this.worker.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
        this.handleWorkerMessage(event.data);
      };

      this.worker.onerror = (error) => {
        console.error('[PathfindingWorker] Worker error:', error);
        this.handleWorkerFailure();
      };

      // Send initialization data
      const serialized = this.serializeNetwork(network);
      const initMsg: WorkerInMessage = { type: 'init', network: serialized };

      return new Promise<void>((resolve, _reject) => {
        // Set up one-time init listener
        const originalHandler = this.worker!.onmessage;
        // Guards against a race between a late worker init response and the
        // 5s timeout below: the timeout calls handleWorkerFailure() which sets
        // this.worker = null, so a late message must not deref it (TypeError).
        let settled = false;
        this.worker!.onmessage = (event: MessageEvent<WorkerOutMessage>) => {
          if (settled || !this.worker) return;
          const msg = event.data;
          if (msg.type === 'initDone') {
            settled = true;
            this.workerReady = true;
            this.worker.onmessage = originalHandler;
            console.log('[PathfindingWorker] Worker initialized and ready');
            resolve();
          } else if (msg.type === 'error') {
            settled = true;
            console.error('[PathfindingWorker] Init error:', msg.message);
            this.worker.onmessage = originalHandler;
            this.handleWorkerFailure();
            resolve(); // Resolve anyway - we'll use fallback
          }
        };

        this.worker!.postMessage(initMsg);

        // Timeout: if worker doesn't respond in 5s, fall back
        setTimeout(() => {
          if (settled) return;
          settled = true;
          console.warn('[PathfindingWorker] Init timeout, using fallback');
          this.handleWorkerFailure();
          resolve();
        }, 5000);
      });
    } catch (e) {
      console.warn('[PathfindingWorker] Failed to create worker, using fallback:', e);
      this.worker = null;
    }
  }

  /**
   * Re-initialize with a new street network (e.g. on location change).
   */
  async reinitialize(
    network: StreetNetwork,
    fallbackFindPath: (
      network: StreetNetwork,
      startLat: number,
      startLon: number,
      endLat: number,
      endLon: number
    ) => StreetNode[]
  ): Promise<void> {
    // Cancel pending requests
    for (const [_id, pending] of this.pendingRequests) {
      pending.reject(new Error('Reinitializing worker'));
    }
    this.pendingRequests.clear();
    this.workerReady = false;

    return this.initialize(network, fallbackFindPath);
  }

  /**
   * Find path asynchronously.
   * Uses Web Worker if available, otherwise falls back to synchronous main-thread.
   */
  findPath(
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ): Promise<StreetNode[]> {
    // Use worker if available
    if (this.isWorkerAvailable) {
      return this.findPathViaWorker(startLat, startLon, endLat, endLon);
    }

    // Fallback to synchronous
    return this.findPathFallback(startLat, startLon, endLat, endLon);
  }

  /**
   * Synchronous findPath for callers that can't go async.
   * Always uses main-thread fallback.
   */
  findPathSync(
    network: StreetNetwork,
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ): StreetNode[] {
    if (this.fallbackFindPath && network) {
      return this.fallbackFindPath(network, startLat, startLon, endLat, endLon);
    }
    return [];
  }

  /**
   * Dispose the worker and clean up.
   */
  dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error('Worker disposed'));
    }
    this.pendingRequests.clear();
  }

  // ========================================
  // PRIVATE
  // ========================================

  private findPathViaWorker(
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ): Promise<StreetNode[]> {
    const id = `path_${this.requestCounter++}`;

    return new Promise<StreetNode[]>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      const msg: WorkerInMessage = {
        type: 'findPath',
        id,
        startLat,
        startLon,
        endLat,
        endLon,
      };

      this.worker!.postMessage(msg);

      // Timeout: if worker doesn't respond in 10s, use fallback
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          console.warn(`[PathfindingWorker] Request ${id} timed out, using fallback`);
          this.findPathFallback(startLat, startLon, endLat, endLon).then(resolve).catch(reject);
        }
      }, 10000);
    });
  }

  private findPathFallback(
    startLat: number,
    startLon: number,
    endLat: number,
    endLon: number
  ): Promise<StreetNode[]> {
    if (this.fallbackFindPath && this.fallbackNetwork) {
      const result = this.fallbackFindPath(this.fallbackNetwork, startLat, startLon, endLat, endLon);
      return Promise.resolve(result);
    }
    return Promise.resolve([]);
  }

  private handleWorkerMessage(msg: WorkerOutMessage): void {
    switch (msg.type) {
      case 'pathResult': {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          pending.resolve(msg.path);
        }
        break;
      }
      case 'error': {
        if (msg.id) {
          const pending = this.pendingRequests.get(msg.id);
          if (pending) {
            this.pendingRequests.delete(msg.id);
            console.warn(`[PathfindingWorker] Error for ${msg.id}:`, msg.message);
            // Fall back to sync for this request
            pending.resolve([]); // Return empty path rather than rejecting
          }
        } else {
          console.error('[PathfindingWorker] Worker error:', msg.message);
        }
        break;
      }
    }
  }

  private handleWorkerFailure(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.workerReady = false;
    console.warn('[PathfindingWorker] Falling back to main thread pathfinding');
  }

  /**
   * Serialize StreetNetwork for transfer to worker.
   * Converts Map to array of entries (Maps aren't structured-cloneable).
   */
  private serializeNetwork(network: StreetNetwork): SerializedStreetNetwork {
    return {
      streets: network.streets,
      nodes: Array.from(network.nodes.entries()),
      bounds: network.bounds,
    };
  }
}
