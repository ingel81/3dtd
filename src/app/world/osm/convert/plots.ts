import { MAX_LAYERS, readWeights, writeWeights } from '../../../map-ops/paint-ops';
import { DEFAULT_LINE, ObjectIds, objectsAlong } from '../../../map-ops/object-ops';
import { EdgeIndex } from '../../../map-ops/path-graph';
import { hashCell } from '../../../map-ops/landscape-noise';
import { fitSplatMaps, type CustomMapDocument, type MapObject, type MapPoint } from '../../custom-map/map-document';
import { SCENE_BUDGET } from '../../custom-map/render/objects/scene-cost';
import { isGroundBuilding } from '../building-tags';
import type { OsmArea, OsmFeatures } from '../osm-parse';
import { LineClearance } from './line-clear';
import { RAIL_GROUND, type RailPlan } from './rails';
import { fillRings, stampLine, type RasterGrid } from './raster';

/**
 * The plots of an OSM world's houses (report-vterrain 4: between the houses
 * lay one even lawn): every house's plot grows from its footprint over a
 * grid of a metre, up to REACH, kept off the streets with their pavements,
 * the track beds with their gravel, the other buildings, the surfaces of
 * squares and car parks and the water;
 * where two plots meet runs their boundary. Of each plot
 * - the front garden, the part before the house's front towards its street,
 *   is mown lawn (FRONT_MATERIAL), the garden behind leafier grass
 *   (BACK_MATERIAL), painted into the ground;
 * - a driveway of pavers (a surface, render/surfaces/) runs from the street
 *   along the side of the house with room for it to past its front, where
 *   no way is mapped there already;
 * - hedges stand on the boundaries at the sides and the back, a picket fence
 *   along some front gardens, thinned by a hash and held to PLOTS_BUDGET_SHARE
 *   of the scene budget; none reaches over a road, a path or a track bed
 *   (convert/line-clear.ts).
 * After the plants: the trees OSM maps in the gardens and what else stands
 * there keep their place, the pieces and driveways keep off them (STANDING).
 * OSM maps plots only here and there; the houses and streets say enough.
 */

/** Metres a plot reaches from its house at most */
const REACH = 20;
/** Footprints (m²) a house may have */
const HOUSE_AREA: readonly [number, number] = [30, 400];
/** `building` values of houses; `yes` counts up to YES_AREA m² */
const HOUSES = new Set(['house', 'detached', 'semidetached_house', 'bungalow', 'terrace', 'residential', 'farm']);
const YES_AREA = 250;
/** Metres from a house to its street at most for a front garden and a driveway */
const STREET_REACH = 30;
/** A driveway's width, how far it runs past the house's front along its side, and its gap to the wall */
const DRIVE_WIDTH = 3;
const DRIVE_PAST_FRONT = 5;
const DRIVE_WALL_GAP = 0.4;
/** Share of a driveway's ground that must lie on its plot */
const DRIVE_ON_PLOT = 0.85;
export const DRIVE_MATERIAL = 'pavers';
export const FRONT_MATERIAL = 'grass-lush';
export const BACK_MATERIAL = 'grass-leafy';
/** Weight of the back garden's grass over what the ground has there */
const BACK_SHARE = 0.65;
const HEDGE = { asset: 'hedge-long', spacing: 6 };
const FENCE = { asset: 'fence-picket', spacing: 3.6 };
/** Shares of boundaries with a hedge, of front gardens with a fence */
const HEDGE_SHARE = 0.7;
const FENCE_SHARE = 0.35;
/** Shortest stretch of boundary that gets pieces, metres; how far a boundary may leave its staircase of cells */
const MIN_RUN = 3;
const SIMPLIFY = 0.8;
/** Metres the pieces and driveways keep from the HQ and the spawns, as the furniture's */
const HQ_CLEAR = 25;
const SPAWN_CLEAR = 10;
/** Metres a piece or a driveway keeps from an object standing already (a tree, a lamp) */
const STANDING = 1.5;
/** Share of the scene budget the plots' pieces may take */
export const PLOTS_BUDGET_SHARE = 0.05;

