import { groundJobMap, groundJobTransfer, runGroundJob, type GroundJob, type GroundJobMap, type GroundJobResult, type GroundJobResults } from './ground-jobs';
import type { FarShadowTexels, GroundBaker, SampleRect, ShapePatch } from './ground-shape';

/**
 * Works the ground's shape of a map that holds still (the game, the map
 * preview) out in a worker of its own: occlusion, curvature and drainage,
 * the closeness to lava and the far shadow, from one copy of the map taken
 * as the view is made. The view's GroundBaker there; the editor's follows
 * the edits instead (editor-ground.ts). Where there are no workers, or the
 * worker fails, the jobs run here.
 */
export class GroundWorker implements GroundBaker {
  private worker: Worker | null = null;
  /** The map (it holds still), for the jobs run here when there is no worker or it fails */
  private map: GroundJobMap | null;
  private jobs = 0;
  private readonly waiting = new Map<number, { job: GroundJob; resolve: (result: GroundJobResult | null) => void }>();
  private disposed = false;

  constructor(terrain: GroundJobMap) {
    this.map = terrain;
    if (typeof Worker === 'undefined') return;
    const worker = new Worker(new URL('./ground-jobs.worker', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; result: GroundJobResult }>) => {
      this.waiting.get(e.data.id)?.resolve(e.data.result);
      this.waiting.delete(e.data.id);
    };
    // A worker that fails: what waits and what comes runs here
    worker.onerror = () => this.fail();
    // A copy of its own, handed over
    const copy = groundJobMap(terrain);
    worker.postMessage({ map: copy }, groundJobTransfer(copy));
    this.worker = worker;
  }

  shape(rect: SampleRect | null): Promise<ShapePatch | null> {
    return this.ask({ kind: 'shape', rect });
  }

  lava(): Promise<GroundJobResults['lava'] | null> {
    return this.ask({ kind: 'lava' });
  }

  farShadow(sunDir: { x: number; y: number; z: number }): Promise<FarShadowTexels | null> {
    return this.ask({ kind: 'farShadow', sunDir: { x: sunDir.x, y: sunDir.y, z: sunDir.z } });
  }

  /** The view goes: the worker ends, what waits gets nothing */
  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.map = null;
    for (const { resolve } of this.waiting.values()) resolve(null);
    this.waiting.clear();
  }

  private ask<R extends GroundJobResult>(job: GroundJob): Promise<R | null> {
    if (this.disposed) return Promise.resolve(null);
    if (!this.worker) return Promise.resolve(runGroundJob(this.map!, job) as R);
    const id = ++this.jobs;
    return new Promise((resolve) => {
      this.waiting.set(id, { job, resolve: resolve as (result: GroundJobResult | null) => void });
      this.worker!.postMessage({ id, job });
    });
  }

  private fail(): void {
    this.worker?.terminate();
    this.worker = null;
    const waiting = [...this.waiting.values()];
    this.waiting.clear();
    for (const { job, resolve } of waiting) resolve(this.disposed ? null : runGroundJob(this.map!, job));
  }
}
