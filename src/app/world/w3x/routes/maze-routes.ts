/**
 * (d) Ways over open ground, for maps without fixed lanes: maze TDs, where
 * players wall the creeps in with their towers, and circuit TDs, where the
 * script sends creeps round in circles and no way ends anywhere.
 *
 * The shortest way from every spawn to the end over walkable land, on a
 * half-tile raster: unbuildable pixels (the map's lanes, where it has some)
 * cost an eighth of buildable ones, and pixels close to walls cost more, so ways
 * run down the middle of corridors. Ways merge into shared nodes like the
 * terrain strategy's (addWays).
 */

import type { LaneMask } from './lane-mask';
import { END_WORDS, type RawRoutes, SPAWN_WORDS, emptyRaw } from './route-graph';
import { type TerrainRoutes, addWays, shortestTree, snap } from './terrain-routes';
import type { W3Region } from '../formats/w3r';

export interface MazePoint {
  id: string;
  name: string;
  /** World units */
  x: number;
  y: number;
}

export interface MazeInput {
  mask: LaneMask & { lane: Uint8Array };
  regions: W3Region[];
  /** Spawns the script names (where it creates units, where its ways start); else spawn regions */
  spawns: MazePoint[];
  /** Ends the script names (where leaking costs lives); else end regions, else the area's centre */
  ends: MazePoint[];
  /** The imported area's centre, the end of last resort */
  center: { x: number; y: number };
}

/**
 * A buildable pixel costs this many unbuildable ones: where a map has lanes,
 * ways keep to them even round long bends; on open ground (a maze) every
 * pixel costs the same and the way is the straight shortest one
 */
const BUILDABLE_COST = 8;

const DIRECTION_WORDS = /left|right|down|\bup\b|walk|wlk|\bto\b/i;

const regionPoint = (r: W3Region): MazePoint => ({
  id: r.variable,
  name: r.name,
  x: (r.left + r.right) / 2,
  y: (r.bottom + r.top) / 2,
});

/** Pixels to the nearest non-walkable pixel (chamfer 1 / 1.4), capped */
function wallDistance(mask: Uint8Array, w: number, h: number, cap: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? cap : 0;
  const relax = (i: number, j: number, step: number): void => {
    if (d[j] + step < d[i]) d[i] = d[j] + step;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      if (x > 0) relax(i, i - 1, 1);
      if (y > 0) relax(i, i - w, 1);
      if (x > 0 && y > 0) relax(i, i - w - 1, Math.SQRT2);
      if (x < w - 1 && y > 0) relax(i, i - w + 1, Math.SQRT2);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      if (x < w - 1) relax(i, i + 1, 1);
      if (y < h - 1) relax(i, i + w, 1);
      if (x < w - 1 && y < h - 1) relax(i, i + w + 1, Math.SQRT2);
      if (x > 0 && y < h - 1) relax(i, i + w - 1, Math.SQRT2);
    }
  }
  return d;
}

export function routesFromMaze(input: MazeInput): TerrainRoutes | null {
  const m = input.mask;
  const w = m.width;
  const h = m.height;
  const warnings: string[] = [];
  const raw: RawRoutes = emptyRaw();
  const snapPx = Math.ceil(1536 / m.cell);
  const pixelOf = (p: { x: number; y: number }): number => snap(m.data, m, p.x, p.y, snapPx);

  const walls = wallDistance(m.data, w, h, 8);
  const cost = new Float32Array(w * h);
  for (let i = 0; i < cost.length; i++) cost[i] = (m.lane[i] ? 1 : BUILDABLE_COST) * (1 + 2 / Math.max(1, walls[i]));

  const endCandidates: MazePoint[] = [
    ...input.ends,
    ...input.regions.filter((r) => END_WORDS.test(r.name)).map(regionPoint),
    { id: 'maze_end', name: 'End', ...input.center },
  ];
  let end: MazePoint | null = null;
  let endPx = -1;
  for (const c of endCandidates) {
    endPx = pixelOf(c);
    if (endPx >= 0) {
      end = c;
      break;
    }
  }
  if (!end) return null;
  if (end.id === 'maze_end') warnings.push('routes: the map names no end; the HQ stands in the middle of the map');
  const tree = shortestTree(m.data, w, h, endPx, cost);

  const spawnPoints = input.spawns.length
    ? input.spawns
    : input.regions.filter((r) => SPAWN_WORDS.test(r.name) && !DIRECTION_WORDS.test(r.name)).map(regionPoint);
  const starts: { px: number; id: string }[] = [];
  const seen = new Set<number>([endPx]);
  for (const s of spawnPoints) {
    const px = pixelOf(s);
    if (px < 0 || seen.has(px) || !Number.isFinite(tree.dist[px])) continue;
    seen.add(px);
    raw.nodes.set(s.id, { id: s.id, name: s.name, x: s.x, y: s.y, region: input.regions.find((r) => r.variable === s.id) });
    raw.spawnHints.add(s.id);
    starts.push({ px, id: s.id });
  }
  if (starts.length === 0) return null;
  const lost = spawnPoints.length - starts.length;
  if (lost > 0) warnings.push(`routes: ${lost} spawn(s) have no walkable way to the end`);

  raw.nodes.set(end.id, { id: end.id, name: end.name, x: end.x, y: end.y, region: input.regions.find((r) => r.variable === end!.id) });
  raw.endHints.add(end.id);
  addWays(raw, m, starts, endPx, tree, new Map([[endPx, end.id]]));
  return { raw, warnings };
}
