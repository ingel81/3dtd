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

/** Metres the water stays below a hollow's rim */
export const RIM_MARGIN = 0.3;

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
  return wetShore(terrain, water.mask, seen, rect);
}

/**
 * The shore samples just above the level take the mask too, so the surface
 * meets the bank: every sample next to a `seen` one within `rect` (the
 * seen samples' bounds). Returns the rectangle grown by the shore.
 */
function wetShore(terrain: MapTerrain, mask: Uint8Array, seen: Uint8Array, rect: GridRect): GridRect {
  const g = terrain.grid;
  const c = g.columns;
  for (let jj = Math.max(0, rect.j0 - 1); jj <= Math.min(g.rows - 1, rect.j1 + 1); jj++) {
    for (let ii = Math.max(0, rect.i0 - 1); ii <= Math.min(c - 1, rect.i1 + 1); ii++) {
      const k = jj * c + ii;
      if (seen[k]) continue;
      if ((ii > 0 && seen[k - 1]) || (ii < c - 1 && seen[k + 1]) || (jj > 0 && seen[k - c]) || (jj < g.rows - 1 && seen[k + c])) {
        mask[k] = 255;
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

/** Samples where a body stands: its mask set and the ground below its level */
export function wetSamples(terrain: MapTerrain): Uint8Array {
  const h = terrain.grid.heights;
  const wet = new Uint8Array(h.length);
  for (const body of [terrain.water, ...(terrain.waterBodies ?? [])]) {
    if (!body) continue;
    for (let k = 0; k < h.length; k++) if (body.mask[k] && h[k] < body.level) wet[k] = 1;
  }
  return wet;
}

/**
 * New bodies of `kind` for the hollows a pour filled (pour.ts), each
 * RIM_MARGIN below where it overflows (rounded to 0.1 m), its mask over the
 * lake and its shore. A hollow too shallow for that margin stays dry, and
 * no more go in than a map carries. Returns how many went in.
 */
export function addPouredBodies(terrain: MapTerrain, lakes: readonly { level: number; floor: number; cells: Int32Array }[], kind: MapWaterKind, max: number): number {
  const g = terrain.grid;
  const c = g.columns;
  let added = 0;
  for (const lake of lakes) {
    if ((terrain.waterBodies?.length ?? 0) >= max) break;
    const level = Math.round((lake.level - RIM_MARGIN) * 10) / 10;
    if (level <= lake.floor + 0.1) continue;
    const body: MapWater = { ...emptyWater(terrain, level), color: BODY_COLORS[kind], kind };
    const seen = new Uint8Array(c * g.rows);
    let rect: GridRect | null = null;
    for (const k of lake.cells) {
      if (g.heights[k] >= level) continue;
      seen[k] = 1;
      body.mask[k] = 255;
      const i = k % c;
      const j = (k - i) / c;
      rect = rect ? { i0: Math.min(rect.i0, i), j0: Math.min(rect.j0, j), i1: Math.max(rect.i1, i), j1: Math.max(rect.j1, j) } : { i0: i, j0: j, i1: i, j1: j };
    }
    if (!rect) continue;
    wetShore(terrain, body.mask, seen, rect);
    terrain.waterBodies = [...(terrain.waterBodies ?? []), body];
    added++;
  }
  return added;
}

/** Metres a fill click may lie off a hollow's floor (on its wall or rim, on a hump in it) and still fill that hollow */
export const FILL_REACH = 40;

/**
 * Where a fill clicked at sample (i, j) floods from: the lowest point the
 * ground runs down to from there (steepest descent over the eight
 * neighbours), at most FILL_REACH metres away. A click on a crater's wall
 * or its rim fills the crater; in a hollow's floor it stays in the same
 * hollow, as the way down never climbs.
 */
export function hollowFloor(terrain: MapTerrain, i: number, j: number, reach = FILL_REACH): { i: number; j: number } {
  const g = terrain.grid;
  const c = g.columns;
  const h = g.heights;
  let k = j * c + i;
  for (let step = Math.ceil(reach / g.cellSize); step > 0; step--) {
    const ki = k % c;
    const kj = (k - ki) / c;
    let best = k;
    for (let nj = Math.max(0, kj - 1); nj <= Math.min(g.rows - 1, kj + 1); nj++) {
      for (let ni = Math.max(0, ki - 1); ni <= Math.min(c - 1, ki + 1); ni++) {
        if (h[nj * c + ni] < h[best]) best = nj * c + ni;
      }
    }
    if (best === k) break;
    k = best;
  }
  return { i: k % c, j: Math.floor(k / c) };
}

/**
 * The level a fill gives the hollow under sample (i, j) (its floor, see
 * hollowFloor): RIM_MARGIN under where it overflows, in a hollow shallower
 * than twice that half its depth, so a flat crater holds water too.
 * Rounded to 0.1 m; at or under the floor where no hollow is.
 */
export function basinBrim(terrain: MapTerrain, i: number, j: number): number {
  const spill = basinSpillHeight(terrain, i, j);
  const depth = spill - terrain.grid.heights[j * terrain.grid.columns + i];
  return Math.round((spill - Math.min(RIM_MARGIN, depth / 2)) * 10) / 10;
}

/**
 * Depth a hollow needs below the saddle it shares with another, on both
 * sides, to count as a hollow of its own; a shallower one is a dip in the
 * other's floor (the uneven bottom of a dug pit) and fills with it
 */
export const OWN_HOLLOW_DEPTH = 2;

/**
 * The height at which a hollow overflows: flood upward from sample (i, j)
 * in order of height (priority flood) and raise the level over every
 * sample passed. Past a saddle the flood finds lower ground beyond: the
 * water leaves there when that ground reaches the map's edge below the
 * saddle (it drains away) or when it is a hollow of its own
 * (OWN_HOLLOW_DEPTH deep below the saddle, and so is the lake so far).
 * A shallower dip on either side fills along and the flood goes on, so an
 * uneven floor does not stop the water at its first bump. The saddle is
 * the rim; water up to just below it stays in the hollow.
 */
export function basinSpillHeight(terrain: MapTerrain, i: number, j: number): number {
  const g = terrain.grid;
  const c = g.columns;
  const rows = g.rows;
  const h = g.heights;
  /** 0 not reached, 1 waiting in the heap, 2 in the lake, 3 in the ground beyond a saddle */
  const state = new Uint8Array(c * rows);
  const heap = new MinHeap();
  const onEdge = (k: number) => {
    const ki = k % c;
    const kj = (k - ki) / c;
    return ki === 0 || kj === 0 || ki === c - 1 || kj === rows - 1;
  };
  const start = j * c + i;
  heap.push(start, h[start]);
  state[start] = 1;
  let level = h[start];
  let floor = h[start];
  const beyond: number[] = [];
  while (heap.size) {
    const k = heap.pop();
    if (state[k] === 2) continue;
    const hk = h[k];
    if (hk < level - 1e-4) {
      // Down past a saddle: the ground below the level on the other side
      beyond.length = 0;
      beyond.push(k);
      state[k] = 3;
      let low = hk;
      let drains = false;
      // (the loop reaches the samples pushed while it runs)
      for (const b of beyond) {
        if (onEdge(b)) drains = true;
        low = Math.min(low, h[b]);
        const bi = b % c;
        for (const m of [bi > 0 ? b - 1 : -1, bi < c - 1 ? b + 1 : -1, b - c, b + c]) {
          if (m < 0 || m >= h.length || state[m] >= 2 || h[m] >= level) continue;
          state[m] = 3;
          beyond.push(m);
        }
      }
      if (drains || (level - low >= OWN_HOLLOW_DEPTH && level - floor >= OWN_HOLLOW_DEPTH)) return level;
      // A dip that fills with the lake
      floor = Math.min(floor, low);
      for (const b of beyond) state[b] = 2;
      for (const b of beyond) pushNeighbours(b);
      continue;
    }
    state[k] = 2;
    level = Math.max(level, hk);
    if (onEdge(k)) return level;
    pushNeighbours(k);
  }
  return level;

  function pushNeighbours(k: number): void {
    const ki = k % c;
    for (const n of [ki > 0 ? k - 1 : -1, ki < c - 1 ? k + 1 : -1, k - c, k + c]) {
      if (n < 0 || n >= h.length || state[n]) continue;
      state[n] = 1;
      heap.push(n, h[n]);
    }
  }
}

/** Binary min-heap of sample indices by height, growing as needed */
export class MinHeap {
  private keys = new Int32Array(1024);
  private values = new Float32Array(1024);
  private count = 0;

  get size(): number {
    return this.count;
  }

  push(key: number, value: number): void {
    if (this.count === this.keys.length) {
      const keys = new Int32Array(this.count * 2);
      const values = new Float32Array(this.count * 2);
      keys.set(this.keys);
      values.set(this.values);
      this.keys = keys;
      this.values = values;
    }
    const keys = this.keys;
    const values = this.values;
    let at = this.count++;
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
    const n = --this.count;
    if (n) {
      const lastKey = keys[n];
      const lastValue = values[n];
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
