/**
 * Map space to the terrain's sample grids and back. Heights and the water
 * mask share the height grid (sample (i, j) at x = -width/2 + i * cellSize);
 * the splat maps cover the same extent with `resolution` texels a side,
 * texel (u, v) centred at ((u + 0.5) / resolution) of the width, row v
 * northwards like j.
 */
import type { MapPoint, MapTerrain } from '../world/custom-map/map-document';
import { gridHeightAt } from '../world/custom-map/render/height-field';

/** Inclusive rectangle of samples or texels */
export interface GridRect {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

export function rectUnion(a: GridRect | null, b: GridRect | null): GridRect | null {
  if (!a) return b;
  if (!b) return a;
  return { i0: Math.min(a.i0, b.i0), j0: Math.min(a.j0, b.j0), i1: Math.max(a.i1, b.i1), j1: Math.max(a.j1, b.j1) };
}

export function rectEmpty(r: GridRect): boolean {
  return r.i1 < r.i0 || r.j1 < r.j0;
}

/** Samples of the height grid a circle touches, clamped to the grid */
export function sampleRectAround(t: MapTerrain, x: number, y: number, radius: number): GridRect {
  const g = t.grid;
  const fi = (x + t.width / 2) / g.cellSize;
  const fj = (y + t.depth / 2) / g.cellSize;
  const r = radius / g.cellSize;
  return {
    i0: Math.max(0, Math.floor(fi - r)),
    j0: Math.max(0, Math.floor(fj - r)),
    i1: Math.min(g.columns - 1, Math.ceil(fi + r)),
    j1: Math.min(g.rows - 1, Math.ceil(fj + r)),
  };
}

/** Splat texels a circle touches, clamped */
export function texelRectAround(t: MapTerrain, x: number, y: number, radius: number): GridRect {
  const res = t.splat.resolution;
  const fu = ((x + t.width / 2) / t.width) * res - 0.5;
  const fv = ((y + t.depth / 2) / t.depth) * res - 0.5;
  const ru = (radius / t.width) * res;
  const rv = (radius / t.depth) * res;
  return {
    i0: Math.max(0, Math.floor(fu - ru)),
    j0: Math.max(0, Math.floor(fv - rv)),
    i1: Math.min(res - 1, Math.ceil(fu + ru)),
    j1: Math.min(res - 1, Math.ceil(fv + rv)),
  };
}

export function sampleX(t: MapTerrain, i: number): number {
  return -t.width / 2 + i * t.grid.cellSize;
}

export function sampleY(t: MapTerrain, j: number): number {
  return -t.depth / 2 + j * t.grid.cellSize;
}

export function texelX(t: MapTerrain, u: number): number {
  return -t.width / 2 + ((u + 0.5) / t.splat.resolution) * t.width;
}

export function texelY(t: MapTerrain, v: number): number {
  return -t.depth / 2 + ((v + 0.5) / t.splat.resolution) * t.depth;
}

/** Nearest sample index to a map point, clamped */
export function nearestSample(t: MapTerrain, x: number, y: number): { i: number; j: number } {
  const g = t.grid;
  return {
    i: clampInt(Math.round((x + t.width / 2) / g.cellSize), 0, g.columns - 1),
    j: clampInt(Math.round((y + t.depth / 2) / g.cellSize), 0, g.rows - 1),
  };
}

/**
 * Terrain height at a map point, clamped to the edge: on the two triangles
 * per cell the game draws and walks (render/height-field.ts gridHeightAt),
 * so a check, a placement or an OSM building sees the surface the player
 * sees
 */
export function heightAt(t: MapTerrain, x: number, y: number): number {
  return gridHeightAt(t.grid, -t.width / 2, -t.depth / 2, x, y);
}

/** Slope at a map point in degrees, from central differences */
export function slopeAt(t: MapTerrain, x: number, y: number): number {
  const s = t.grid.cellSize;
  const dx = (heightAt(t, x + s, y) - heightAt(t, x - s, y)) / (2 * s);
  const dy = (heightAt(t, x, y + s) - heightAt(t, x, y - s)) / (2 * s);
  return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
}

export function insideMap(t: MapTerrain, p: MapPoint, margin = 0): boolean {
  return Math.abs(p.x) <= t.width / 2 - margin && Math.abs(p.y) <= t.depth / 2 - margin;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