/** Cell kinds besides a house's index */
const OPEN = -1;
const BARRIER = -2;

export interface PlotOptions {
  costOf: (asset: string) => number;
  /** Whether the catalogue has a ground material; null: all */
  hasMaterial?: ((material: string) => boolean) | null;
  /** Points the plots' pieces may cost, default PLOTS_BUDGET_SHARE of SCENE_BUDGET */
  budget?: number;
  /** The railway: no plot crosses its beds */
  rails?: RailPlan;
}

export interface PlotReport {
  houses: number;
  /** Houses with a front garden, and with a driveway */
  fronts: number;
  driveways: number;
  /** Pieces placed: hedges, fences; dropped past the budget */
  hedges: number;
  fences: number;
  dropped: number;
  cost: number;
}

interface House {
  area: OsmArea;
  c: MapPoint;
  /** Unit direction towards its street, null without one near */
  d: MapPoint | null;
  /** Its outline's reach along d (the front) and across it */
  front: number;
  sideMin: number;
  sideMax: number;
  /** Distance along d to its street's near edge (with the pavement) */
  street: number;
}

/** Lays the plots of the houses of `features` into `doc`: ground paint, driveways (surfaces), hedges and fences */
export function layPlots(doc: CustomMapDocument, features: OsmFeatures, options: PlotOptions): PlotReport {
  const report: PlotReport = { houses: 0, fronts: 0, driveways: 0, hedges: 0, fences: 0, dropped: 0, cost: 0 };
  const t = doc.terrain;
  const side = Math.max(t.width, t.depth);
  const grid: RasterGrid = { n: Math.ceil(side) + 1, origin: -side / 2, step: 1 };
  const n = grid.n;
  const label = new Int32Array(n * n).fill(OPEN);
  const dist = new Float32Array(n * n).fill(Infinity);

  // What no plot crosses: the streets with their pavements, other buildings, squares and car parks, water
  const nodes = new Map(doc.paths.nodes.map((p) => [p.id, p]));
  for (const e of doc.paths.edges) {
    const a = nodes.get(e.a);
    const b = nodes.get(e.b);
    if (e.tunnel || !a || !b) continue;
    stampLine([a, ...(e.via ?? []), b], grid, e.width / 2 + (e.sidewalk ?? 0) + 0.3, (i, j) => (label[j * n + i] = BARRIER));
  }
  const houses: House[] = [];
  for (const a of features.areas) {
    if (a.tags['building'] && !isHouse(a)) fillRings([...a.outer, ...a.inner], grid, (i, j) => (label[j * n + i] = BARRIER));
    else if (a.tags['natural'] === 'water' || a.tags['waterway'] === 'riverbank') fillRings([...a.outer, ...a.inner], grid, (i, j) => (label[j * n + i] = BARRIER));
  }
  for (const s of doc.surfaces ?? []) fillRings([s.outer, ...(s.holes ?? [])], grid, (i, j) => (label[j * n + i] = BARRIER));
  for (const c of options.rails?.chains ?? []) stampLine(c.line, grid, RAIL_GROUND.half, (i, j) => (label[j * n + i] = BARRIER));
  // The houses: each its footprint as the seed of its plot
  for (const a of features.areas) {
    if (!isHouse(a) || !a.outer.length) continue;
    const ring = a.outer[0];
    const c = ring.reduce((s, p) => ({ x: s.x + p.x / ring.length, y: s.y + p.y / ring.length }), { x: 0, y: 0 });
    if (Math.abs(c.x) > t.width / 2 - REACH || Math.abs(c.y) > t.depth / 2 - REACH) continue;
    const index = houses.length;
    houses.push({ area: a, c, d: null, front: 0, sideMin: 0, sideMax: 0, street: Infinity });
    fillRings(a.outer, grid, (i, j) => {
      const k = j * n + i;
      label[k] = index;
      dist[k] = 0;
    });
  }
  report.houses = houses.length;
  if (!houses.length) return report;
  growPlots(label, dist, n);

  // Each house's street: the nearest road, the house's front towards it
  const roads = new EdgeIndex({ nodes: doc.paths.nodes, edges: doc.paths.edges.filter((e) => !e.tunnel && e.kind !== 'bridge' && !e.area) });
  for (const h of houses) {
    const hit = roads.nearest(h.c, STREET_REACH);
    if (!hit || hit.dist < 1) continue;
    const d = { x: (hit.point.x - h.c.x) / hit.dist, y: (hit.point.y - h.c.y) / hit.dist };
    const ring = h.area.outer[0];
    h.front = Math.max(...ring.map((p) => (p.x - h.c.x) * d.x + (p.y - h.c.y) * d.y));
    const across = ring.map((p) => -(p.x - h.c.x) * d.y + (p.y - h.c.y) * d.x);
    h.sideMin = Math.min(...across);
    h.sideMax = Math.max(...across);
    h.street = hit.dist - hit.edge.width / 2 - (hit.edge.sidewalk ?? 0);
    if (h.street > h.front + 1) h.d = d;
  }
  const isFront = (k: number): boolean => {
    const h = houses[label[k]];
    if (!h?.d || dist[k] <= 0) return false;
    const x = grid.origin + (k % n);
    const y = grid.origin + Math.floor(k / n);
    return (x - h.c.x) * h.d.x + (y - h.c.y) * h.d.y > h.front + 0.5;
  };

  paintGardens(doc, label, dist, grid, isFront, options.hasMaterial ?? null);
  report.fronts = houses.filter((h) => h.d).length;

  const clearings = [{ ...doc.hq, r: HQ_CLEAR }, ...doc.spawns.map((s) => ({ x: s.x, y: s.y, r: SPAWN_CLEAR }))];
  const cleared = (p: MapPoint): boolean => clearings.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < c.r);
  // What stands already (the plants, the furniture), by 4 m cells
  const standing = new Map<number, MapPoint[]>();
  const cellKey = (i: number, j: number) => (i + 32768) * 65536 + j + 32768;
  for (const o of doc.objects) {
    const key = cellKey(Math.floor(o.x / 4), Math.floor(o.y / 4));
    const list = standing.get(key);
    if (list) list.push(o);
    else standing.set(key, [o]);
  }
  const occupied = (p: MapPoint, r: number): boolean => {
    for (let i = Math.floor((p.x - r) / 4); i <= Math.floor((p.x + r) / 4); i++) {
      for (let j = Math.floor((p.y - r) / 4); j <= Math.floor((p.y + r) / 4); j++) {
        for (const q of standing.get(cellKey(i, j)) ?? []) if (Math.hypot(q.x - p.x, q.y - p.y) < r) return true;
      }
    }
    return false;
  };

  // Driveways: along the side of the house with room, from the street's edge to past the front; none over a tree
  const surfaces = (doc.surfaces ??= []);
  if (!options.hasMaterial || options.hasMaterial(DRIVE_MATERIAL)) {
    houses.forEach((h, index) => {
      const drive = driveway(h, index, label, dist, grid, roads);
      if (!drive) return;
      if (drive.some(cleared)) return;
      const [a, b, c] = drive;
      for (let u = 0; u <= 6; u++) {
        for (let v = 0; v <= 2; v++) {
          if (occupied({ x: a.x + ((b.x - a.x) * u) / 6 + ((c.x - b.x) * v) / 2, y: a.y + ((b.y - a.y) * u) / 6 + ((c.y - b.y) * v) / 2 }, STANDING)) return;
        }
      }
      surfaces.push({ id: `plot-drive-${h.area.id}`, material: DRIVE_MATERIAL, outer: drive });
      report.driveways++;
    });
  }

  // Hedges on the sides and backs, a fence along some front gardens
  const seed = Math.round(features.frame.lat * 1e4) ^ Math.round(features.frame.lon * 1e4);

  const ids = new ObjectIds(doc.objects);
  const budget = options.budget ?? PLOTS_BUDGET_SHARE * SCENE_BUDGET;
  const clearance = new LineClearance(doc.paths, options.rails ?? null, { roadClear: 0.3, pavements: true });
  const along = (line: MapPoint[], piece: { asset: string; spacing: number }): MapObject[] =>
    clearance.runs(line).flatMap((run) => objectsAlong(run, piece.asset, { ...DEFAULT_LINE, turn: 'across', spacing: piece.spacing }, ids, () => 0).filter((o) => clearance.fits(o, piece.spacing / 2)));
  const placed: MapObject[] = [];
  const keep = (pieces: MapObject[], kind: 'hedges' | 'fences', group: string): void => {
    for (const o of pieces) {
      if (cleared(o) || occupied(o, STANDING)) continue;
      const cost = options.costOf(o.asset);
      if (report.cost + cost > budget) {
        report.dropped++;
        continue;
      }
      report.cost += cost;
      report[kind]++;
      placed.push({ ...o, group });
    }
  };
  for (const run of boundaries(label, dist, n, isFront)) {
    const line = simplify(run.points.map(([i, j]) => ({ x: grid.origin + i - 0.5, y: grid.origin + j - 0.5 })), SIMPLIFY);
    const length = line.reduce((s, p, k) => (k ? s + Math.hypot(p.x - line[k - 1].x, p.y - line[k - 1].y) : 0), 0);
    if (length < MIN_RUN) continue;
    const pick = hashCell(run.points[0][0], run.points[0][1], seed);
    const group = `plot-b${run.points[0][0]}-${run.points[0][1]}`;
    if (run.front) {
      if (pick < FENCE_SHARE) keep(along(line, FENCE), 'fences', group);
    } else if (pick < HEDGE_SHARE) {
      keep(along(line, HEDGE), 'hedges', group);
    }
  }
  doc.objects.push(...placed);
  report.cost = Math.round(report.cost);
  return report;
}

