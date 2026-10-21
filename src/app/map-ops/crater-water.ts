/**
 * A crater in a river (docs/WATER_NETWORK_PLAN.md, step 2, E283): what the
 * water does when the ground under it is blown away. Worked out on the
 * ground as it is now (the crater stamped in), for one crater at a time:
 *
 * - which river it cuts: one of whose stretches lies in the crater's bowl
 *   while the bowl reaches past that river's water (a crater wholly under
 *   the water only makes it deeper there, nothing to show);
 * - where the river enters the bowl and where it leaves it (its distances
 *   along it), and its levels there;
 * - the bowl's spill: the lowest height at which water standing in it gets
 *   out of it (a priority flood from its middle to past its wall), and where;
 * - the lake: up to the spill, but no higher than the river comes in; where
 *   the spill lies in the river's own bed downstream, the lake rises with
 *   the river there (the channel on is full again once it overflows);
 * - how much water that is, and so how long it takes to fill: 10 to 20 s of
 *   the simulation's time, the larger the longer (lava three times as long);
 * - where the spill is not the river's bed downstream (a crater on a slope):
 *   the way the water takes from it (outflow), down the steepest descent,
 *   filling the hollows on the way to their lowest edge, until it meets water
 *   or the map's edge; the old bed below stays dry.
 *
 * Nothing of it is stored; the renderer works it out when a crater comes or
 * deepens (CraterWater) and runs the filling on the simulation's clock.
 * Pure, without three.
 */
import type { MapRiver, MapRiverPoint } from '../world/custom-map/map-document';
import { sampleRiver } from '../world/custom-map/render/water/river-line';

/** The ground as the crater left it: samples in map metres from (originX, originY), a sample every `cellSize` */
export interface GroundGrid {
  columns: number;
  rows: number;
  cellSize: number;
  originX: number;
  originY: number;
  heights: ArrayLike<number>;
}

/** A crater in map metres */
export interface CraterAt {
  x: number;
  y: number;
  radius: number;
}

/** What a crater does to a river it cuts */
export interface CraterCut {
  /** The river's index in the terrain's list */
  river: number;
  /** Metres along the river (its drawn line, sampleRiver) where it enters the bowl and where it leaves it */
  entry: number;
  exit: number;
  /** The river's level where it comes in and where it went on */
  levelIn: number;
  levelOut: number;
  /** Where it comes in: the lip it falls over, map metres, and the river's half width there */
  lip: { x: number; y: number };
  lipHalf: number;
  /** The bowl's lowest point, m */
  floor: number;
  /** The lake's level once full, m */
  level: number;
  /** Where the full lake spills, map metres, and whether that is the river's own bed downstream */
  spill: { x: number; y: number };
  downstream: boolean;
  /** Cubic metres the lake holds, and the seconds of game time it takes to fill */
  volume: number;
  fillSeconds: number;
  /** Where the spill is not downstream: the water's new way from it, map metres with its surface; none else */
  outflow: MapRiverPoint[] | null;
  /** What the outflow ends on: water, lava or nothing (the map's edge, a basin); lava meeting water sets as rock */
  outflowMeets: 'water' | 'lava' | null;
}

/** Reach of the bowl as a share of the radius: past its wall (impact-stamp.ts CRATER_REACH_SQ ≈ 1.8 of r²) */
const BOWL_REACH = 1.4;
/** Seconds the smallest lake takes to fill, and the largest */
const FILL_MIN_S = 10;
const FILL_MAX_S = 20;
/** Cubic metres of the smallest lake and of the one that takes the longest (a nuke's) */
const FILL_SMALL_M3 = 50;
const FILL_LARGE_M3 = 50_000;
/** Lava fills this much slower */
const LAVA_SLOWER = 3;
/** Metres the bowl must reach past a river's water to cut it */
const PAST_WATER_M = 0.5;

