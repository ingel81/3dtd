/**
 * (c) Routes from the terrain alone, for maps whose script gives none: the
 * lane mask is thinned to a one-pixel skeleton (Zhang-Suen), the end and the
 * spawns are anchored on it (regions named like ends and spawns, or the
 * region whose enter trigger costs lives; without spawn regions the far
 * skeleton tips), and the shortest skeleton ways from every spawn to the end
 * become the route graph. Ways share pixels where they merge, so merged
 * lanes share nodes. Each way is simplified to its corners.
 */

import type { W3Region } from '../formats/w3r';
import type { LaneMask } from './lane-mask';
import { END_WORDS, type RawRoutes, SPAWN_WORDS, emptyRaw, regionNode } from './route-graph';

/** Thins a binary raster in place to a one-pixel wide skeleton */
export function thin(data: Uint8Array, w: number, h: number): void {
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x]);
  const remove: number[] = [];
  for (let changed = true; changed; ) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      remove.length = 0;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!data[y * w + x]) continue;
          // Neighbours p2..p9 clockwise from north
          const p = [
            at(x, y + 1),
            at(x + 1, y + 1),
            at(x + 1, y),
            at(x + 1, y - 1),
            at(x, y - 1),
            at(x - 1, y - 1),
            at(x - 1, y),
            at(x - 1, y + 1),
          ];
          const b = p.reduce((s, v) => s + v, 0);
          if (b < 2 || b > 6) continue;
          let a = 0;
          for (let i = 0; i < 8; i++) if (p[i] === 0 && p[(i + 1) % 8] === 1) a++;
          if (a !== 1) continue;
          if (pass === 0 ? p[0] * p[2] * p[4] !== 0 || p[2] * p[4] * p[6] !== 0 : p[0] * p[2] * p[6] !== 0 || p[0] * p[4] * p[6] !== 0) {
            continue;
          }
          remove.push(y * w + x);
        }
      }
      for (const i of remove) data[i] = 0;
      if (remove.length) changed = true;
    }
  }
}

const NEIGHBOURS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/** Distances and next-pixel pointers towards `target` over the skeleton */
function shortestTree(sk: Uint8Array, w: number, h: number, target: number): { dist: Float64Array; next: Int32Array } {
  const dist = new Float64Array(w * h).fill(Infinity);
  const next = new Int32Array(w * h).fill(-1);
  dist[target] = 0;
  // Binary heap over (dist, pixel)
  const heap: number[] = [target];
  const push = (i: number): void => {
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (dist[heap[p]] <= dist[heap[c]]) break;
      [heap[p], heap[c]] = [heap[c], heap[p]];
      c = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < heap.length && dist[heap[l]] < dist[heap[m]]) m = l;
        if (r < heap.length && dist[heap[r]] < dist[heap[m]]) m = r;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]];
        c = m;
      }
    }
    return top;
  };
  const done = new Uint8Array(w * h);
  while (heap.length) {
    const i = pop();
    if (done[i]) continue;
    done[i] = 1;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy, cost] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (!sk[j] || done[j]) continue;
      const d = dist[i] + cost;
      if (d < dist[j]) {
        dist[j] = d;
        next[j] = i;
        push(j);
      }
    }
  }
  return { dist, next };
}

/** The skeleton pixel nearest to a world point, within `maxPx` pixels */
function snap(sk: Uint8Array, m: LaneMask, x: number, y: number, maxPx: number): number {
  const cx = Math.floor((x - m.originX) / m.cell);
  const cy = Math.floor((y - m.originY) / m.cell);
  let best = -1;
  let bestD = Infinity;
  for (let dy = -maxPx; dy <= maxPx; dy++) {
    for (let dx = -maxPx; dx <= maxPx; dx++) {
      const px = cx + dx;
      const py = cy + dy;
      if (px < 0 || py < 0 || px >= m.width || py >= m.height || !sk[py * m.width + px]) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = py * m.width + px;
      }
    }
  }
  return best;
}

