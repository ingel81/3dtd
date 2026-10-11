import {
  MAP_FORMAT,
  MAP_VERSION,
  type CustomMapDocument,
  type MapObject,
  type MapPathEdge,
  type MapPathNode,
  type MapPoint,
} from './map-document';

/**
 * A rich sample map, generated: rolling hills, a terraced mountain with
 * cliffs in the north-east, a river from north-west to south-east, forests,
 * a village around the HQ south of the river, and two roads from the west
 * and the north edge (the northern one crosses the river on a bridge).
 *
 * Deterministic for a seed. The editor and the game use it until shipped
 * maps exist; it also exercises every part of the renderer.
 */

const SIZE = 512;
const CELL = 2;
const COLS = SIZE / CELL + 1;
const SPLAT_RES = 512;
const WATER_LEVEL = 0;

/** Ground layers of the demo map, splat channel order */
export const DEMO_LAYERS = [
  'grass',
  'grass-lush',
  'meadow',
  'dirt',
  'forest-floor',
  'rocky-ground',
  'sand',
  'grass-dry',
] as const;

const L = Object.fromEntries(DEMO_LAYERS.map((id, k) => [id, k])) as Record<(typeof DEMO_LAYERS)[number], number>;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded 2D value noise with fbm, 0..1 */
class Noise {
  private readonly perm = new Uint8Array(512);
  private readonly vals = new Float32Array(256);

  constructor(rand: () => number) {
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
    for (let i = 0; i < 256; i++) this.vals[i] = rand();
  }

