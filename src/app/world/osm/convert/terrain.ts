/**
 * The ground of an OSM world: the elevation mosaic (dem-tiles.ts) sampled
 * onto the map's height grid, smoothed a little, and set on a map zero (the
 * lowest ground, so the map's heights start at 0 and keep their sea level in
 * `zeroM`). Without a mosaic the ground is flat.
 */
import type { MapHeightGrid } from '../../custom-map/map-document';
import { sampleMosaicRows, type DemMosaic } from '../dem-tiles';
import type { OsmFrame } from '../osm-parse';

export interface OsmTerrainResult {
  /** Height above sea level of the map's zero, metres (0 on flat ground) */
  zeroM: number;
  /** Lowest and highest ground above sea level, metres */
  min: number;
  max: number;
}

/**
 * Box-blur passes (3 x 3 samples) over the sampled heights: the survey data's
 * steps at walls and kerbs (1 m data at a 3 m pixel) go, the land's shape
 * stays
 */
export const TERRAIN_SMOOTH_PASSES = 2;

/** Fills `grid` (a map of side `grid.columns - 1` cells around `frame`) from `dem`, smoothed, on its zero */
export function fillOsmTerrain(grid: MapHeightGrid, frame: OsmFrame, dem: DemMosaic | null, passes = TERRAIN_SMOOTH_PASSES): OsmTerrainResult {
  const h = grid.heights;
  if (!dem) {
    h.fill(0);
    return { zeroM: 0, min: 0, max: 0 };
  }
  const halfW = ((grid.columns - 1) * grid.cellSize) / 2;
  const halfD = ((grid.rows - 1) * grid.cellSize) / 2;
  const xs = Array.from({ length: grid.columns }, (_, i) => -halfW + i * grid.cellSize);
  const ys = Array.from({ length: grid.rows }, (_, j) => -halfD + j * grid.cellSize);
  sampleMosaicRows(dem, xs.map((x) => frame.geo({ x, y: 0 }).lon), ys.map((y) => frame.geo({ x: 0, y }).lat), h);
  for (let p = 0; p < passes; p++) boxBlur(h, grid.columns, grid.rows);
  let min = Infinity;
  let max = -Infinity;
  for (const v of h) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const zeroM = Math.floor(min);
  for (let k = 0; k < h.length; k++) h[k] -= zeroM;
  return { zeroM, min, max };
}

/** One 3 x 3 box blur in place, separable, the rim clamped */
function boxBlur(h: Float32Array, columns: number, rows: number): void {
  const tmp = new Float32Array(h.length);
  for (let j = 0; j < rows; j++) {
    const row = j * columns;
    for (let i = 0; i < columns; i++) {
      const a = h[row + Math.max(0, i - 1)];
      const b = h[row + i];
      const c = h[row + Math.min(columns - 1, i + 1)];
      tmp[row + i] = (a + b + c) / 3;
    }
  }
  for (let j = 0; j < rows; j++) {
    const up = Math.max(0, j - 1) * columns;
    const row = j * columns;
    const down = Math.min(rows - 1, j + 1) * columns;
    for (let i = 0; i < columns; i++) h[row + i] = (tmp[up + i] + tmp[row + i] + tmp[down + i]) / 3;
  }
}