/** Whether an area is a house with a garden (not a block of flats, a shed or a barn) */
export function isHouse(a: OsmArea): boolean {
  const b = a.tags['building'];
  if (!b || !isGroundBuilding(a.tags) || a.area < HOUSE_AREA[0] || a.area > HOUSE_AREA[1]) return false;
  return HOUSES.has(b) || (b === 'yes' && a.area <= YES_AREA);
}

/**
 * Grows the houses' labels over the open cells, each cell to the nearest
 * house around the barriers (chamfer passes, twice each way), up to REACH
 */
function growPlots(label: Int32Array, dist: Float32Array, n: number): void {
  const a = 1;
  const b = Math.SQRT2;
  const relax = (k: number, from: number, w: number): void => {
    const v = dist[from] + w;
    if (label[from] >= 0 && v < dist[k] && v <= REACH) {
      dist[k] = v;
      label[k] = label[from];
    }
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1; i < n - 1; i++) {
        const k = j * n + i;
        if (label[k] === BARRIER || dist[k] === 0) continue;
        relax(k, k - 1, a);
        relax(k, k - n, a);
        relax(k, k - n - 1, b);
        relax(k, k - n + 1, b);
      }
    }
    for (let j = n - 2; j >= 1; j--) {
      for (let i = n - 2; i >= 1; i--) {
        const k = j * n + i;
        if (label[k] === BARRIER || dist[k] === 0) continue;
        relax(k, k + 1, a);
        relax(k, k + n, a);
        relax(k, k + n + 1, b);
        relax(k, k + n - 1, b);
      }
    }
  }
}

