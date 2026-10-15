/**
 * The frame's line to the OSM worker (osm.worker.ts): one worker per frame,
 * holding the place's data from the opening to the making. Each call answers
 * by its id; steps go to the call's `onStep`. Aborting a call's signal or
 * running past `timeoutMs` ends the worker and every call waiting on it; the
 * next call starts a new one and opens the place again first (from the frame
 * store, nothing fetched). Where workers are missing (Node, specs) the work
 * runs on the calling thread, like the Warcraft import (w3x-import-client.ts).
 */
import type { OsmImportOptions } from './import-osm';
import { OsmFrameCore, type FrameSpawn, type GeoPoint, type OsmFrameInfo, type OsmMade, type OsmStep } from './osm-frame-core';
import type { OsmWorkerRequest, OsmWorkerResponse } from './osm-worker.types';

/** A call that has not answered after this long is ended (the Overpass limits are 105 s to the headers and 60 s for the body) */
export const OSM_CALL_TIMEOUT_MS = 180_000;

/** What an aborted call rejects with */
export const OSM_CANCELLED = 'Cancelled';

/** A request without its id, kind by kind */
type Call = OsmWorkerRequest extends infer R ? (R extends OsmWorkerRequest ? Omit<R, 'id'> : never) : never;

interface Waiting {
  resolve: (response: OsmWorkerResponse) => void;
  reject: (error: Error) => void;
  onStep?: (step: OsmStep) => void;
}

export interface OsmFrameSessionOptions {
  timeoutMs?: number;
  /** The worker; null runs on the calling thread. A spec hands in its own */
  createWorker?: () => Worker | null;
  /** The core of a session on the calling thread */
  core?: OsmFrameCore;
}

export class OsmFrameSession {
  private worker: Worker | null = null;
  private local: OsmFrameCore | null = null;
  private readonly waiting = new Map<number, Waiting>();
  private nextId = 1;
  /** The last opening, sent again to a new worker */
  private opening: Extract<Call, { kind: 'open' }> | null = null;
  /** The worker holds the place of `opening` */
  private loaded = false;
  private readonly timeoutMs: number;
  private readonly createWorker: () => Worker | null;

  constructor(options: OsmFrameSessionOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? OSM_CALL_TIMEOUT_MS;
    this.createWorker =
      options.createWorker ?? (() => (typeof Worker === 'undefined' ? null : new Worker(new URL('./osm.worker', import.meta.url), { type: 'module' })));
    this.local = options.core ?? null;
  }

  /** Loads the place and lays out its spawns (OsmFrameCore.open) */
  async open(place: GeoPoint & { address?: string }, count: number, spawnsAt: GeoPoint[] = [], onStep?: (step: OsmStep) => void, signal?: AbortSignal): Promise<OsmFrameInfo> {
    const call = { kind: 'open', place, count, spawnsAt } as const;
    this.opening = call;
    this.loaded = false;
    const r = await this.call(call, onStep, signal);
    this.loaded = true;
    return (r as Extract<OsmWorkerResponse, { kind: 'opened' }>).frame;
  }

  async draw(count: number, keep: GeoPoint[]): Promise<FrameSpawn[]> {
    const r = await this.callLoaded({ kind: 'draw', count, keep });
    return (r as Extract<OsmWorkerResponse, { kind: 'spawns' }>).spawns;
  }

  async drop(at: GeoPoint): Promise<FrameSpawn | { reason: string }> {
    const r = await this.callLoaded({ kind: 'drop', at });
    return (r as Extract<OsmWorkerResponse, { kind: 'dropped' }>).spawn;
  }

  async make(spawnsAt: GeoPoint[], options: OsmImportOptions, onStep?: (step: OsmStep) => void, signal?: AbortSignal): Promise<OsmMade> {
    const r = await this.callLoaded({ kind: 'make', spawnsAt, options }, onStep, signal);
    return (r as Extract<OsmWorkerResponse, { kind: 'made' }>).made;
  }

  /** Ends the worker */
  dispose(): void {
    this.stop(new Error(OSM_CANCELLED));
  }

  /** A call that needs the place: a new worker opens it first */
  private async callLoaded(call: Call, onStep?: (step: OsmStep) => void, signal?: AbortSignal): Promise<OsmWorkerResponse> {
    if (!this.loaded) {
      if (!this.opening) throw new Error('The place is not loaded');
      await this.call(this.opening, onStep, signal);
      this.loaded = true;
    }
    return this.call(call, onStep, signal);
  }

  private call(call: Call, onStep?: (step: OsmStep) => void, signal?: AbortSignal): Promise<OsmWorkerResponse> {
    if (signal?.aborted) return Promise.reject(new Error(OSM_CANCELLED));
    if (!this.worker && !this.local) {
      this.worker = this.createWorker();
      if (this.worker) this.listen(this.worker);
      else this.local = new OsmFrameCore();
    }
    if (this.local) return this.runLocal(this.local, call, onStep, signal);
    const worker = this.worker!;
    const id = this.nextId++;
    return new Promise<OsmWorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => this.stop(new Error(`No answer within ${Math.round(this.timeoutMs / 1000)} s; the work was stopped`)), this.timeoutMs);
      const onAbort = () => this.stop(new Error(OSM_CANCELLED));
      signal?.addEventListener('abort', onAbort, { once: true });
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.waiting.delete(id);
      };
      this.waiting.set(id, {
        onStep,
        resolve: (r) => {
          done();
          resolve(r);
        },
        reject: (e) => {
          done();
          reject(e);
        },
      });
      worker.postMessage({ ...call, id } as OsmWorkerRequest);
    });
  }

  private listen(worker: Worker): void {
    worker.onmessage = (event: MessageEvent<OsmWorkerResponse>) => {
      const r = event.data;
      const waiting = this.waiting.get(r.id);
      if (!waiting) return;
      if (r.kind === 'step') waiting.onStep?.(r.step);
      else if (r.kind === 'error') waiting.reject(new Error(r.error));
      else waiting.resolve(r);
    };
    worker.onerror = (event) => this.stop(new Error(event.message || 'The OSM worker failed'));
  }

  /** Ends the worker and rejects every call waiting on it */
  private stop(error: Error): void {
    this.worker?.terminate();
    this.worker = null;
    this.loaded = false;
    for (const waiting of [...this.waiting.values()]) waiting.reject(error);
    this.waiting.clear();
  }

  private async runLocal(core: OsmFrameCore, call: Call, onStep?: (step: OsmStep) => void, signal?: AbortSignal): Promise<OsmWorkerResponse> {
    const id = 0;
    switch (call.kind) {
      case 'open':
        return { id, kind: 'opened', frame: await core.open(call.place, call.count, call.spawnsAt, onStep, signal) };
      case 'draw':
        return { id, kind: 'spawns', spawns: core.draw(call.count, call.keep) };
      case 'drop':
        return { id, kind: 'dropped', spawn: core.drop(call.at) };
      case 'make':
        return { id, kind: 'made', made: core.make(call.spawnsAt, call.options, onStep) };
    }
  }
}