  value(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const h = (i: number, j: number): number => this.vals[this.perm[(this.perm[i & 255] + j) & 511]];
    const a = h(xi, yi);
    const b = h(xi + 1, yi);
    const c = h(xi, yi + 1);
    const d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  fbm(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += this.value(x, y) * amp;
      norm += amp;
      amp *= 0.5;
      x = x * 2.03 + 17.1;
      y = y * 2.03 - 9.7;
    }
    return sum / norm;
  }
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function segmentDistance(px: number, py: number, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - a.x) * dx + (py - a.y) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

function polylineDistance(px: number, py: number, line: MapPoint[]): number {
  let d = Infinity;
  for (let s = 0; s < line.length - 1; s++) d = Math.min(d, segmentDistance(px, py, line[s], line[s + 1]));
  return d;
}

/** Catmull-Rom through control points, sampled every `step` metres */
function spline(points: MapPoint[], step: number): MapPoint[] {
  const out: MapPoint[] = [];
  for (let s = 0; s < points.length - 1; s++) {
    const p0 = points[Math.max(0, s - 1)];
    const p1 = points[s];
    const p2 = points[s + 1];
    const p3 = points[Math.min(points.length - 1, s + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Distance field of polylines sampled on the height grid, read back bilinearly */
class DistanceGrid {
  private readonly d = new Float32Array(COLS * COLS);

  constructor(lines: MapPoint[][]) {
    for (let j = 0; j < COLS; j++) {
      for (let i = 0; i < COLS; i++) {
        const x = -SIZE / 2 + i * CELL;
        const y = -SIZE / 2 + j * CELL;
        let best = Infinity;
        for (const line of lines) best = Math.min(best, polylineDistance(x, y, line));
        this.d[j * COLS + i] = best;
      }
    }
  }

  at(x: number, y: number): number {
    const fx = Math.min(COLS - 1.001, Math.max(0, (x + SIZE / 2) / CELL));
    const fy = Math.min(COLS - 1.001, Math.max(0, (y + SIZE / 2) / CELL));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const k = j * COLS + i;
    const a = this.d[k];
    const b = this.d[k + 1];
    const c = this.d[k + COLS];
    const e = this.d[k + COLS + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
  }
}

export function createDemoMap(seed = 7): CustomMapDocument {
  const rand = mulberry32(seed);
  const noise = new Noise(rand);

  // River, roads and the village
  const river = spline(
    [
      { x: -270, y: 150 },
      { x: -170, y: 95 },
      { x: -95, y: 70 },
      { x: -30, y: 10 },
      { x: 40, y: -15 },
      { x: 120, y: -30 },
      { x: 190, y: -95 },
      { x: 270, y: -150 },
    ],
    4,
  );
  const hq: MapPoint = { x: 95, y: -150 };
  const spawnWest: MapPoint = { x: -248, y: -95 };
  const spawnNorth: MapPoint = { x: -60, y: 248 };

  const nodes: MapPathNode[] = [
    { id: 'w', ...spawnWest },
    { id: 'n', ...spawnNorth },
    { id: 'hq', ...hq },
    { id: 'x', x: 10, y: -110 }, // village junction
    { id: 'bn', x: -46, y: 40 }, // bridge north end
    { id: 'bs', x: -26, y: 4 }, // bridge south end
    { id: 'farm', x: 150, y: -205 },
    { id: 'mill', x: 175, y: -60 },
  ];
  const edges: MapPathEdge[] = [
    {
      id: 'west-road',
      a: 'w',
      b: 'x',
      width: 8,
      kind: 'road',
      via: [
        { x: -200, y: -110 },
        { x: -150, y: -85 },
        { x: -95, y: -100 },
        { x: -45, y: -125 },
      ],
    },
    {
      id: 'north-road',
      a: 'n',
      b: 'bn',
      width: 8,
      kind: 'road',
      via: [
        { x: -70, y: 200 },
        { x: -95, y: 150 },
        { x: -80, y: 100 },
        { x: -55, y: 62 },
      ],
    },
    { id: 'bridge', a: 'bn', b: 'bs', width: 7, kind: 'bridge' },
    {
      id: 'bridge-road',
      a: 'bs',
      b: 'x',
      width: 8,
      kind: 'road',
      via: [
        { x: -12, y: -30 },
        { x: -5, y: -70 },
      ],
    },
    { id: 'village-road', a: 'x', b: 'hq', width: 8, kind: 'road', via: [{ x: 50, y: -135 }] },
    { id: 'farm-path', a: 'hq', b: 'farm', width: 4, kind: 'path', via: [{ x: 125, y: -185 }] },
    { id: 'mill-path', a: 'hq', b: 'mill', width: 4, kind: 'path', via: [{ x: 135, y: -110 }, { x: 165, y: -80 }] },
  ];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const roadLines: MapPoint[][] = [];
  const bridgeLines: MapPoint[][] = [];
  for (const e of edges) {
    const line = spline([nodeById.get(e.a)!, ...(e.via ?? []), nodeById.get(e.b)!], 3);
    (e.kind === 'bridge' ? bridgeLines : roadLines).push(line);
  }

  const riverDist = new DistanceGrid([river]);
  const roadDist = new DistanceGrid(roadLines);
  const bridgeDist = new DistanceGrid(bridgeLines);
  const villageCenter: MapPoint = { x: 60, y: -140 };

  // Heights
  const heights = new Float32Array(COLS * COLS);
  for (let j = 0; j < COLS; j++) {
    for (let i = 0; i < COLS; i++) {
      const x = -SIZE / 2 + i * CELL;
      const y = -SIZE / 2 + j * CELL;
      let h = 3 + noise.fbm(x / 170, y / 170, 4) * 22 + (noise.fbm(x / 45 + 40, y / 45, 3) - 0.5) * 4;
      // Terraced mountain in the north-east, cliff bands between the steps
      const m = smoothstep(210, 40, Math.hypot(x - 190, y - 190)) * (0.75 + noise.fbm(x / 60, y / 60, 3) * 0.5);
      // Terrace phase warped by noise, so the steps do not run round like contour lines
      const raw = m * 58 + (noise.fbm(x / 35 - 70, y / 35 + 20, 3) - 0.5) * 14 * m;
      const step = 10;
      const lo = Math.floor(raw / step);
      const fr = raw / step - lo;
      h += (lo + smoothstep(0.45, 0.95, fr)) * step + (fr - 0.5) * 1.5 * m;
      // A lone hill with the ruin in the south-west
      h += smoothstep(70, 0, Math.hypot(x + 150, y + 190)) * 16;
      // River valley and bed
      const dr = riverDist.at(x, y);
      const valley = smoothstep(75, 10, dr);
      h = h * (1 - valley * 0.85) + valley * 1.4;
      h -= smoothstep(19, 6, dr) * 4.5;
      // Flatten the village
      const dv = Math.hypot(x - villageCenter.x, y - villageCenter.y);
      h = h + (4 - h) * smoothstep(85, 35, dv) * 0.8;
      heights[j * COLS + i] = h;
    }
  }
  // A light blur: features sharper than the 2 m grid draw as saw teeth
  heights.set(blurHeights(heights, 1));
  // Roads: pull heights towards a heavily blurred copy, so roads run smooth across the hills
  const blurred = blurHeights(heights, 6);
  for (let j = 0; j < COLS; j++) {
    for (let i = 0; i < COLS; i++) {
      const x = -SIZE / 2 + i * CELL;
      const y = -SIZE / 2 + j * CELL;
      const f = smoothstep(14, 4, roadDist.at(x, y));
      const k = j * COLS + i;
      heights[k] += (Math.max(blurred[k], 1.2) - heights[k]) * f;
    }
  }

  // Water: river bed under the level
  const mask = new Uint8Array(COLS * COLS);
  for (let j = 0; j < COLS; j++) {
    for (let i = 0; i < COLS; i++) {
      const x = -SIZE / 2 + i * CELL;
      const y = -SIZE / 2 + j * CELL;
      if (riverDist.at(x, y) < 26) mask[j * COLS + i] = 255;
    }
  }

  const heightAt = (x: number, y: number): number => {
    const fx = Math.min(COLS - 1.001, Math.max(0, (x + SIZE / 2) / CELL));
    const fy = Math.min(COLS - 1.001, Math.max(0, (y + SIZE / 2) / CELL));
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    const u = fx - i;
    const v = fy - j;
    const k = j * COLS + i;
    return (
      heights[k] * (1 - u) * (1 - v) +
      heights[k + 1] * u * (1 - v) +
      heights[k + COLS] * (1 - u) * v +
      heights[k + COLS + 1] * u * v
    );
  };
  const slopeAt = (x: number, y: number): number => {
    const dx = (heightAt(x + CELL, y) - heightAt(x - CELL, y)) / (2 * CELL);
    const dy = (heightAt(x, y + CELL) - heightAt(x, y - CELL)) / (2 * CELL);
    return (Math.atan(Math.hypot(dx, dy)) * 180) / Math.PI;
  };
  const forestAt = (x: number, y: number): number =>
    smoothstep(0.52, 0.62, noise.fbm(x / 95 + 300, y / 95 - 120, 4)) *
    smoothstep(12, 24, roadDist.at(x, y)) *
    smoothstep(18, 30, riverDist.at(x, y)) *
    smoothstep(70, 100, Math.hypot(x - villageCenter.x, y - villageCenter.y));

  // Splat
  const s0 = new Uint8Array(SPLAT_RES * SPLAT_RES * 4);
  const s1 = new Uint8Array(SPLAT_RES * SPLAT_RES * 4);
  const w = new Float32Array(8);
  for (let ty = 0; ty < SPLAT_RES; ty++) {
    for (let tx = 0; tx < SPLAT_RES; tx++) {
      const x = ((tx + 0.5) / SPLAT_RES - 0.5) * SIZE;
      const y = ((ty + 0.5) / SPLAT_RES - 0.5) * SIZE;
      const h = heightAt(x, y);
      const slope = slopeAt(x, y);
      const dr = riverDist.at(x, y);
      const n = noise.fbm(x / 40, y / 40, 4);
      const n2 = noise.fbm(x / 13 + 50, y / 13, 3);
      w.fill(0);
      w[L.grass] = 1;
      w[L['grass-lush']] = smoothstep(0.45, 0.7, n) * 1.3 + smoothstep(40, 18, dr) * 0.8;
      w[L.meadow] = smoothstep(0.55, 0.75, n2) * 0.9;
      w[L['grass-dry']] = smoothstep(14, 30, h) * smoothstep(0.35, 0.6, n) * 1.2;
      w[L['forest-floor']] = forestAt(x, y) * 2.2;
      w[L['rocky-ground']] = smoothstep(18, 32, slope) * 1.6 + smoothstep(32, 50, h) * 0.9;
      w[L.sand] = smoothstep(21, 14, dr) * 2.6 * (0.6 + n2 * 0.8);
      const dv = Math.hypot(x - villageCenter.x, y - villageCenter.y);
      w[L.dirt] =
        smoothstep(55, 20, dv) * (0.5 + n2) * 1.2 +
        smoothstep(9, 5, roadDist.at(x, y)) * 0.8 * n2 +
        smoothstep(16, 10, dr) * 0.9;
      let sum = 0;
      for (let k = 0; k < 8; k++) sum += w[k];
      const q = (ty * SPLAT_RES + tx) * 4;
      for (let k = 0; k < 8; k++) {
        const v = Math.round((w[k] / sum) * 255);
        (k < 4 ? s0 : s1)[q + (k & 3)] = v;
      }
    }
  }

  // Objects
  const objects: MapObject[] = [];
  let nextId = 1;
  const roadClear = (x: number, y: number, margin: number): boolean =>
    roadDist.at(x, y) > 4 + margin && bridgeDist.at(x, y) > 6 + margin;
  const dryLand = (x: number, y: number): boolean => heightAt(x, y) > WATER_LEVEL + 0.6;
  const clearOfMarks = (x: number, y: number, r: number): boolean =>
    Math.hypot(x - hq.x, y - hq.y) > 22 + r &&
    Math.hypot(x - spawnWest.x, y - spawnWest.y) > 14 + r &&
    Math.hypot(x - spawnNorth.x, y - spawnNorth.y) > 14 + r;
  const place = (asset: string, x: number, y: number, scale: number, rotation = rand() * Math.PI * 2, z = 0): void => {
    objects.push({ id: `o${nextId++}`, asset, x, y, z, rotation, scale });
  };
  const scatter = (spacing: number, fn: (x: number, y: number) => void): void => {
    for (let gy = -SIZE / 2 + spacing / 2; gy < SIZE / 2; gy += spacing) {
      for (let gx = -SIZE / 2 + spacing / 2; gx < SIZE / 2; gx += spacing) {
        fn(gx + (rand() - 0.5) * spacing * 0.9, gy + (rand() - 0.5) * spacing * 0.9);
      }
    }
  };
  const inside = (x: number, y: number, m: number): boolean => Math.abs(x) < SIZE / 2 - m && Math.abs(y) < SIZE / 2 - m;

  // Forests: conifers up high, broadleaf low, birches at the edges, dead trees here and there
  scatter(6.5, (x, y) => {
    const f = forestAt(x, y);
    if (!inside(x, y, 3) || f < 0.15 || rand() > f * 0.95) return;
    if (!roadClear(x, y, 3) || !dryLand(x, y) || !clearOfMarks(x, y, 6) || slopeAt(x, y) > 32) return;
    const h = heightAt(x, y);
    const r = rand();
    const conifer = smoothstep(8, 22, h) * 0.8 + 0.1;
    let asset: string;
    if (r < 0.03) asset = 'tree-dead';
    else if (f < 0.45 && r < 0.35) asset = 'tree-birch';
    else asset = rand() < conifer ? (rand() < 0.5 ? 'tree-pine' : 'tree-fir') : 'tree-oak';
    place(asset, x, y, 0.75 + rand() * 0.5);
  });
  // Undergrowth in and around the forests
  scatter(5, (x, y) => {
    const f = forestAt(x, y);
    if (!inside(x, y, 2) || f < 0.05 || rand() > 0.55 || !roadClear(x, y, 1) || !dryLand(x, y)) return;
    if (!clearOfMarks(x, y, 3)) return;
    const r = rand();
    place(r < 0.45 ? 'fern' : r < 0.8 ? 'bush' : r < 0.9 ? 'stump' : 'log', x, y, 0.7 + rand() * 0.6);
  });
  // Lone trees and bushes in the open
  scatter(22, (x, y) => {
    if (!inside(x, y, 4) || forestAt(x, y) > 0.1 || rand() > 0.35) return;
    if (!roadClear(x, y, 4) || !dryLand(x, y) || !clearOfMarks(x, y, 8) || slopeAt(x, y) > 25) return;
    if (Math.hypot(x - villageCenter.x, y - villageCenter.y) < 70) return;
    place(rand() < 0.6 ? 'tree-oak' : 'bush', x, y, 0.8 + rand() * 0.5);
  });
  // Grass clumps and flowers in meadows and along the river
  scatter(3.2, (x, y) => {
    if (!inside(x, y, 1) || rand() > 0.42 || !roadClear(x, y, 0.5) || !dryLand(x, y)) return;
    if (!clearOfMarks(x, y, 1) || slopeAt(x, y) > 28 || forestAt(x, y) > 0.5) return;
    const lush = noise.fbm(x / 40, y / 40, 4);
    if (lush < 0.42 && riverDist.at(x, y) > 40) return;
    place(rand() < 0.82 ? 'grass-clump' : 'flowers', x, y, 0.7 + rand() * 0.7);
  });
  // Rocks below cliffs and on the steep ground
  scatter(9, (x, y) => {
    if (!inside(x, y, 3) || !roadClear(x, y, 2) || !dryLand(x, y) || !clearOfMarks(x, y, 4)) return;
    const s = slopeAt(x, y);
    const p = smoothstep(16, 40, s) * 0.8 + 0.03;
    if (rand() > p) return;
    place(rand() < 0.65 ? 'rock-small' : 'rock-large', x, y, 0.6 + rand() * 0.9, rand() * Math.PI * 2, -0.3);
  });
  // River stones
  scatter(7, (x, y) => {
    const dr = riverDist.at(x, y);
    if (dr < 10 || dr > 20 || rand() > 0.35 || !roadClear(x, y, 2)) return;
    place('rock-small', x, y, 0.4 + rand() * 0.5, rand() * Math.PI * 2, -0.2);
  });

  // Village: houses along the roads near the junction and HQ, facing the road
  const houses: [number, number, string][] = [
    [-20, -95, 'house'],
    [-30, -132, 'house-large'],
    [25, -88, 'house'],
    [35, -158, 'house'],
    [70, -112, 'house-large'],
    [5, -150, 'barn'],
    [120, -140, 'house'],
    [100, -105, 'house'],
    [140, -170, 'barn'],
    [55, -185, 'house'],
  ];
  for (const [x, y, asset] of houses) {
    // Face the nearest road point
    let best = Infinity;
    let fx = x;
    let fy = y;
    for (const line of roadLines) {
      for (const p of line) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < best) {
          best = d;
          fx = p.x;
          fy = p.y;
        }
      }
    }
    // Front is local +Z; map rotation r turns +Z(north) by r counter-clockwise
    const rotation = Math.atan2(-(fx - x), fy - y);
    place(asset, x, y, 1, rotation);
    place('barrel', x + Math.cos(rotation) * 5, y + Math.sin(rotation) * 5, 1);
    if (rand() < 0.6) place('crate', x - Math.cos(rotation) * 5, y - Math.sin(rotation) * 5, 1);
  }
  place('well', 40, -128, 1);
  // Lamps along the village road
  for (const line of roadLines) {
    for (let k = 0; k < line.length; k += 7) {
      const p = line[k];
      if (Math.hypot(p.x - villageCenter.x, p.y - villageCenter.y) > 75) continue;
      const q = line[Math.min(line.length - 1, k + 1)];
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const len = Math.hypot(dx, dy) || 1;
      place('lamp-post', p.x + (-dy / len) * 5.5, p.y + (dx / len) * 5.5, 1, Math.atan2(dy, dx));
    }
  }
  // Fences around the farm fields and a stone wall at the ruin
  for (let k = 0; k < 9; k++) place('fence-wood', 160 + k * 4, -225, 1, 0);
  for (let k = 0; k < 6; k++) place('fence-wood', 158, -221 + k * 4, 1, Math.PI / 2);
  place('tower-ruin', -150, -190, 1);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 1.4 + 0.5;
    place('wall-stone', -150 + Math.cos(a) * 16, -190 + Math.sin(a) * 16, 1, a + Math.PI / 2);
  }

  const now = new Date(0).toISOString();
  return {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    meta: {
      id: 'demo-valley',
      name: 'Demo-Tal',
      author: '3DTD',
      description: 'Flusstal mit Dorf, Wald, Brücke und Felsen; zwei Straßen führen zum HQ.',
      createdAt: now,
      updatedAt: now,
    },
    terrain: {
      width: SIZE,
      depth: SIZE,
      grid: { columns: COLS, rows: COLS, cellSize: CELL, heights },
      layers: DEMO_LAYERS.map((material) => ({ material })),
      splat: { resolution: SPLAT_RES, maps: [s0, s1] },
      water: { level: WATER_LEVEL, mask, color: '#2d5a5e' },
      cliffAngle: 38,
      cliffMaterial: 'cliff',
    },
    objects,
    paths: { nodes, edges },
    spawns: [
      { id: 'west', name: 'Weststraße', ...spawnWest },
      { id: 'north', name: 'Nordstraße', ...spawnNorth },
    ],
    hq,
    environment: { sky: 'day', sunAzimuth: 215, sunElevation: 38, fogDensity: 0.0007, tint: '#ffffff' },
  };
}

function blurHeights(src: Float32Array, radius: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let j = 0; j < COLS; j++) {
    for (let i = 0; i < COLS; i++) {
      let s = 0;
      let n = 0;
      for (let d = -radius; d <= radius; d++) {
        const ii = i + d;
        if (ii < 0 || ii >= COLS) continue;
        s += src[j * COLS + ii];
        n++;
      }
      tmp[j * COLS + i] = s / n;
    }
  }
  for (let j = 0; j < COLS; j++) {
    for (let i = 0; i < COLS; i++) {
      let s = 0;
      let n = 0;
      for (let d = -radius; d <= radius; d++) {
        const jj = j + d;
        if (jj < 0 || jj >= COLS) continue;
        s += tmp[jj * COLS + i];
        n++;
      }
      out[j * COLS + i] = s / n;
    }
  }
  return out;
}