/** The gardens into the ground: front gardens mown lawn, the gardens behind leafier grass over what was there */
function paintGardens(doc: CustomMapDocument, label: Int32Array, dist: Float32Array, grid: RasterGrid, isFront: (k: number) => boolean, has: ((m: string) => boolean) | null): void {
  const t = doc.terrain;
  const layerIndex = (material: string): number => {
    if (has && !has(material)) return -1;
    let k = t.layers.findIndex((l) => l.material === material);
    if (k < 0 && t.layers.length < MAX_LAYERS) {
      t.layers.push({ material });
      k = t.layers.length - 1;
    }
    return k;
  };
  const front = layerIndex(FRONT_MATERIAL);
  const back = layerIndex(BACK_MATERIAL);
  if (front < 0 && back < 0) return;
  fitSplatMaps(t);
  const res = t.splat.resolution;
  const w = new Float32Array(MAX_LAYERS);
  const n = grid.n;
  for (let ty = 0; ty < res; ty++) {
    const y = ((ty + 0.5) / res - 0.5) * t.depth;
    const j = Math.round(y - grid.origin);
    if (j < 0 || j >= n) continue;
    for (let tx = 0; tx < res; tx++) {
      const x = ((tx + 0.5) / res - 0.5) * t.width;
      const i = Math.round(x - grid.origin);
      if (i < 0 || i >= n) continue;
      const k = j * n + i;
      if (label[k] < 0 || dist[k] <= 0) continue;
      const layer = isFront(k) ? front : back;
      if (layer < 0) continue;
      const texel = ty * res + tx;
      readWeights(t, texel, w);
      const share = layer === front ? 1 : BACK_SHARE;
      for (let c = 0; c < MAX_LAYERS; c++) w[c] *= 1 - share;
      w[layer] += 255 * share;
      writeWeights(t, texel, w);
    }
  }
}