/** Douglas-Peucker on pixel indices: keeps the corners of a way */
function simplify(path: number[], w: number, tolerance: number): number[] {
  if (path.length < 3) return path;
  const xy = (i: number): [number, number] => [i % w, Math.floor(i / w)];
  const keep = new Uint8Array(path.length);
  keep[0] = keep[path.length - 1] = 1;
  const stack: [number, number][] = [[0, path.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = xy(path[s]);
    const [bx, by] = xy(path[e]);
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1;
    let worstD = tolerance;
    for (let k = s + 1; k < e; k++) {
      const [px, py] = xy(path[k]);
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len;
      if (d > worstD) {
        worst = k;
        worstD = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([s, worst], [worst, e]);
    }
  }
  return path.filter((_, k) => keep[k]);
}

export interface TerrainRouteInput {
  mask: LaneMask;
  regions: W3Region[];
  /** Region variables the script marks as the end (leak triggers) */
  endHints?: Set<string>;
  /** At most this many spawns when they come from skeleton tips */
  maxTipSpawns?: number;
}

export interface TerrainRoutes {
  raw: RawRoutes;
  warnings: string[];
}

const DIRECTION_WORDS = /left|right|down|\bup\b|walk|wlk|\bto\b/i;

export function routesFromTerrain(input: TerrainRouteInput): TerrainRoutes | null {
  const { mask: m, regions } = input;
  const w = m.width;
  const h = m.height;
  const sk = m.data.slice();
  thin(sk, w, h);
  const warnings: string[] = [];
  const raw = emptyRaw();
  const snapPx = Math.ceil(1024 / m.cell);

  const endRegion =
    regions.find((r) => input.endHints?.has(r.variable)) ?? regions.find((r) => END_WORDS.test(r.name) && snapRegion(r) >= 0);
  function snapRegion(r: W3Region): number {
    return snap(sk, m, (r.left + r.right) / 2, (r.bottom + r.top) / 2, snapPx);
  }
  if (!endRegion) return null;
  const endPx = snapRegion(endRegion);
  if (endPx < 0) return null;
  const tree = shortestTree(sk, w, h, endPx);

  const endId = regionNode(raw, endRegion);
  raw.endHints.add(endId);
  const pixelNode = new Map<number, string>([[endPx, endId]]);
  const starts: { px: number; id: string }[] = [];
  for (const r of regions) {
    if (r === endRegion || !SPAWN_WORDS.test(r.name) || DIRECTION_WORDS.test(r.name)) continue;
    const px = snapRegion(r);
    if (px < 0 || !Number.isFinite(tree.dist[px])) continue;
    const id = regionNode(raw, r);
    raw.spawnHints.add(id);
    starts.push({ px, id });
  }
  if (starts.length === 0) {
    // No spawn regions: the skeleton tips farthest from the end
    const tips: number[] = [];
    for (let i = 0; i < sk.length; i++) {
      if (!sk[i] || !Number.isFinite(tree.dist[i]) || i === endPx) continue;
      const x = i % w;
      const y = (i - x) / w;
      let n = 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && sk[ny * w + nx]) n++;
      }
      if (n === 1) tips.push(i);
    }
    const far = Math.max(...tips.map((i) => tree.dist[i]), 0) * 0.35;
    const chosen = tips
      .filter((i) => tree.dist[i] >= far)
      .sort((a, b) => tree.dist[b] - tree.dist[a])
      .slice(0, input.maxTipSpawns ?? 12);
    chosen.forEach((px, k) => {
      const id = `tip_${px}`;
      raw.nodes.set(id, { id, name: `Spawn ${k + 1}`, ...pixelCentre(m, px) });
      raw.spawnHints.add(id);
      starts.push({ px, id });
    });
    if (chosen.length) warnings.push(`routes: no spawn regions, ${chosen.length} spawns placed at lane ends`);
  }
  if (starts.length === 0) return null;

  // Walk every start to the end; pixels where ways meet become shared nodes
  const ways: number[][] = [];
  const visits = new Map<number, number>();
  for (const s of starts) {
    const way: number[] = [];
    for (let p = s.px; p >= 0; p = tree.next[p]) {
      way.push(p);
      if (p === endPx) break;
    }
    ways.push(way);
    for (const p of way) visits.set(p, (visits.get(p) ?? 0) + 1);
  }
  const nodeOf = (px: number): string => {
    let id = pixelNode.get(px);
    if (!id) {
      id = `px_${px}`;
      raw.nodes.set(id, { id, name: `Waypoint ${raw.nodes.size}`, ...pixelCentre(m, px) });
      pixelNode.set(px, id);
    }
    return id;
  };
  starts.forEach((s, k) => {
    pixelNode.set(s.px, s.id);
    const way = ways[k];
    // Split at merge points (visit count changes), then keep each piece's corners
    const cuts = [0];
    for (let i = 1; i < way.length - 1; i++) if (visits.get(way[i]) !== visits.get(way[i - 1])) cuts.push(i);
    cuts.push(way.length - 1);
    for (let c = 0; c + 1 < cuts.length; c++) {
      const piece = simplify(way.slice(cuts[c], cuts[c + 1] + 1), w, 1.5);
      for (let i = 0; i + 1 < piece.length; i++) raw.edges.push({ from: nodeOf(piece[i]), to: nodeOf(piece[i + 1]) });
    }
  });
  return { raw, warnings };
}

function pixelCentre(m: LaneMask, px: number): { x: number; y: number } {
  const x = px % m.width;
  const y = (px - x) / m.width;
  return { x: m.originX + (x + 0.5) * m.cell, y: m.originY + (y + 0.5) * m.cell };
}