/** The rivers crater `c` cuts, with what the water does there; none when it stays under the water or misses them */
export function craterCuts(
  ground: GroundGrid,
  rivers: readonly MapRiver[],
  c: CraterAt,
  /** Water at map metres (a river, a lake, the sea) and of what kind: an outflow ends there */
  wetAt: (x: number, y: number) => 'water' | 'lava' | null = () => null,
): CraterCut[] {
  const out: CraterCut[] = [];
  rivers.forEach((river, index) => {
    if (river.points.length < 2 || !nearBox(river, c)) return;
    const line = sampleRiver(river.points);
    const along = new Float64Array(line.length);
    for (let k = 1; k < line.length; k++) along[k] = along[k - 1] + Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y);
    // Its samples in the bowl (within the radius): the first and the last
    let first = -1;
    let last = -1;
    for (let k = 0; k < line.length; k++) {
      if (Math.hypot(line[k].x - c.x, line[k].y - c.y) < c.radius) {
        if (first < 0) first = k;
        last = k;
      }
    }
    if (first < 0 || !reachesPast(line, c)) return;
    const entry = first > 0 ? first - 1 : 0;
    const exit = last < line.length - 1 ? last + 1 : last;
    const levelIn = line[entry].height;
    const levelOut = line[exit].height;
    const bowl = spill(ground, c);
    // A bowl whose floor is not under the water coming in holds no lake: a crater filled in again (the editor's)
    if (!bowl || bowl.floor > levelIn - PAST_WATER_M) return;
    // The spill in its own bed downstream: the lake rises with the river there; elsewhere to the spill
    const downstream = inBand(line, exit, line.length - 1, bowl.x, bowl.y, 2);
    const level = Math.min(levelIn, downstream ? Math.max(bowl.level, levelOut) : bowl.level);
    const volume = lakeVolume(ground, c, level);
    const t = Math.min(1, Math.max(0, Math.log10(Math.max(volume, 1) / FILL_SMALL_M3) / Math.log10(FILL_LARGE_M3 / FILL_SMALL_M3)));
    const fillSeconds = (FILL_MIN_S + (FILL_MAX_S - FILL_MIN_S) * t) * (river.kind === 'lava' ? LAVA_SLOWER : 1);
    out.push({
      river: index,
      entry: along[entry],
      exit: along[exit],
      levelIn,
      levelOut,
      lip: { x: line[entry].x, y: line[entry].y },
      lipHalf: line[entry].width / 2,
      floor: bowl.floor,
      level: Math.max(level, bowl.floor),
      spill: { x: bowl.x, y: bowl.y },
      downstream,
      volume,
      fillSeconds,
      ...outflowOf(downstream, ground, rivers, c, bowl, line[entry].width, wetAt),
    });
  });
  return out;
}

/** The outflow of a spill that is not downstream, and what it meets */
function outflowOf(
  downstream: boolean,
  g: GroundGrid,
  rivers: readonly MapRiver[],
  c: CraterAt,
  bowl: { level: number; x: number; y: number },
  riverWidth: number,
  wetAt: (x: number, y: number) => 'water' | 'lava' | null,
): Pick<CraterCut, 'outflow' | 'outflowMeets'> {
  if (downstream) return { outflow: null, outflowMeets: null };
  const way = outflowFrom(g, rivers, c, bowl, riverWidth, wetAt);
  const end = way[way.length - 1];
  return { outflow: way, outflowMeets: end ? wetAt(end.x, end.y) : null };
}

/** Metres the outflow's water stands over its way: a thin stream */
const OUTFLOW_DEPTH = 0.3;
/** Longest way an outflow goes, m */
const OUTFLOW_MAX_M = 1500;
/** Width of the outflow as a share of the river's, at least and at most, m */
const OUTFLOW_SHARE = 0.5;
const OUTFLOW_MIN_W = 2;
const OUTFLOW_MAX_W = 8;

/**
 * The way the water takes from a spill that is not the river's bed: from
 * the spill out of the bowl (away from its middle), then down the steepest
 * descent over the ground's samples; a hollow on the way fills to its
 * lowest edge (a small priority flood) and the way goes on from there;
 * it ends on other water (a river, `wetAt`), at the map's edge or after
 * OUTFLOW_MAX_M. Its points every sample, the surface OUTFLOW_DEPTH over the
 * ground and never rising, its width a share of the river's.
 */
