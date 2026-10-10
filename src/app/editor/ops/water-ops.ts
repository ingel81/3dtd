/**
 * Water: one level for the whole map and a mask per height sample that says
 * where water stands. The mask brush paints it; the basin fill floods from a
 * sample across every connected sample below the level.
 */
import type { MapTerrain, MapWater } from '../../world/custom-map/map-document';
import { sampleRectAround, sampleX, sampleY, type GridRect } from '../model/grid';
import { brushWeight, type BrushSettings } from './brush';

export const DEFAULT_WATER_COLOR = '#2f5f6f';

export function emptyWater(terrain: MapTerrain, level = 0): MapWater {
  return { level, mask: new Uint8Array(terrain.grid.columns * terrain.grid.rows), color: DEFAULT_WATER_COLOR };
}

/** Paint (or clear) the mask under the brush; samples past half weight flip */
export function waterMaskDab(terrain: MapTerrain, x: number, y: number, brush: BrushSettings, on: boolean): GridRect {
  const water = terrain.water;
  const rect = sampleRectAround(terrain, x, y, brush.radius);
  if (!water) return rect;
  const c = terrain.grid.columns;
  for (let j = rect.j0; j <= rect.j1; j++) {
    for (let i = rect.i0; i <= rect.i1; i++) {
      const w = brushWeight(Math.hypot(sampleX(terrain, i) - x, sampleY(terrain, j) - y), brush.radius, brush.falloff);
      if (w >= 0.5) water.mask[j * c + i] = on ? 255 : 0;
    }
  }
  return rect;
}

/**
 * Flood from sample (i, j) over 4-neighbours whose height lies below the
 * water level and mark them wet. Returns the filled samples' rectangle, or
 * null when the start sample is above the level.
 */
export function fillBasin(terrain: MapTerrain, i: number, j: number): GridRect | null {
  const water = terrain.water;
  if (!water) return null;
  const g = terrain.grid;
  const c = g.columns;
  const level = water.level;
  if (g.heights[j * c + i] >= level) return null;
  const seen = new Uint8Array(c * g.rows);
  const stack = [j * c + i];
  seen[j * c + i] = 1;
  let rect: GridRect = { i0: i, j0: j, i1: i, j1: j };
  while (stack.length) {
    const k = stack.pop()!;
    water.mask[k] = 255;
    const ki = k % c;
    const kj = (k - ki) / c;
    if (ki < rect.i0 || ki > rect.i1 || kj < rect.j0 || kj > rect.j1) {
      rect = { i0: Math.min(rect.i0, ki), j0: Math.min(rect.j0, kj), i1: Math.max(rect.i1, ki), j1: Math.max(rect.j1, kj) };
    }
    const visit = (n: number) => {
      if (!seen[n] && g.heights[n] < level) {
        seen[n] = 1;
        stack.push(n);
      }
    };
    if (ki > 0) visit(k - 1);
    if (ki < c - 1) visit(k + 1);
    if (kj > 0) visit(k - c);
    if (kj < g.rows - 1) visit(k + c);
  }
  // The shore samples just above the level take the mask too, so the surface meets the bank
  for (let jj = Math.max(0, rect.j0 - 1); jj <= Math.min(g.rows - 1, rect.j1 + 1); jj++) {
    for (let ii = Math.max(0, rect.i0 - 1); ii <= Math.min(c - 1, rect.i1 + 1); ii++) {
      const k = jj * c + ii;
      if (seen[k]) continue;
      if ((ii > 0 && seen[k - 1]) || (ii < c - 1 && seen[k + 1]) || (jj > 0 && seen[k - c]) || (jj < g.rows - 1 && seen[k + c])) {
        water.mask[k] = 255;
      }
    }
  }
  return {
    i0: Math.max(0, rect.i0 - 1),
    j0: Math.max(0, rect.j0 - 1),
    i1: Math.min(c - 1, rect.i1 + 1),
    j1: Math.min(g.rows - 1, rect.j1 + 1),
  };
}

/** Share of samples under water (for the status line and validation) */
export function wetShare(terrain: MapTerrain): number {
  const w = terrain.water;
  if (!w) return 0;
  let n = 0;
  for (let k = 0; k < w.mask.length; k++) if (w.mask[k] && terrain.grid.heights[k] < w.level) n++;
  return n / w.mask.length;
}