/** A house's driveway (its outline), null where none fits or a way runs there already */
function driveway(h: House, index: number, label: Int32Array, dist: Float32Array, grid: RasterGrid, roads: EdgeIndex): MapPoint[] | null {
  const d = h.d;
  if (!d) return null;
  const e = { x: -d.y, y: d.x };
  // From past the street's edge (under the road's surface, which draws over it) to past the house's front
  const s0 = h.street + 0.3;
  const s1 = h.front - DRIVE_PAST_FRONT;
  if (s0 - s1 < 4) return null;
  const n = grid.n;
  const at = (s: number, o: number): MapPoint => ({ x: h.c.x + d.x * s + e.x * o, y: h.c.y + d.y * s + e.y * o });
  let best: { o: number; share: number } | null = null;
  for (const o of [h.sideMax + DRIVE_WALL_GAP + DRIVE_WIDTH / 2, h.sideMin - DRIVE_WALL_GAP - DRIVE_WIDTH / 2]) {
    let on = 0;
    let all = 0;
    for (let s = s1; s <= s0 - 1.5; s += 1) {
      for (let u = -DRIVE_WIDTH / 2 + 0.5; u <= DRIVE_WIDTH / 2 - 0.5; u += 1) {
        const p = at(s, o + u);
        const i = Math.round(p.x - grid.origin);
        const j = Math.round(p.y - grid.origin);
        all++;
        if (i >= 0 && j >= 0 && i < n && j < n && label[j * n + i] === index && dist[j * n + i] > 0) on++;
      }
    }
    const share = all ? on / all : 0;
    if (share >= DRIVE_ON_PLOT && (!best || share > best.share)) best = { o, share };
  }
  if (!best) return null;
  // A way mapped along it (a service road, a driveway of OSM's): that one shows
  const mid = at((s0 + s1) / 2, best.o);
  const near = roads.nearest(mid, DRIVE_WIDTH);
  if (near && near.dist < near.edge.width / 2 + DRIVE_WIDTH / 2) return null;
  const w = DRIVE_WIDTH / 2;
  // Counter-clockwise seen from above (map x east, y north)
  const quad = [at(s1, best.o - w), at(s0, best.o - w), at(s0, best.o + w), at(s1, best.o + w)];
  const area = quad.reduce((s, p, k) => s + p.x * quad[(k + 1) % 4].y - quad[(k + 1) % 4].x * p.y, 0);
  return (area < 0 ? quad.reverse() : quad).map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));
}

interface Run {
  /** Grid corners along the boundary */
  points: [number, number][];
  /** A front garden's edge towards the street */
  front: boolean;
}

/**
 * The plots' boundaries as runs of cell edges: between two plots and
 * between a plot and open ground (sides and backs), and between a front
 * garden and the street (`front`); none along a house's walls (cells next
 * to a footprint) nor between two front gardens' kerbs and the street's
 */
