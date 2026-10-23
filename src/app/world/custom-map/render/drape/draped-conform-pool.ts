/**
 * conformDraped in a few workers (draped-conform.worker.ts): a map's roads
 * laid onto the ground as it opens take most of a second on one thread
 * (0.9 s for Erlenbach's 590k triangles); split over workers they cost the
 * main thread only the copies, and the other loading goes on meanwhile.
 * Jobs are independent (one item's geometries each, as
 * RoadNetworkBuilder.layOnGround lays them) and come back in their order.
 */
import type { DrapedGeometry, DrapeGround } from './draped-refine';
import { conformedBuffers, type ConformJob, type ConformReply, type ConformRequest } from './draped-conform-protocol';

/** Workers at most: past four the copies and the start of each eat the gain */
const MOST_WORKERS = 4;

/** A geometry as its own buffers (a tile's are views into larger arrays), to transfer */
function own(g: DrapedGeometry): DrapedGeometry {
  const attributes: Record<string, { array: Float32Array; itemSize: number }> = {};
  for (const [k, a] of Object.entries(g.attributes)) attributes[k] = { array: a.array.slice(), itemSize: a.itemSize };
  return { position: g.position.slice(), attributes, index: g.index.slice() };
}

export class DrapedConformPool {
  private constructor(private readonly workers: Worker[]) {}

  /** A pool on `ground`, null where workers cannot run (Node, specs) or the machine has one or two cores */
  static on(ground: DrapeGround): DrapedConformPool | null {
    if (typeof Worker === 'undefined') return null;
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2;
    const size = Math.min(MOST_WORKERS, cores - 2);
    if (size < 2) return null;
    const workers: Worker[] = [];
    for (let k = 0; k < size; k++) {
      const w = new Worker(new URL('./draped-conform.worker', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'ground', grid: ground.grid, originX: ground.originX, originY: ground.originY } satisfies ConformRequest);
      workers.push(w);
    }
    return new DrapedConformPool(workers);
  }

  /** Each job laid onto the ground (conformDraped), in their order; spread over the workers by triangles */
  async conform(jobs: readonly ConformJob[]): Promise<(DrapedGeometry | null)[][]> {
    const n = this.workers.length;
    const batches: number[][] = Array.from({ length: n }, () => []);
    const load = new Float64Array(n);
    // Largest first onto the least loaded worker
    const order = jobs.map((j, k) => ({ k, size: j.geometries.reduce((s, g) => s + g.index.length, 0) })).sort((a, b) => b.size - a.size);
    for (const { k, size } of order) {
      let w = 0;
      for (let q = 1; q < n; q++) if (load[q] < load[w]) w = q;
      batches[w].push(k);
      load[w] += size;
    }
    const out: (DrapedGeometry | null)[][] = new Array(jobs.length);
    await Promise.all(
      batches.map((list, w) => {
        if (!list.length) return null;
        const sent = list.map((k) => ({ geometries: jobs[k].geometries.map(own), forced: jobs[k].forced }));
        return new Promise<void>((resolve, reject) => {
          const worker = this.workers[w];
          worker.onmessage = (e: MessageEvent<ConformReply>) => {
            e.data.results.forEach((r, q) => (out[list[q]] = r));
            resolve();
          };
          worker.onerror = (e) => reject(new Error(e.message));
          worker.postMessage({ type: 'jobs', id: w, jobs: sent } satisfies ConformRequest, conformedBuffers(sent.map((j) => j.geometries)));
        });
      }),
    );
    return out;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
  }
}
