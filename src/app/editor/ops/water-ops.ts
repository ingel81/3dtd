/**
 * Water: the main body (`terrain.water`) and further bodies
 * (`terrain.waterBodies`: a lake up the hill, a lava pool, a frozen pond),
 * each with its own level and a mask per height sample that says where it
 * stands. The mask brush paints a body, the basin fill floods from a sample
 * across every connected sample below its level, the lake brush digs a bed
 * under it, the sea fill floods in from the map's edge.
 */
import type { MapTerrain, MapWater, MapWaterKind } from '../../world/custom-map/map-document';
import { sampleRectAround, sampleX, sampleY, type GridRect } from '../model/grid';
import { brushWeight, type BrushSettings } from './brush';

export const DEFAULT_WATER_COLOR = '#2f5f6f';

/** Default look of a new body by kind */
export const BODY_COLORS: Record<MapWaterKind, string> = {
  water: DEFAULT_WATER_COLOR,
  sea: '#1f4f6a',
  swamp: '#4a5a2c',
  ice: '#cfe6ef',
  lava: '#ff5a14',
};

export function emptyWater(terrain: MapTerrain, level = 0): MapWater {
  return { level, mask: new Uint8Array(terrain.grid.columns * terrain.grid.rows), color: DEFAULT_WATER_COLOR };
}

/** The body a tool works on: -1 the main water, 0, 1 … the further bodies */
export function waterBody(terrain: MapTerrain, body = -1): MapWater | null {
  return body < 0 ? terrain.water : (terrain.waterBodies?.[body] ?? null);
}

/** Paint (or clear) the mask under the brush; samples past half weight flip */
export function waterMaskDab(terrain: MapTerrain, x: number, y: number, brush: BrushSettings, on: boolean, body = -1): GridRect {
  const water = waterBody(terrain, body);
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
export function fillBasin(terrain: MapTerrain, i: number, j: number, body = -1): GridRect | null {
  const water = waterBody(terrain, body);
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

/**
 * The height at which a hollow overflows: flood upward from sample (i, j)
 * in order of height (priority flood); the highest point passed before the
 * flood first steps down into another hollow or reaches the map edge is the
 * rim. Water up to just below it stays in the hollow.
 */
export function basinSpillHeight(terrain: MapTerrain, i: number, j: number): number {
  const g = terrain.grid;
  const c = g.columns;
  const h = g.heights;
  const seen = new Uint8Array(c * g.rows);
  const heap = new MinHeap();
  const start = j * c + i;
  heap.push(start, h[start]);
  seen[start] = 1;
  let level = h[start];
  while (heap.size) {
    const k = heap.pop();
    const hk = h[k];
    // Downhill past the rim: the water would run off here
    if (hk < level - 1e-4) return level;
    level = Math.max(level, hk);
    const ki = k % c;
    const kj = (k - ki) / c;
    if (ki === 0 || kj === 0 || ki === c - 1 || kj === g.rows - 1) return level;
    for (const n of [k - 1, k + 1, k - c, k + c]) {
      if (!seen[n]) {
        seen[n] = 1;
        heap.push(n, h[n]);
      }
    }
  }
  return level;
}

/** Binary min-heap of sample indices by height */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly values: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, value: number): void {
    const keys = this.keys;
    const values = this.values;
    let at = keys.length;
    keys.push(key);
    values.push(value);
    while (at > 0) {
      const up = (at - 1) >> 1;
      if (values[up] <= value) break;
      keys[at] = keys[up];
      values[at] = values[up];
      at = up;
    }
    keys[at] = key;
    values[at] = value;
  }

  pop(): number {
    const keys = this.keys;
    const values = this.values;
    const top = keys[0];
    const lastKey = keys.pop()!;
    const lastValue = values.pop()!;
    const n = keys.length;
    if (n) {
      let at = 0;
      for (;;) {
        const l = at * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const child = r < n && values[r] < values[l] ? r : l;
        if (values[child] >= lastValue) break;
        keys[at] = keys[child];
        values[at] = values[child];
        at = child;
      }
      keys[at] = lastKey;
      values[at] = lastValue;
    }
    return top;
  }
}

/** Share of samples under water (for the status line and validation) */
export function wetShare(terrain: MapTerrain): number {
  const w = terrain.water;
  if (!w) return 0;
  let n = 0;
  for (let k = 0; k < w.mask.length; k++) if (w.mask[k] && terrain.grid.heights[k] < w.level) n++;
  return n / w.mask.length;
}

/**
 * Dig a lake bed under a body: the ground under the brush sinks toward
 * `depth` below the body's level (soft toward the rim), and the mask marks
 * where it ends up under the level.
 */
export function lakeDab(terrain: MapTerrain, x: number, y: number, brush: BrushSettings, depth: number, rate: number, body = -1): GridRect {
  const water = waterBody(terrain, body);
  const rect = sampleRectAround(terrain, x, y, brush.radius);
  if (!water) return rect;
  const g = terrain.grid;
  const c = g.columns;
  for (let j = rect.j0; j <= rect.j1; j++) {
    for (let i = rect.i0; i <= rect.i1; i++) {
      const w = brushWeight(Math.hypot(sampleX(terrain, i) - x, sampleY(terrain, j) - y), brush.radius, Math.max(0.3, brush.falloff));
      if (w <= 0) continue;
      const k = j * c + i;
      const target = water.level - depth * w;
      if (g.heights[k] > target) g.heights[k] += (target - g.heights[k]) * Math.min(1, rate * brush.strength);
      if (g.heights[k] < water.level - 0.05) water.mask[k] = 255;
    }
  }
  return rect;
}

/** Flood a body in from the map's edge over every connected sample below its level (a sea) */
export function fillFromEdge(terrain: MapTerrain, body = -1): number {
  const water = waterBody(terrain, body);
  if (!water) return 0;
  const g = terrain.grid;
  const c = g.columns;
  const seen = new Uint8Array(c * g.rows);
  const stack: number[] = [];
  const push = (k: number) => {
    if (!seen[k] && g.heights[k] < water.level) {
      seen[k] = 1;
      stack.push(k);
    }
  };
  for (let i = 0; i < c; i++) {
    push(i);
    push((g.rows - 1) * c + i);
  }
  for (let j = 0; j < g.rows; j++) {
    push(j * c);
    push(j * c + c - 1);
  }
  let n = 0;
  while (stack.length) {
    const k = stack.pop()!;
    water.mask[k] = 255;
    n++;
    const ki = k % c;
    const kj = (k - ki) / c;
    if (ki > 0) push(k - 1);
    if (ki < c - 1) push(k + 1);
    if (kj > 0) push(k - c);
    if (kj < g.rows - 1) push(k + c);
  }
  return n;
}