export function outflowFrom(
  g: GroundGrid,
  rivers: readonly MapRiver[],
  c: CraterAt,
  bowl: { level: number; x: number; y: number },
  riverWidth: number,
  wetAt: (x: number, y: number) => 'water' | 'lava' | null,
): MapRiverPoint[] {
  const width = Math.min(OUTFLOW_MAX_W, Math.max(OUTFLOW_MIN_W, riverWidth * OUTFLOW_SHARE));
  const at = (i: number, j: number) => g.heights[j * g.columns + i];
  let [i, j] = cellOf(g, bowl.x, bowl.y);
  const seen = new Set<number>();
  const out: MapRiverPoint[] = [];
  let surface = bowl.level;
  const push = (i: number, j: number) => {
    const x = g.originX + i * g.cellSize;
    const y = g.originY + j * g.cellSize;
    surface = Math.min(surface, at(i, j) + OUTFLOW_DEPTH);
    out.push({ x, y, width, height: surface });
  };
  // From the lake's edge on: the way from the rim out to the spill first
  const dx = bowl.x - c.x;
  const dy = bowl.y - c.y;
  const dl = Math.hypot(dx, dy) || 1;
  out.push({ x: c.x + (dx / dl) * c.radius * 0.9, y: c.y + (dy / dl) * c.radius * 0.9, width, height: surface });
  push(i, j);
  const inRiver = (x: number, y: number) => rivers.some((r) => r.points.some((p) => Math.hypot(p.x - x, p.y - y) < p.width / 2));
  for (let steps = 0; steps * g.cellSize < OUTFLOW_MAX_M; steps++) {
    seen.add(j * g.columns + i);
    if (i <= 0 || j <= 0 || i >= g.columns - 1 || j >= g.rows - 1) break;
    // The lowest neighbour not walked yet, out of the bowl first: the steepest descent
    let best = -1;
    let bestH = Infinity;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        const k = nj * g.columns + ni;
        if (seen.has(k)) continue;
        const x = g.originX + ni * g.cellSize;
        const y = g.originY + nj * g.cellSize;
        if (Math.hypot(x - c.x, y - c.y) < c.radius) continue;
        const h = at(ni, nj) + (di && dj ? 0 : -1e-6);
        if (h < bestH) {
          bestH = h;
          best = k;
        }
      }
    }
    if (best < 0) break;
    // A hollow: the water stands in it up to its lowest edge, and goes on from there
    if (bestH > at(i, j) + 0.01) {
      const edge = hollowEdge(g, i, j, seen);
      if (!edge) break;
      surface = Math.min(surface, edge.level + OUTFLOW_DEPTH);
      [i, j] = [edge.i, edge.j];
    } else {
      i = best % g.columns;
      j = Math.floor(best / g.columns);
    }
    push(i, j);
    const p = out[out.length - 1];
    if (inRiver(p.x, p.y) || wetAt(p.x, p.y) !== null) break;
  }
  return out;
}

/** Samples a hollow's flood looks at, at most: a hollow larger than that is a basin the stream stops in */
const HOLLOW_CELLS = 4096;

/** The lowest edge out of the hollow at sample (i, j): a priority flood until a sample lower than the one it came from */
function hollowEdge(g: GroundGrid, i0: number, j0: number, seen: Set<number>): { i: number; j: number; level: number } | null {
  const at = (k: number) => g.heights[k];
  const start = j0 * g.columns + i0;
  const open: [number, number][] = [[at(start), start]];
  const done = new Set<number>([start]);
  let level = at(start);
  while (open.length && done.size < HOLLOW_CELLS) {
    // The lowest open sample (a short list: a sort is enough)
    open.sort((a, b) => b[0] - a[0]);
    const [h, k] = open.pop()!;
    level = Math.max(level, h);
    const i = k % g.columns;
    const j = Math.floor(k / g.columns);
    if (h < level - 0.01 && !seen.has(k)) return { i, j, level };
    if (i <= 0 || j <= 0 || i >= g.columns - 1 || j >= g.rows - 1) return { i, j, level };
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (j + dj) * g.columns + i + di;
      if (done.has(n)) continue;
      done.add(n);
      seen.add(n);
      open.push([at(n), n]);
    }
  }
  return null;
}

/** Whether the crater's circle meets the box round the river's points and its widest water */
function nearBox(river: MapRiver, c: CraterAt): boolean {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let half = 0;
  for (const p of river.points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
    half = Math.max(half, p.width / 2);
  }
  const reach = c.radius + half;
  return c.x > x0 - reach && c.x < x1 + reach && c.y > y0 - reach && c.y < y1 + reach;
}

/** Whether the bowl reaches past the river's water somewhere on its rim (else it only deepens the bed) */
function reachesPast(line: readonly MapRiverPoint[], c: CraterAt): boolean {
  for (let a = 0; a < 16; a++) {
    const px = c.x + Math.cos((a / 16) * Math.PI * 2) * c.radius;
    const py = c.y + Math.sin((a / 16) * Math.PI * 2) * c.radius;
    let wet = false;
    for (const q of line) {
      if (Math.hypot(q.x - px, q.y - py) < q.width / 2 - PAST_WATER_M) {
        wet = true;
        break;
      }
    }
    if (!wet) return true;
  }
  return false;
}

/** Whether map (x, y) lies within `pad` metres of the river's water between samples `from` and `to` */
function inBand(line: readonly MapRiverPoint[], from: number, to: number, x: number, y: number, pad: number): boolean {
  for (let k = from; k <= to; k++) if (Math.hypot(line[k].x - x, line[k].y - y) < line[k].width / 2 + pad) return true;
  return false;
}

/** The ground's sample index nearest map (x, y), clamped to the grid */
function cellOf(g: GroundGrid, x: number, y: number): [number, number] {
  return [
    Math.min(g.columns - 1, Math.max(0, Math.round((x - g.originX) / g.cellSize))),
    Math.min(g.rows - 1, Math.max(0, Math.round((y - g.originY) / g.cellSize))),
  ];
}