function boundaries(label: Int32Array, dist: Float32Array, n: number, isFront: (k: number) => boolean): Run[] {
  // Edge kind per cell edge: 0 none, 1 side or back, 2 front; h: the edge left of corner (i, j) to (i + 1, j) ... stored by its lower corner
  const horizontal = new Uint8Array(n * n);
  const vertical = new Uint8Array(n * n);
  const kind = (a: number, b: number): number => {
    const la = label[a];
    const lb = label[b];
    if (la === lb) return 0;
    if (la < 0 && lb < 0) return 0;
    if ((la >= 0 && dist[a] < 1.5) || (lb >= 0 && dist[b] < 1.5)) return 0;
    const fa = la >= 0 && isFront(a);
    const fb = lb >= 0 && isFront(b);
    if (la === BARRIER || lb === BARRIER) return fa || fb ? 2 : 0;
    if (fa && fb) return 0;
    return 1;
  };
  for (let j = 1; j < n; j++) {
    for (let i = 1; i < n; i++) {
      const k = j * n + i;
      // Between cell (i - 1, j) and (i, j): the vertical edge at corner column i, rows j .. j + 1
      vertical[k] = kind(k - 1, k);
      // Between cell (i, j - 1) and (i, j): the horizontal edge at corner row j, columns i .. i + 1
      horizontal[k] = kind(k - n, k);
    }
  }
  // Chains of one kind from corner to corner, ending where they fork or turn kind
  const degree = (i: number, j: number, want: number): number =>
    (vertical[j * n + i] === want ? 1 : 0) + (j > 0 && vertical[(j - 1) * n + i] === want ? 1 : 0) + (horizontal[j * n + i] === want ? 1 : 0) + (i > 0 && horizontal[j * n + i - 1] === want ? 1 : 0);
  const runs: Run[] = [];
  const take = (i: number, j: number, want: number): void => {
    const points: [number, number][] = [[i, j]];
    let ci = i;
    let cj = j;
    for (;;) {
      let ni = -1;
      let nj = -1;
      if (vertical[cj * n + ci] === want) {
        vertical[cj * n + ci] = 0;
        ni = ci;
        nj = cj + 1;
      } else if (cj > 0 && vertical[(cj - 1) * n + ci] === want) {
        vertical[(cj - 1) * n + ci] = 0;
        ni = ci;
        nj = cj - 1;
      } else if (horizontal[cj * n + ci] === want) {
        horizontal[cj * n + ci] = 0;
        ni = ci + 1;
        nj = cj;
      } else if (ci > 0 && horizontal[cj * n + ci - 1] === want) {
        horizontal[cj * n + ci - 1] = 0;
        ni = ci - 1;
        nj = cj;
      }
      if (ni < 0) break;
      points.push([ni, nj]);
      ci = ni;
      cj = nj;
      if (degree(ci, cj, want) !== 1) break;
    }
    if (points.length > 1) runs.push({ points, front: want === 2 });
  };
  for (const want of [1, 2]) {
    // Ends first (a corner with one edge of the kind), then what is left (closed loops)
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (degree(i, j, want) === 1) take(i, j, want);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) while (degree(i, j, want) > 0) take(i, j, want);
  }
  return runs;
}

/** A line's points within `tolerance` of the line through fewer (Douglas and Peucker) */
function simplify(line: readonly MapPoint[], tolerance: number): MapPoint[] {
  if (line.length < 3) return [...line];
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const p = line[a];
    const q = line[b];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const l = Math.hypot(dx, dy) || 1;
    let far = -1;
    let worst = tolerance;
    for (let k = a + 1; k < b; k++) {
      const d = Math.abs((line[k].x - p.x) * dy - (line[k].y - p.y) * dx) / l;
      if (d > worst) {
        worst = d;
        far = k;
      }
    }
    if (far < 0) continue;
    keep[far] = 1;
    stack.push([a, far], [far, b]);
  }
  return line.filter((_, k) => keep[k]);
}

