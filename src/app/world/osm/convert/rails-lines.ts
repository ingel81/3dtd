/**
 * Along a railway chain (rails.ts and its phases): the segment, point,
 * direction and height of the bed at a distance, the spans a crossing
 * takes, spans merged and cut, and a lookup of the track lines.
 */
import type { RailChain, RailCrossing } from './rails-types';
import type { MapPoint, MapTerrain } from '../../custom-map/map-document';
import { unit } from './geom';
import { heightAt } from '../../../map-ops/grid';
import { BED_HALF, LATTICE, MIN_SIN, PROFILE_STEP } from './rails-config';
import { pointSegmentDistance } from '../../../map-ops/path-graph';

export const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Half the length of track over which a band `reach` metres either side of
 * a road's middle (direction `roadDir`) and the bed's width overlap: the
 * band's own reach along the track, and the bed's corners at a slant
 */
export function spanHalf(c: RailChain, along: number, roadDir: MapPoint, reach: number): number {
  const t = directionAt(c, along);
  const sin = Math.max(MIN_SIN, Math.abs(t.x * roadDir.y - t.y * roadDir.x));
  const cos = Math.abs(t.x * roadDir.x + t.y * roadDir.y);
  return reach / sin + (BED_HALF * cos) / sin;
}

/** Half the length of a line's middle inside a crossing's road */
export function roadReach(c: RailChain, x: RailCrossing): number {
  const t = directionAt(c, x.along);
  const sin = Math.max(MIN_SIN, Math.abs(t.x * x.roadDir.y - t.y * x.roadDir.x));
  return x.roadWidth / 2 / sin;
}

/** The segment of `c` that `along` falls on */
export function segmentAt(c: RailChain, along: number): number {
  let lo = 0;
  let hi = c.at.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.at[mid] <= along) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** The point `along` metres down the line (clamped to it) */
export function pointOn(c: RailChain, along: number): MapPoint {
  const k = segmentAt(c, along);
  const a = c.line[k];
  const b = c.line[k + 1];
  const len = c.at[k + 1] - c.at[k];
  const t = len > 0 ? Math.max(0, Math.min(1, (along - c.at[k]) / len)) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Unit direction of the line at `along` */
export function directionAt(c: RailChain, along: number): MapPoint {
  const k = segmentAt(c, along);
  return unit({ x: c.line[k + 1].x - c.line[k].x, y: c.line[k + 1].y - c.line[k].y });
}

/** Height of the line's profile at `along` (the ground there when it has none) */
export function profileAt(c: RailChain, along: number, terrain: MapTerrain): number {
  if (!c.profile) {
    const p = pointOn(c, along);
    return heightAt(terrain, p.x, p.y);
  }
  const f = Math.max(0, Math.min(c.profile.length - 1, along / PROFILE_STEP));
  const k = Math.min(c.profile.length - 2, Math.floor(f));
  if (k < 0) return c.profile[0];
  const s = f - k;
  return c.profile[k] * (1 - s) + c.profile[k + 1] * s;
}

/** The stretch of line a crossing's panels cover: their half length either side, snapped outward to the lattice */
export function crossingSpan(x: RailCrossing): [number, number] {
  return [Math.floor((x.along - x.half) / LATTICE) * LATTICE, Math.ceil((x.along + x.half) / LATTICE) * LATTICE];
}

/** Spans [from, to] with the overlapping ones joined, in order */
export function merged(spans: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [from, to] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else if (to > from) out.push([from, to]);
  }
  return out;
}

