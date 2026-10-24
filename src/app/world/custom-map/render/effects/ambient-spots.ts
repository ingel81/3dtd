/**
 * Where the life a map brings by itself shows (CustomMapView.refreshAmbient,
 * effects.setAmbient): fireflies over the shores of lakes and swamps and in
 * woods, bird flocks over the most open land, and the points glowing lava
 * lights its surroundings from (effects.setLavaLights).
 */
import { Vector3 } from 'three';
import type { MapBiome, MapObject, MapTerrain } from '../../map-document';
import type { HeightField } from '../height-field';
import { mapToScene } from '../map-coords';
import { circleFlock, type Flock } from './bird-flocks';

/** Biomes with fireflies at night, and with birds by day */
export const FIREFLY_BIOMES: ReadonlySet<MapBiome> = new Set(['temperate', 'swamp', 'mountain']);
export const BIRD_BIOMES: ReadonlySet<MapBiome> = new Set(['temperate', 'mountain', 'swamp', 'desert', 'arctic', 'city', 'apocalypse']);
/** Woods for fireflies and open land for birds are counted in squares of this size, metres; a wood has this many trees */
const WOOD_CELL = 30;
const WOOD_TREES = 6;
/** Shore samples for fireflies every this many metres, and at most this many swarms */
const SHORE_STEP = 12;
const MAX_FIREFLY_SPOTS = 60;

/** The trees of a WOOD_CELL square: the sum of their positions and their count */
export interface Wood {
  x: number;
  y: number;
  n: number;
}

/** The square of WOOD_CELL a map point is in, as a number */
export function woodBin(t: MapTerrain): (x: number, y: number) => number {
  return (x, y) => Math.floor((y + t.depth / 2) / WOOD_CELL) * 4096 + Math.floor((x + t.width / 2) / WOOD_CELL);
}

/** The trees among `objects` (assets in `trees`) by their square */
export function woodsOf(objects: readonly MapObject[], trees: ReadonlySet<string>, bin: (x: number, y: number) => number): Map<number, Wood> {
  const woods = new Map<number, Wood>();
  for (const o of objects) {
    if (!trees.has(o.asset)) continue;
    const k = bin(o.x, o.y);
    const w = woods.get(k) ?? { x: 0, y: 0, n: 0 };
    w.x += o.x;
    w.y += o.y;
    w.n++;
    woods.set(k, w);
  }
  return woods;
}

/** Points along the shores of lakes and swamps and in the middle of woods, at most MAX_FIREFLY_SPOTS, spread over the map */
export function fireflyPoints(t: MapTerrain, f: HeightField, woods: ReadonlyMap<number, Wood>): Vector3[] {
  const step = Math.max(1, Math.round(SHORE_STEP / f.cellSize));
  const out: Vector3[] = [];
  for (const body of [t.water, ...(t.waterBodies ?? [])]) {
    if (!body || (body.kind && body.kind !== 'water' && body.kind !== 'swamp')) continue;
    const wet = (i: number, j: number) => i >= 0 && j >= 0 && i < f.columns && j < f.rows && !!body.mask[j * f.columns + i] && f.sample(i, j) < body.level;
    for (let j = 0; j < f.rows; j += step) {
      for (let i = 0; i < f.columns; i += step) {
        if (!wet(i, j) || (wet(i + step, j) && wet(i - step, j) && wet(i, j + step) && wet(i, j - step))) continue;
        out.push(mapToScene(f.originX + i * f.cellSize, f.originY + j * f.cellSize, body.level + 0.3, new Vector3()));
      }
    }
  }
  for (const w of woods.values()) {
    if (w.n < WOOD_TREES) continue;
    const x = w.x / w.n;
    const y = w.y / w.n;
    out.push(mapToScene(x, y, f.heightAt(x, y) + 0.3, new Vector3()));
  }
  // Spread over the map: every k-th of them
  const k = Math.ceil(out.length / MAX_FIREFLY_SPOTS);
  return out.filter((_, n) => n % k === 0);
}

/** Centres of flocks over the land with the fewest trees, apart from each other, the map's edge and the water */
export function flockSpots(
  t: MapTerrain,
  f: HeightField,
  woods: ReadonlyMap<number, Wood>,
  bin: (x: number, y: number) => number,
  waterLevelAt: (x: number, y: number) => number | null,
): Flock[] {
  const wanted = Math.min(5, Math.max(1, Math.round((t.width * t.depth) / (300 * 300))));
  const candidates: { x: number; y: number; score: number }[] = [];
  for (let y = -t.depth / 2 + 80; y <= t.depth / 2 - 80; y += 60) {
    for (let x = -t.width / 2 + 80; x <= t.width / 2 - 80; x += 60) {
      if (waterLevelAt(x, y) !== null) continue;
      candidates.push({ x, y, score: woods.get(bin(x, y))?.n ?? 0 });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.x - b.x || a.y - b.y);
  const out: Flock[] = [];
  const centres: { x: number; y: number }[] = [];
  for (const c of candidates) {
    if (out.length >= wanted) break;
    if (centres.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < 180)) continue;
    const k = out.length;
    centres.push(c);
    out.push(
      circleFlock(
        mapToScene(c.x, c.y, f.heightAt(c.x, c.y) + 45 + 12 * k, new Vector3()),
        40 + 8 * (k % 3),
        9 + (k % 3) * 2,
        ((Math.abs(Math.sin(c.x * 12.9898 + c.y * 78.233)) * 43758.5453) % 1) || 0.37,
      ),
    );
  }
  return out;
}

/** Where glowing lava lights its surroundings: one point per 40 m patch of a lava body, every 30 m along lava flows */
export function lavaLightPoints(t: MapTerrain, f: HeightField): Vector3[] {
  const out: Vector3[] = [];
  const patch = 40;
  for (const body of [t.water, ...(t.waterBodies ?? [])]) {
    if (!body || body.kind !== 'lava') continue;
    const cells = new Map<number, { x: number; y: number; n: number }>();
    for (let j = 0; j < f.rows; j += 2) {
      for (let i = 0; i < f.columns; i += 2) {
        if (!body.mask[j * f.columns + i] || f.sample(i, j) > body.level) continue;
        const x = f.originX + i * f.cellSize;
        const y = f.originY + j * f.cellSize;
        const key = Math.floor(x / patch) * 4096 + Math.floor(y / patch);
        const c = cells.get(key) ?? { x: 0, y: 0, n: 0 };
        c.x += x;
        c.y += y;
        c.n++;
        cells.set(key, c);
      }
    }
    for (const c of cells.values()) out.push(mapToScene(c.x / c.n, c.y / c.n, body.level + 5, new Vector3()));
  }
  for (const r of t.rivers ?? []) {
    if (r.kind !== 'lava') continue;
    let walked = 30;
    for (let k = 0; k < r.points.length - 1; k++) {
      const a = r.points[k];
      const b = r.points[k + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (; walked < len; walked += 30) {
        const u = walked / len;
        out.push(mapToScene(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.height + (b.height - a.height) * u + 5, new Vector3()));
      }
      walked -= len;
    }
  }
  return out.slice(0, 256);
}
