/** Messages of the conform workers (draped-conform-pool.ts, draped-conform.worker.ts) */
import type { MapHeightGrid } from '../../map-document';
import type { DrapedGeometry } from './draped-refine';

/** One item's geometries to lay onto the ground together, with the points forced on its shared edges */
export interface ConformJob {
  geometries: DrapedGeometry[];
  forced: readonly number[];
}

export type ConformRequest =
  | { type: 'ground'; grid: MapHeightGrid; originX: number; originY: number }
  | { type: 'jobs'; id: number; jobs: ConformJob[] };

export interface ConformReply {
  id: number;
  results: (DrapedGeometry | null)[][];
}

/** The buffers of geometries, to transfer (each once) */
export function conformedBuffers(results: readonly (readonly (DrapedGeometry | null)[])[]): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  for (const list of results) {
    for (const g of list) {
      if (!g) continue;
      out.add(g.position.buffer as ArrayBuffer).add(g.index.buffer as ArrayBuffer);
      for (const a of Object.values(g.attributes)) out.add(a.array.buffer as ArrayBuffer);
    }
  }
  return [...out];
}