/**
 * The bowl's spill: a priority flood from the crater's middle over the
 * samples within BOWL_REACH of its radius; the lowest height at which water
 * reaches the edge of that box (the highest ground on the lowest way out),
 * where, and the bowl's floor. Null for a crater off the grid.
 */
export function spill(g: GroundGrid, c: CraterAt): { level: number; x: number; y: number; floor: number } | null {
  const reach = c.radius * BOWL_REACH;
  const [ci, cj] = cellOf(g, c.x, c.y);
  const i0 = Math.max(0, Math.floor((c.x - reach - g.originX) / g.cellSize));
  const i1 = Math.min(g.columns - 1, Math.ceil((c.x + reach - g.originX) / g.cellSize));
  const j0 = Math.max(0, Math.floor((c.y - reach - g.originY) / g.cellSize));
  const j1 = Math.min(g.rows - 1, Math.ceil((c.y + reach - g.originY) / g.cellSize));
  if (i1 <= i0 || j1 <= j0) return null;
  const w = i1 - i0 + 1;
  const n = w * (j1 - j0 + 1);
  const done = new Uint8Array(n);
  // A binary heap of (level, cell)
  const heap: number[] = [];
  const levels: number[] = [];
  const push = (level: number, cell: number) => {
    heap.push(cell);
    levels.push(level);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (levels[p] <= levels[k]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      [levels[p], levels[k]] = [levels[k], levels[p]];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top: [number, number] = [levels[0], heap[0]];
    const lastCell = heap.pop()!;
    const lastLevel = levels.pop()!;
    if (heap.length) {
      heap[0] = lastCell;
      levels[0] = lastLevel;
      let k = 0;
      for (;;) {
        const a = 2 * k + 1;
        const b = a + 1;
        let m = k;
        if (a < heap.length && levels[a] < levels[m]) m = a;
        if (b < heap.length && levels[b] < levels[m]) m = b;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        [levels[m], levels[k]] = [levels[k], levels[m]];
        k = m;
      }
    }
    return top;
  };
  const height = (cell: number) => g.heights[(j0 + Math.floor(cell / w)) * g.columns + i0 + (cell % w)];
  const start = (cj - j0) * w + (ci - i0);
  let floor = Infinity;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (Math.hypot(g.originX + i * g.cellSize - c.x, g.originY + j * g.cellSize - c.y) < c.radius) floor = Math.min(floor, g.heights[j * g.columns + i]);
    }
  }
  push(height(start), start);
  done[start] = 1;
  while (heap.length) {
    const [level, cell] = pop();
    const ci2 = cell % w;
    const cj2 = Math.floor(cell / w);
    // Out at the edge of the box: the water gets away here at this level
    if (ci2 === 0 || cj2 === 0 || ci2 === w - 1 || cj2 === j1 - j0) {
      return { level, x: g.originX + (i0 + ci2) * g.cellSize, y: g.originY + (j0 + cj2) * g.cellSize, floor: Math.min(floor, height(start)) };
    }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nb = (cj2 + dj) * w + ci2 + di;
      if (done[nb]) continue;
      done[nb] = 1;
      push(Math.max(level, height(nb)), nb);
    }
  }
  return null;
}

/** Cubic metres a lake at `level` holds in the crater's bowl (its samples within the radius under the level) */
function lakeVolume(g: GroundGrid, c: CraterAt, level: number): number {
  const i0 = Math.max(0, Math.floor((c.x - c.radius - g.originX) / g.cellSize));
  const i1 = Math.min(g.columns - 1, Math.ceil((c.x + c.radius - g.originX) / g.cellSize));
  const j0 = Math.max(0, Math.floor((c.y - c.radius - g.originY) / g.cellSize));
  const j1 = Math.min(g.rows - 1, Math.ceil((c.y + c.radius - g.originY) / g.cellSize));
  let v = 0;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (Math.hypot(g.originX + i * g.cellSize - c.x, g.originY + j * g.cellSize - c.y) >= c.radius) continue;
      v += Math.max(0, level - g.heights[j * g.columns + i]) * g.cellSize * g.cellSize;
    }
  }
  return v;
}

/** The lake's level `seconds` of game time after its water started to come in: from the floor up, easing into full */
export function lakeLevelAt(cut: Pick<CraterCut, 'floor' | 'level' | 'fillSeconds'>, seconds: number): number {
  const t = Math.min(1, Math.max(0, seconds / cut.fillSeconds));
  // Fast at first, slower as the bowl widens toward its rim
  const eased = 1 - (1 - t) * (1 - t);
  return cut.floor + (cut.level - cut.floor) * eased;
}
