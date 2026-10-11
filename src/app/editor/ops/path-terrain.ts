/**
 * "Flatten road": the ground under a path takes a smooth profile along it
 * (the terrain's height along the centre line, averaged over a stretch) and
 * levels across its width, fading into the ground at the shoulders. The
 * paint variant lays a ground layer under the path.
 */
import type { MapPathEdge, MapPaths, MapPoint, MapTerrain } from '../../world/custom-map/map-document';
import { clamp, heightAt, rectUnion, sampleX, sampleY, texelX, texelY, type GridRect } from '../model/grid';
import { brushWeight } from './brush';
import { MAX_LAYERS, readWeights, writeWeights } from './paint-ops';
import { edgePolyline, nearestOnPolyline, pointAt, polylineLength } from './path-graph';

export interface FlattenOptions {
  /** Metres of shoulder beyond the half width that fade into the ground */
  shoulder: number;
  /** Metres along the path averaged into the profile */
  smoothing: number;
}

export const DEFAULT_FLATTEN: FlattenOptions = { shoulder: 6, smoothing: 24 };

/** Flattens the ground under the given edges (all when none given); returns the touched samples */
export function flattenUnderPaths(
  terrain: MapTerrain,
  paths: MapPaths,
  edgeIds: readonly string[] | null = null,
  options: FlattenOptions = DEFAULT_FLATTEN,
  beforeWrite?: (rect: GridRect) => void,
): GridRect | null {
  let rect: GridRect | null = null;
  for (const edge of selectedEdges(paths, edgeIds)) {
    const line = edgePolyline(paths, edge);
    if (line.length < 2) continue;
    const profile = heightProfile(terrain, line, options.smoothing);
    const reach = edge.width / 2 + options.shoulder;
    const r = boundsRect(terrain, line, reach);
    beforeWrite?.(r);
    const g = terrain.grid;
    for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const p = { x: sampleX(terrain, i), y: sampleY(terrain, j) };
        const hit = nearestOnPolyline(line, p);
        if (!hit || hit.dist >= reach) continue;
        const w = hit.dist <= edge.width / 2 ? 1 : brushWeight(hit.dist - edge.width / 2, options.shoulder, 1);
        const k = j * g.columns + i;
        const target = profile.at(hit.along);
        g.heights[k] += (target - g.heights[k]) * w;
      }
    }
    rect = rectUnion(rect, r);
  }
  return rect;
}

/** Paints `layer` under the given edges (all when none given) at full width; returns the touched texels */
export function paintUnderPaths(
  terrain: MapTerrain,
  paths: MapPaths,
  layer: number,
  edgeIds: readonly string[] | null = null,
  softEdge = 2,
  beforeWrite?: (rect: GridRect) => void,
): GridRect | null {
  let rect: GridRect | null = null;
  const res = terrain.splat.resolution;
  const w = new Float32Array(MAX_LAYERS);
  for (const edge of selectedEdges(paths, edgeIds)) {
    const line = edgePolyline(paths, edge);
    if (line.length < 2) continue;
    const half = edge.width / 2;
    const r = texelBounds(terrain, line, half + softEdge);
    beforeWrite?.(r);
    for (let v = r.j0; v <= r.j1; v++) {
      for (let u = r.i0; u <= r.i1; u++) {
        const hit = nearestOnPolyline(line, { x: texelX(terrain, u), y: texelY(terrain, v) });
        if (!hit || hit.dist >= half + softEdge) continue;
        const a = hit.dist <= half ? 1 : 1 - (hit.dist - half) / softEdge;
        const t = v * res + u;
        readWeights(terrain, t, w);
        for (let k = 0; k < MAX_LAYERS; k++) w[k] = k === layer ? w[k] + (255 - w[k]) * a : w[k] * (1 - a);
        writeWeights(terrain, t, w);
      }
    }
    rect = rectUnion(rect, r);
  }
  return rect;
}

function selectedEdges(paths: MapPaths, ids: readonly string[] | null): MapPathEdge[] {
  if (!ids) return paths.edges;
  const set = new Set(ids);
  return paths.edges.filter((e) => set.has(e.id));
}

/** Height along the line, sampled every 2 m and averaged over `smoothing` metres */
function heightProfile(terrain: MapTerrain, line: MapPoint[], smoothing: number): { at(along: number): number } {
  const length = polylineLength(line);
  const step = 2;
  const n = Math.max(2, Math.ceil(length / step) + 1);
  const raw = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const p = pointAt(line, Math.min(length, k * step));
    raw[k] = heightAt(terrain, p.x, p.y);
  }
  const half = Math.max(0, Math.round(smoothing / step / 2));
  const smooth = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    let count = 0;
    for (let d = -half; d <= half; d++) {
      const q = k + d;
      if (q < 0 || q >= n) continue;
      sum += raw[q];
      count++;
    }
    smooth[k] = sum / count;
  }
  // The ends keep the ground's height so the path meets what lies beyond
  smooth[0] = raw[0];
  smooth[n - 1] = raw[n - 1];
  return {
    at(along: number): number {
      const f = clamp(along / step, 0, n - 1);
      const k = Math.min(n - 2, Math.floor(f));
      const s = f - k;
      return smooth[k] * (1 - s) + smooth[k + 1] * s;
    },
  };
}

function boundsRect(terrain: MapTerrain, line: MapPoint[], pad: number): GridRect {
  const g = terrain.grid;
  const xs = line.map((p) => p.x);
  const ys = line.map((p) => p.y);
  return {
    i0: clamp(Math.floor((Math.min(...xs) - pad + terrain.width / 2) / g.cellSize), 0, g.columns - 1),
    i1: clamp(Math.ceil((Math.max(...xs) + pad + terrain.width / 2) / g.cellSize), 0, g.columns - 1),
    j0: clamp(Math.floor((Math.min(...ys) - pad + terrain.depth / 2) / g.cellSize), 0, g.rows - 1),
    j1: clamp(Math.ceil((Math.max(...ys) + pad + terrain.depth / 2) / g.cellSize), 0, g.rows - 1),
  };
}

function texelBounds(terrain: MapTerrain, line: MapPoint[], pad: number): GridRect {
  const res = terrain.splat.resolution;
  const xs = line.map((p) => p.x);
  const ys = line.map((p) => p.y);
  const u = (x: number) => ((x + terrain.width / 2) / terrain.width) * res;
  const v = (y: number) => ((y + terrain.depth / 2) / terrain.depth) * res;
  return {
    i0: clamp(Math.floor(u(Math.min(...xs) - pad)), 0, res - 1),
    i1: clamp(Math.ceil(u(Math.max(...xs) + pad)), 0, res - 1),
    j0: clamp(Math.floor(v(Math.min(...ys) - pad)), 0, res - 1),
    j1: clamp(Math.ceil(v(Math.max(...ys) + pad)), 0, res - 1),
  };
}
