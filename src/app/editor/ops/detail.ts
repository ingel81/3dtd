/**
 * "Increase detail": a map made with coarser ground (4 m per height point,
 * about one splat texel per point, as new maps were before) refined to the
 * detail new maps and the shipped levels have: at most DEFAULT_CELL_SIZE
 * metres per height point and the splat resolution that goes with it. The
 * extent stays exact (the cell is the old one divided by a whole number),
 * every old height point keeps its height, the points between come
 * bilinear from their neighbours; splat weights and water masks are
 * resampled the same way. Objects, roads and markers stand in metres and
 * need nothing; the ground roads keep for taking them back (dress.ground)
 * is refined with the heights (increaseMapDetail).
 */
import type { CustomMapDocument, MapTerrain, MapWater } from '../../world/custom-map/map-document';
import { refineGround } from './landscape/road-ground';
import { DEFAULT_CELL_SIZE, splatResolutionFor } from '../../world/custom-map/map-create';
import { heightAt } from '../model/grid';

export interface DetailTarget {
  cellSize: number;
  columns: number;
  rows: number;
  splatResolution: number;
}

/** What the terrain becomes, or null when it has the detail of new maps already */
export function detailTarget(t: MapTerrain, maxCell = DEFAULT_CELL_SIZE): DetailTarget | null {
  const g = t.grid;
  const k = Math.max(1, Math.ceil(g.cellSize / maxCell - 1e-9));
  const columns = (g.columns - 1) * k + 1;
  const rows = (g.rows - 1) * k + 1;
  const splatResolution = Math.max(t.splat.resolution, splatResolutionFor(Math.max(columns, rows)));
  if (k === 1 && splatResolution === t.splat.resolution) return null;
  return { cellSize: g.cellSize / k, columns, rows, splatResolution };
}

/** The map's terrain refined, and the ground its roads keep with it (dropped where it cannot follow) */
export function increaseMapDetail(doc: CustomMapDocument, target: DetailTarget): void {
  const from = doc.terrain.grid;
  doc.terrain = increaseDetail(doc.terrain, target);
  for (const e of doc.paths.edges) {
    if (!e.dress?.ground) continue;
    const ground = refineGround(e.dress.ground, from, doc.terrain.grid);
    const { ground: _old, ...rest } = e.dress;
    e.dress = ground ? { ...rest, ground } : rest;
  }
}

/** The refined terrain (a new object; the old one is left as it was) */
export function increaseDetail(t: MapTerrain, target: DetailTarget): MapTerrain {
  const { columns, rows, cellSize } = target;
  const heights = new Float32Array(columns * rows);
  for (let j = 0; j < rows; j++) {
    const y = -t.depth / 2 + j * cellSize;
    for (let i = 0; i < columns; i++) heights[j * columns + i] = heightAt(t, -t.width / 2 + i * cellSize, y);
  }
  const refineMask = (w: MapWater): MapWater => ({ ...w, mask: resampleGrid(w.mask, t.grid.columns, t.grid.rows, columns, rows) });
  const res = target.splatResolution;
  const maps = t.splat.maps.map((m) => (res === t.splat.resolution ? m.slice() : resampleTexels(m, t.splat.resolution, res)));
  return {
    ...t,
    grid: { columns, rows, cellSize, heights },
    splat: { resolution: res, maps },
    water: t.water ? refineMask(t.water) : null,
    ...(t.waterBodies ? { waterBodies: t.waterBodies.map(refineMask) } : {}),
  };
}

/** One byte per sample, bilinear from a grid over the same extent */
function resampleGrid(src: Uint8Array, sc: number, sr: number, columns: number, rows: number): Uint8Array {
  const out = new Uint8Array(columns * rows);
  const fx = (sc - 1) / (columns - 1);
  const fy = (sr - 1) / (rows - 1);
  for (let j = 0; j < rows; j++) {
    const y = j * fy;
    const j0 = Math.min(Math.floor(y), sr - 2);
    const v = y - j0;
    for (let i = 0; i < columns; i++) {
      const x = i * fx;
      const i0 = Math.min(Math.floor(x), sc - 2);
      const u = x - i0;
      const a = src[j0 * sc + i0];
      const b = src[j0 * sc + i0 + 1];
      const c = src[(j0 + 1) * sc + i0];
      const d = src[(j0 + 1) * sc + i0 + 1];
      out[j * columns + i] = Math.round((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v);
    }
  }
  return out;
}

/** RGBA splat texels, bilinear between texel centres, edges clamped */
function resampleTexels(src: Uint8Array, from: number, to: number): Uint8Array {
  const out = new Uint8Array(to * to * 4);
  const scale = from / to;
  for (let v = 0; v < to; v++) {
    const fy = Math.min(from - 1, Math.max(0, (v + 0.5) * scale - 0.5));
    const v0 = Math.min(Math.floor(fy), from - 2 < 0 ? 0 : from - 2);
    const v1 = Math.min(v0 + 1, from - 1);
    const ty = fy - v0;
    for (let u = 0; u < to; u++) {
      const fx = Math.min(from - 1, Math.max(0, (u + 0.5) * scale - 0.5));
      const u0 = Math.min(Math.floor(fx), from - 2 < 0 ? 0 : from - 2);
      const u1 = Math.min(u0 + 1, from - 1);
      const tx = fx - u0;
      for (let c = 0; c < 4; c++) {
        const a = src[(v0 * from + u0) * 4 + c];
        const b = src[(v0 * from + u1) * 4 + c];
        const d = src[(v1 * from + u0) * 4 + c];
        const e = src[(v1 * from + u1) * 4 + c];
        out[(v * to + u) * 4 + c] = Math.round((a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty);
      }
    }
  }
  return out;
}
