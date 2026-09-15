import type { Intersection, Object3D, Raycaster } from 'three';

/**
 * Where the time for raycasts against the 3D tiles goes, by caller.
 *
 * Groundwork for the BVH decision: three-mesh-bvh is not in the project, so
 * a ray into the tiles runs three's Mesh.raycast on every active tile it
 * reaches and tests their triangles one by one. instrumentRaycasts() times
 * every raycast into the tiles group, callers name themselves with
 * enter()/exit(). Rays without a caller (the camera controls, for one) are
 * booked as `unscoped`. Read in the console with `__raycastStats()`.
 *
 * Cost while nobody reads it: two performance.now() and a Map lookup per ray.
 */

/** Rays closer together than this form one burst: a sweep, a disc build. */
const BURST_GAP_MS = 4;

const UNSCOPED = 'unscoped';

interface Bucket {
  calls: number;
  hits: number;
  totalMs: number;
  maxMs: number;
  burstMs: number;
  maxBurstMs: number;
  lastEnd: number;
}

/** One caller's numbers since the last reset. */
export interface RaycastStatsRow {
  caller: string;
  calls: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  /** Longest run of back-to-back rays (gaps under 4 ms): what one burst blocks in one go. */
  maxBurstMs: number;
  /** Intersections per ray; every tile surface and LOD layer the ray passes counts. */
  hitsPerCall: number;
}

export class RaycastStats {
  private scope: string | null = null;
  private readonly buckets = new Map<string, Bucket>();
  private since = performance.now();

  /**
   * Book the rays until exit() on `caller`. The outermost caller wins, so a
   * street build that goes through getTerrainHeightAtGeo stays a street
   * build. Returns the token to hand to exit().
   */
  enter(caller: string): string | null {
    const token = this.scope;
    if (token === null) this.scope = caller;
    return token;
  }

  exit(token: string | null): void {
    this.scope = token;
  }

  /** One ray from `start` to `end` (performance.now()) that found `hits` intersections. */
  record(start: number, end: number, hits: number): void {
    const caller = this.scope ?? UNSCOPED;
    let bucket = this.buckets.get(caller);
    if (!bucket) {
      bucket = { calls: 0, hits: 0, totalMs: 0, maxMs: 0, burstMs: 0, maxBurstMs: 0, lastEnd: -Infinity };
      this.buckets.set(caller, bucket);
    }
    const ms = end - start;
    bucket.calls++;
    bucket.hits += hits;
    bucket.totalMs += ms;
    if (ms > bucket.maxMs) bucket.maxMs = ms;
    if (start - bucket.lastEnd > BURST_GAP_MS) bucket.burstMs = 0;
    bucket.burstMs += ms;
    if (bucket.burstMs > bucket.maxBurstMs) bucket.maxBurstMs = bucket.burstMs;
    bucket.lastEnd = end;
  }

  /** Per caller, most total time first, rounded for reading. */
  rows(): RaycastStatsRow[] {
    const rows: RaycastStatsRow[] = [];
    for (const [caller, b] of this.buckets) {
      rows.push({
        caller,
        calls: b.calls,
        totalMs: round(b.totalMs, 1),
        avgMs: round(b.totalMs / b.calls, 3),
        maxMs: round(b.maxMs, 2),
        maxBurstMs: round(b.maxBurstMs, 1),
        hitsPerCall: round(b.hits / b.calls, 1),
      });
    }
    return rows.sort((a, b) => b.totalMs - a.totalMs);
  }

  /** One caller's raw sums since the last reset, zeros without rays; for a difference before and after a pass. */
  totals(caller: string): { calls: number; hits: number; totalMs: number } {
    const b = this.buckets.get(caller);
    return b ? { calls: b.calls, hits: b.hits, totalMs: b.totalMs } : { calls: 0, hits: 0, totalMs: 0 };
  }

  /** Seconds since the last reset (or page load). */
  get seconds(): number {
    return (performance.now() - this.since) / 1000;
  }

  reset(): void {
    this.buckets.clear();
    this.since = performance.now();
  }
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** The instance the engine and the console hook share. */
export const raycastStats = new RaycastStats();

/**
 * Time every raycast that reaches `object`, meant for the tiles group.
 * TilesGroup.raycast runs the tile raycasts itself and returns false, which
 * stops three from walking the tile scenes a second time, so the wrapper
 * hands that result on.
 */
export function instrumentRaycasts(object: Object3D, stats: RaycastStats = raycastStats): void {
  const raycast = object.raycast.bind(object) as (raycaster: Raycaster, intersects: Intersection[]) => unknown;
  object.raycast = (raycaster: Raycaster, intersects: Intersection[]) => {
    const start = performance.now();
    const before = intersects.length;
    const result = raycast(raycaster, intersects);
    stats.record(start, performance.now(), intersects.length - before);
    return result;
  };
}

declare global {
  interface Window {
    /** Raycast time against the tiles per caller, as a table; `true` resets afterwards. */
    __raycastStats: (reset?: boolean) => RaycastStatsRow[];
  }
}
if (typeof window !== 'undefined') {
  window.__raycastStats = (reset = false) => {
    const rows = raycastStats.rows();
    console.log(`[RaycastStats] ${raycastStats.seconds.toFixed(0)} s since the last reset`);
    console.table(rows);
    if (reset) raycastStats.reset();
    return rows;
  };
}