/** The parts of span `s` outside all of `cuts` (in order, not overlapping) */
export function outside(s: [number, number], cuts: readonly [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let from = s[0];
  for (const [a, b] of cuts) {
    if (b <= from || a >= s[1]) continue;
    if (a > from) out.push([from, a]);
    from = Math.max(from, b);
  }
  if (from < s[1]) out.push([from, s[1]]);
  return out;
}

/** The lines' segments in a grid of 16 m cells, for the nearest track to a point */
export class LineIndex {
  private readonly cells = new Map<number, { chain: RailChain; k: number; a: MapPoint; b: MapPoint }[]>();
  private static readonly CELL = 16;

  constructor(chains: readonly RailChain[]) {
    for (const chain of chains) {
      for (let k = 0; k + 1 < chain.line.length; k++) {
        const a = chain.line[k];
        const b = chain.line[k + 1];
        const c = LineIndex.CELL;
        for (let j = Math.floor(Math.min(a.y, b.y) / c); j <= Math.floor(Math.max(a.y, b.y) / c); j++) {
          for (let i = Math.floor(Math.min(a.x, b.x) / c); i <= Math.floor(Math.max(a.x, b.x) / c); i++) {
            const key = (i + 100_000) * 200_003 + (j + 100_000);
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push({ chain, k, a, b });
          }
        }
      }
    }
  }

  /** Whether a track's middle (of a line other than `except`) lies within `r` of `p` */
  near(p: MapPoint, r: number, except: RailChain | null = null): boolean {
    const c = LineIndex.CELL;
    for (let j = Math.floor((p.y - r) / c); j <= Math.floor((p.y + r) / c); j++) {
      for (let i = Math.floor((p.x - r) / c); i <= Math.floor((p.x + r) / c); i++) {
        for (const s of this.cells.get((i + 100_000) * 200_003 + (j + 100_000)) ?? []) {
          if (s.chain !== except && pointSegmentDistance(p, s.a, s.b) < r) return true;
        }
      }
    }
    return false;
  }

  /** Per line other than `except` whose middle comes within `r` of `p`: its nearest point, the metres along it and the distance */
  within(p: MapPoint, r: number, except: RailChain | null = null): { chain: RailChain; along: number; dist: number }[] {
    const c = LineIndex.CELL;
    const best = new Map<RailChain, { chain: RailChain; along: number; dist: number }>();
    for (let j = Math.floor((p.y - r) / c); j <= Math.floor((p.y + r) / c); j++) {
      for (let i = Math.floor((p.x - r) / c); i <= Math.floor((p.x + r) / c); i++) {
        for (const s of this.cells.get((i + 100_000) * 200_003 + (j + 100_000)) ?? []) {
          if (s.chain === except) continue;
          const d = pointSegmentDistance(p, s.a, s.b);
          if (d >= r || d >= (best.get(s.chain)?.dist ?? Infinity)) continue;
          const len = s.chain.at[s.k + 1] - s.chain.at[s.k];
          const t = len > 0 ? Math.max(0, Math.min(len, ((p.x - s.a.x) * (s.b.x - s.a.x) + (p.y - s.a.y) * (s.b.y - s.a.y)) / len)) : 0;
          best.set(s.chain, { chain: s.chain, along: s.chain.at[s.k] + t, dist: d });
        }
      }
    }
    return [...best.values()];
  }

  /** The nearest track's middle within `r` of `p` (of a line other than `except`): its line and the metres along it */
  nearest(p: MapPoint, r: number, except: RailChain | null = null): { chain: RailChain; along: number } | null {
    const c = LineIndex.CELL;
    let best: { chain: RailChain; along: number } | null = null;
    let bestD = r;
    for (let j = Math.floor((p.y - r) / c); j <= Math.floor((p.y + r) / c); j++) {
      for (let i = Math.floor((p.x - r) / c); i <= Math.floor((p.x + r) / c); i++) {
        for (const s of this.cells.get((i + 100_000) * 200_003 + (j + 100_000)) ?? []) {
          if (s.chain === except) continue;
          const d = pointSegmentDistance(p, s.a, s.b);
          if (d >= bestD) continue;
          const len = s.chain.at[s.k + 1] - s.chain.at[s.k];
          const t = len > 0 ? Math.max(0, Math.min(len, ((p.x - s.a.x) * (s.b.x - s.a.x) + (p.y - s.a.y) * (s.b.y - s.a.y)) / len)) : 0;
          bestD = d;
          best = { chain: s.chain, along: s.chain.at[s.k] + t };
        }
      }
    }
    return best;
  }
}
