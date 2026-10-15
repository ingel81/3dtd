/**
 * The water of an OSM world (docs/OSM_WORLD_PLAN.md, Zuordnung: Wasser),
 * carved into the ground before the roads level it:
 *
 * - **Coast:** `natural=coastline` closed into the sea along the map's edge
 *   (land on the left of the line, as OSM draws it); the sea is the main
 *   water at the sea level, and the map's zero moves onto it.
 * - **Rivers as areas** (`water=river`, `waterway=riverbank`): one mask over
 *   all of them; a river falling more than a little over the map is cut into
 *   sections with a level each. The largest section is the main water
 *   (without a sea), the others bodies of their own.
 * - **Lakes, ponds, basins, pools:** a body each on the level of its water
 *   in the heights, the bed dug below it; under 50 m² left out, past 64
 *   bodies the smallest fall.
 * - **Wetlands:** a swamp body with pools where noise opens them.
 * - **Waterways** (rivers, canals, streams, drains, ditches without a
 *   culvert): river lines (`terrain.rivers`) on the real course, the surface
 *   from the banks (never rising downstream), a channel dug and banks shaped.
 *
 * Every body's bed lies under its level, the land at its rim over it, so
 * the shore is where the mask ends. The beds and shores are painted later
 * (`paintWater`, after the land and before the roads).
 */
import { bankLevels, riverPoints } from '../../../editor/ops/landscape/river';
import { resample } from '../../../editor/ops/landscape/lines';
import { hashCell, smooth } from '../../../editor/ops/landscape/landscape-noise';
import { MAX_LAYERS, readWeights, writeWeights } from '../../../editor/ops/paint-ops';
import { polylineLength } from '../../../editor/ops/path-graph';
import { BODY_COLORS } from '../../../editor/ops/water-ops';
import { fitSplatMaps, type MapPaths, type MapPoint, type MapRiver, type MapTerrain, type MapWater, type MapWaterKind } from '../../custom-map/map-document';
import { MAX_WATER_BODIES } from '../../custom-map/map-file';
import { landClassOf, waterClassOf, waterwayOf, type WaterClass } from '../land-tags';
import { ringArea, runs, type OsmArea, type OsmFeatures } from '../osm-parse';
import { distanceField, fillRings, sampleGrid, stampLine, type RasterGrid } from './raster';

/** Water areas smaller than this are left out, m² */
export const MIN_WATER_AREA = 50;
/** A river area falling more than this over its course is cut into sections, metres */
const SECTION_FALL = 0.75;
/** Metres along a river's axis per bin its level is read in */
const SECTION_BIN = 60;
/** Metres the land at a body's rim stands over its level */
const RIM_OVER = 0.2;
/** Metres from a body's edge the rim is raised over its level, then fading into the land */
const RIM_WIDTH = 2;
const RIM_FADE = 3;
/** Shortest stretch of a waterway kept outside the water areas, metres */
const MIN_RIVER_RUN = 12;
/** Metres between the points a waterway's surface is read at */
const RIVER_STEP = 4;
/** Wetlands smaller than this get no pools, m² */
const MIN_WETLAND_POOLS = 400;

/** Ground materials of the water's beds and shores, by role */
export const WATER_MATERIALS = { bed: 'riverbed', bank: 'riverbed', beach: 'sand-coast' } as const;
export type WaterPaintRole = keyof typeof WATER_MATERIALS;

export interface WaterReport {
  coast: boolean;
  /** Main water: 'sea', 'river' or none */
  main: 'sea' | 'river' | null;
  riverSections: number;
  lakes: number;
  pools: number;
  wetlands: number;
  /** Bodies left out past the limit of MAX_WATER_BODIES, and areas under MIN_WATER_AREA */
  dropped: number;
  tooSmall: number;
  /** Waterway lines drawn, and their kilometres */
  rivers: number;
  riverKm: number;
  /** Map metres the ground moved up so the map's zero is the sea level (coast only) */
  zeroShift: number;
}

/** What the water stage leaves for the later stages: the shores to paint, and where the water is */
export interface WaterResult {
  report: WaterReport;
  /** Per height sample, 0..1 per role: what paintWater lays */
  paint: Record<WaterPaintRole, Float32Array>;
  /** Per height sample: 1 in a body or a river's channel (plants keep out) */
  wet: Uint8Array;
  /** Per height sample: 1 in the sea */
  sea: Uint8Array;
  /** Per height sample: 1 under a road or path (not a bridge) */
  roads: Uint8Array;
  /** Per height sample: the bed of a river's channel, NaN outside one (cut again once the roads are levelled) */
  channel: Float32Array;
  warnings: string[];
}

interface Body {
  kind: MapWaterKind;
  cls: WaterClass | 'sea' | 'wetland';
  level: number;
  cells: Int32Array;
  /** Square metres */
  area: number;
  /** Bed depth under the level at most, metres */
  depth: number;
}

/** Metres past a road's half width that count as the road: a waterway stops there (a culvert the data left out) */
const ROAD_VERGE = 0.5;

/**
 * Carves the water of `features` into `terrain` and sets its bodies and
 * rivers. `zeroM` is the sea height of the map's zero (fillOsmTerrain): a
 * coast moves the ground so the sea lies at 0. A waterway stops at the
 * roads of `paths` it crosses without a bridge.
 */
export function carveWater(terrain: MapTerrain, features: OsmFeatures, paths: MapPaths, zeroM: number): WaterResult {
  const g = terrain.grid;
  const grid = sampleGrid(terrain.width, g.cellSize);
  const n = grid.n;
  const h = g.heights;
  const cellArea = g.cellSize * g.cellSize;
  const report: WaterReport = { coast: false, main: null, riverSections: 0, lakes: 0, pools: 0, wetlands: 0, dropped: 0, tooSmall: 0, rivers: 0, riverKm: 0, zeroShift: 0 };
  const warnings: string[] = [];
  const paint: Record<WaterPaintRole, Float32Array> = { bed: new Float32Array(n * n), bank: new Float32Array(n * n), beach: new Float32Array(n * n) };
  const wet = new Uint8Array(n * n);
  const sea = new Uint8Array(n * n);
  const roads = roadMask(paths, grid);

  // The sea first: it may move the map's zero, and the rest is read on the moved ground
  const coast = coastMask(features, grid);
  let seaBody: Body | null = null;
  if (coast) {
    report.coast = true;
    report.zeroShift = zeroM;
    if (zeroM !== 0) for (let k = 0; k < h.length; k++) h[k] += zeroM;
    const cells: number[] = [];
    let high = 0;
    for (let k = 0; k < coast.length; k++) {
      if (!coast[k]) continue;
      cells.push(k);
      if (h[k] > 3) high++;
    }
    // A sea mostly over land is a coastline the answer cut wrongly: no sea then
    if (cells.length && high / cells.length < 0.5) {
      seaBody = { kind: 'sea', cls: 'sea', level: 0, cells: Int32Array.from(cells), area: cells.length * cellArea, depth: 8 };
      for (const k of cells) sea[k] = 1;
    } else if (cells.length) warnings.push('water: the coastline did not close into a sea that matches the heights; no sea');
  }

  // Areas: rivers into one mask, lakes and pools each, wetlands each
  const riverMask = new Uint8Array(n * n);
  const standing: Body[] = [];
  const wetlands: Body[] = [];
  for (const a of features.areas) {
    const cls = waterClassOf(a.tags);
    const wetland = !cls && landClassOf(a.tags) === 'wetland';
    if (!cls && !wetland) continue;
    if (a.area < MIN_WATER_AREA) {
      report.tooSmall++;
      continue;
    }
    if (wetland && a.area < MIN_WETLAND_POOLS) continue;
    const cells = areaCells(a, grid, sea);
    if (cls === 'river') {
      for (const k of cells) riverMask[k] = 1;
      continue;
    }
    if (cells.length < 3) {
      report.tooSmall++;
      continue;
    }
    const level = waterLevel(h, cells, n);
    if (wetland) wetlands.push({ kind: 'swamp', cls: 'wetland', level, cells, area: a.area, depth: 0.5 });
    else standing.push({ kind: 'water', cls: cls!, level, cells, area: a.area, depth: cls === 'pool' ? 1.4 : Math.min(4, 0.8 + Math.sqrt(a.area) / 40) });
  }
  const sections = riverSections(riverMask, h, grid, cellArea);

  // Main water: the sea, else the largest river section; then the bodies by size within the limit
  sections.sort((p, q) => q.area - p.area);
  const main = seaBody ?? sections.shift() ?? null;
  report.main = seaBody ? 'sea' : main ? 'river' : null;
  if (main && !seaBody) report.riverSections = 1;
  const rest = [...sections, ...standing, ...wetlands].sort((p, q) => q.area - p.area);
  const kept = rest.slice(0, MAX_WATER_BODIES);
  report.dropped = rest.length - kept.length;
  for (const b of kept) {
    if (b.cls === 'river') report.riverSections++;
    else if (b.cls === 'lake') report.lakes++;
    else if (b.cls === 'pool') report.pools++;
    else if (b.cls === 'wetland') report.wetlands++;
  }

  // Carve: the bodies own their cells, the larger first (a pond in a river's mask stays the river's)
  const owner = new Int16Array(n * n).fill(-1);
  const all = main ? [main, ...kept] : kept;
  all.forEach((b, index) => {
    let free = 0;
    for (const k of b.cells) if (owner[k] < 0) b.cells[free++] = ((owner[k] = index), k);
    b.cells = b.cells.slice(0, free);
  });
  const noiseSeed = Math.round(features.frame.lat * 1000 + features.frame.lon * 7);
  all.forEach((b, index) => (b.cells = carveBody(terrain, grid, b, index, owner, paint, noiseSeed)));
  const masks = all.map((b) => {
    const mask = new Uint8Array(n * n);
    for (const k of b.cells) {
      mask[k] = 255;
      wet[k] = 1;
    }
    const body: MapWater = { level: round2(b.level), mask, color: BODY_COLORS[b.kind] };
    if (b.kind !== 'water') body.kind = b.kind;
    return body;
  });
  terrain.water = main ? masks[0] : null;
  const bodies = main ? masks.slice(1) : masks;
  if (bodies.length) terrain.waterBodies = bodies;
  else delete terrain.waterBodies;

  const channel = new Float32Array(n * n).fill(NaN);
  const rivers = carveRivers(terrain, grid, features, owner, roads, paint, wet, channel);
  report.rivers = rivers.length;
  report.riverKm = round2(rivers.reduce((s, r) => s + polylineLength(r.points), 0) / 1000);
  if (rivers.length) terrain.rivers = rivers;
  else delete terrain.rivers;
  return { report, paint, wet, sea, roads, channel, warnings };
}

/** The samples under the roads and paths (not bridges) and their verges */
function roadMask(paths: MapPaths, grid: RasterGrid): Uint8Array {
  const mask = new Uint8Array(grid.n * grid.n);
  const nodes = new Map(paths.nodes.map((p) => [p.id, p]));
  for (const e of paths.edges) {
    if (e.kind === 'bridge') continue;
    const a = nodes.get(e.a);
    const b = nodes.get(e.b);
    if (!a || !b) continue;
    stampLine([a, ...(e.via ?? []), b], grid, e.width / 2 + ROAD_VERGE, (i, j) => (mask[j * grid.n + i] = 1));
  }
  return mask;
}

/**
 * After the roads are levelled: a road through a body's water is a dam (its
 * samples leave the mask and stand over the level, as the plan has roads
 * over water without a bridge), a shore a road's shoulder lifted out of the
 * water is land, the land beside every body stands over its
 * level again where the levelling lowered it, so no sheet ends in the air,
 * and the rivers' channels are cut again where a road's shoulder filled them
 */
export function settleWater(terrain: MapTerrain, water: WaterResult): void {
  const g = terrain.grid;
  const n = g.columns;
  const h = g.heights;
  const bodies = [terrain.water, ...(terrain.waterBodies ?? [])].filter((b): b is MapWater => !!b);
  // Which body holds each sample (they do not overlap)
  const own = new Int8Array(h.length).fill(-1);
  bodies.forEach((b, index) => {
    for (let k = 0; k < h.length; k++) {
      if (!b.mask[k]) continue;
      // A road's shoulder may have lifted the shore out of the water: land then
      if (!water.roads[k] && h[k] < b.level) {
        own[k] = index;
        continue;
      }
      b.mask[k] = 0;
      water.wet[k] = 0;
      if (h[k] < b.level + RIM_OVER) h[k] = b.level + RIM_OVER;
    }
  });
  for (let k = 0; k < h.length; k++) {
    const bed = water.channel[k];
    if (bed === bed && !water.roads[k] && h[k] > bed) h[k] = bed;
  }
  for (let k = 0; k < h.length; k++) {
    if (own[k] < 0) continue;
    const rim = bodies[own[k]].level + RIM_OVER;
    const i = k % n;
    for (const q of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) {
      if (q >= 0 && q < h.length && own[q] < 0 && h[q] < rim) h[q] = rim;
    }
  }
}

/** The height samples inside an area (outside the sea) */
function areaCells(a: OsmArea, grid: RasterGrid, sea: Uint8Array): Int32Array {
  const out: number[] = [];
  fillRings([...a.outer, ...a.inner], grid, (i, j) => {
    const k = j * grid.n + i;
    if (!sea[k]) out.push(k);
  });
  return Int32Array.from(out);
}

/**
 * The level of a body's water in the heights: survey data holds a water
 * surface flat at its level, the rim blurred up into the land, so a low
 * share of the samples away from the rim
 */
function waterLevel(h: Float32Array, cells: Int32Array, n: number): number {
  const set = new Set(cells);
  const inner: number[] = [];
  for (const k of cells) {
    if (set.has(k - 1) && set.has(k + 1) && set.has(k - n) && set.has(k + n) && set.has(k - 2) && set.has(k + 2) && set.has(k - 2 * n) && set.has(k + 2 * n)) inner.push(h[k]);
  }
  const values = inner.length >= 4 ? inner : Array.from(cells, (k) => h[k]);
  return quantile(values, 0.3);
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/**
 * The river mask in connected parts, each cut across its main axis where
 * its level has fallen SECTION_FALL since the section began
 */
function riverSections(mask: Uint8Array, h: Float32Array, grid: RasterGrid, cellArea: number): Body[] {
  const n = grid.n;
  const seen = new Uint8Array(n * n);
  const out: Body[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const cells: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      cells.push(k);
      const i = k % n;
      for (const m of [i > 0 ? k - 1 : -1, i < n - 1 ? k + 1 : -1, k - n, k + n]) {
        if (m >= 0 && m < mask.length && mask[m] && !seen[m]) {
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
    if (cells.length * cellArea < MIN_WATER_AREA) continue;
    // The main axis: the direction of most spread of the cells
    let mx = 0;
    let my = 0;
    for (const k of cells) {
      mx += k % n;
      my += Math.floor(k / n);
    }
    mx /= cells.length;
    my /= cells.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const k of cells) {
      const dx = (k % n) - mx;
      const dy = Math.floor(k / n) - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    const along = cells.map((k) => ((k % n) * ax + Math.floor(k / n) * ay) * grid.step);
    let lo = Infinity;
    for (const s of along) lo = Math.min(lo, s);
    const bins = new Map<number, number[]>();
    cells.forEach((k, c) => {
      const b = Math.floor((along[c] - lo) / SECTION_BIN);
      let list = bins.get(b);
      if (!list) bins.set(b, (list = []));
      list.push(c);
    });
    const order = [...bins.keys()].sort((a, b) => a - b);
    const binLevel = new Map(order.map((b) => [b, waterLevel(h, Int32Array.from(bins.get(b)!, (c) => cells[c]), n)]));
    // Sections: a new one where the level has moved SECTION_FALL from the one the section began with
    let current: number[] = [];
    let startLevel = binLevel.get(order[0])!;
    const flush = () => {
      if (!current.length) return;
      const sectionCells = Int32Array.from(current, (c) => cells[c]);
      out.push({ kind: 'water', cls: 'river', level: waterLevel(h, sectionCells, n), cells: sectionCells, area: current.length * cellArea, depth: 2.5 });
      current = [];
    };
    for (const b of order) {
      const level = binLevel.get(b)!;
      if (Math.abs(level - startLevel) > SECTION_FALL) {
        flush();
        startLevel = level;
      }
      current.push(...bins.get(b)!);
    }
    flush();
  }
  return out;
}

/**
 * Digs a body's bed under its level (deeper away from the shore) and lifts
 * the land at its rim over it, without touching the cells of other bodies;
 * a wetland keeps only its pools (noise) as water. Returns the body's wet
 * cells.
 */
function carveBody(
  terrain: MapTerrain,
  grid: RasterGrid,
  b: Body,
  index: number,
  owner: Int16Array,
  paint: Record<WaterPaintRole, Float32Array>,
  seed: number,
): Int32Array {
  const n = grid.n;
  const h = terrain.grid.heights;
  if (!b.cells.length) return b.cells;
  // A local window around the body with room for its rim
  const pad = Math.ceil((RIM_WIDTH + RIM_FADE) / grid.step) + 1;
  let i0 = n;
  let i1 = 0;
  let j0 = n;
  let j1 = 0;
  for (const k of b.cells) {
    const i = k % n;
    const j = (k - i) / n;
    if (i < i0) i0 = i;
    if (i > i1) i1 = i;
    if (j < j0) j0 = j;
    if (j > j1) j1 = j;
  }
  i0 = Math.max(0, i0 - pad);
  j0 = Math.max(0, j0 - pad);
  i1 = Math.min(n - 1, i1 + pad);
  j1 = Math.min(n - 1, j1 + pad);
  const w = i1 - i0 + 1;
  const d = j1 - j0 + 1;
  const side = Math.max(w, d);
  const local = new Uint8Array(side * side);
  const toLocal = (k: number) => {
    const i = k % n;
    return ((k - i) / n - j0) * side + (i - i0);
  };
  let cells = b.cells;
  if (b.cls === 'wetland') {
    // Pools where a soft noise is low, away from the wetland's edge
    const inside = new Uint8Array(side * side);
    for (const k of cells) inside[toLocal(k)] = 1;
    const edge = distanceField(inside, side, grid.step, 10);
    const kept: number[] = [];
    for (const k of cells) {
      const i = k % n;
      const j = (k - i) / n;
      const x = grid.origin + i * grid.step;
      const y = grid.origin + j * grid.step;
      if (edge[toLocal(k)] < 3 || valueNoise(x, y, 14, seed) > 0.32 || h[k] > b.level + 0.6) continue;
      kept.push(k);
    }
    for (const k of cells) if (owner[k] === index) owner[k] = -1;
    cells = Int32Array.from(kept);
    for (const k of cells) owner[k] = index;
  }
  for (const k of cells) local[toLocal(k)] = 1;
  const shore = distanceField(local, side, grid.step, 40);
  const dry = distanceField(local, side, grid.step, RIM_WIDTH + RIM_FADE, false);
  const sea = b.kind === 'sea';
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      const l = (j - j0) * side + (i - i0);
      if (local[l]) {
        // The bed: a shelf at the shore, deeper inward
        const dIn = shore[l];
        const slope = sea ? 0.08 : b.cls === 'pool' ? 1 : b.cls === 'wetland' ? 0.25 : 0.3;
        const bed = b.level - 0.25 - Math.min(b.depth, dIn * slope);
        if (h[k] > bed) h[k] = bed;
        if (b.cls !== 'pool') paint[sea ? 'beach' : 'bed'][k] = 1;
        continue;
      }
      if (owner[k] >= 0) continue;
      const dOut = dry[l];
      if (dOut >= RIM_WIDTH + RIM_FADE) continue;
      // The rim: over the level, fading into the land
      const rim = b.level + RIM_OVER - Math.max(0, dOut - RIM_WIDTH) * 0.6;
      if (h[k] < rim) h[k] = h[k] + (rim - h[k]) * (dOut <= RIM_WIDTH ? 1 : 1 - smooth(RIM_WIDTH, RIM_WIDTH + RIM_FADE, dOut));
      const role: WaterPaintRole = sea ? 'beach' : 'bank';
      if (b.cls !== 'pool' && b.cls !== 'wetland') paint[role][k] = Math.max(paint[role][k], 1 - smooth(0, RIM_WIDTH + RIM_FADE, dOut));
    }
  }
  if (sea) {
    // A beach band past the rim where the land stays low
    const beach = distanceField(local, side, grid.step, 16, false);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const l = (j - j0) * side + (i - i0);
        const k = j * n + i;
        if (local[l] || h[k] > 3) continue;
        paint.beach[k] = Math.max(paint.beach[k], 1 - smooth(6, 16, beach[l]));
      }
    }
  }
  return cells;
}

/** Smooth value noise in [0, 1] on a lattice of `wave` metres */
function valueNoise(x: number, y: number, wave: number, seed: number): number {
  const fx = x / wave;
  const fy = y / wave;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const u = smooth(0, 1, fx - i);
  const v = smooth(0, 1, fy - j);
  const a = hashCell(i, j, seed);
  const b = hashCell(i + 1, j, seed);
  const c = hashCell(i, j + 1, seed);
  const e = hashCell(i + 1, j + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
}

/**
 * The waterways as river lines, outside the water areas (a river with its
 * surface mapped runs in it already), each run on its own: the surface from
 * the banks, falling downstream (the way's direction, as OSM draws it; a way
 * drawn uphill is turned round), the channel dug and the banks shaped. A
 * sample takes the nearest waterway's shape.
 */
function carveRivers(
  terrain: MapTerrain,
  grid: RasterGrid,
  features: OsmFeatures,
  owner: Int16Array,
  roads: Uint8Array,
  paint: Record<WaterPaintRole, Float32Array>,
  wet: Uint8Array,
  channel: Float32Array,
): MapRiver[] {
  const n = grid.n;
  const h = terrain.grid.heights;
  const lim = features.half - 1;
  const land = (x: number, y: number) => {
    const i = Math.min(n - 1, Math.max(0, Math.round((x - grid.origin) / grid.step)));
    const j = Math.min(n - 1, Math.max(0, Math.round((y - grid.origin) / grid.step)));
    return h[j * n + i];
  };
  /** 1 in a body's water, 2 on a road, 0 elsewhere */
  const blocked = (p: MapPoint) => {
    const i = Math.round((p.x - grid.origin) / grid.step);
    const j = Math.round((p.y - grid.origin) / grid.step);
    if (i < 0 || j < 0 || i >= n || j >= n) return 0;
    return owner[j * n + i] >= 0 ? 1 : roads[j * n + i] ? 2 : 0;
  };
  const courses: { line: MapPoint[]; surface: number[]; along: number[]; width: number; depth: number; bank: number }[] = [];
  for (const way of features.ways) {
    const type = waterwayOf(way.tags);
    if (!type) continue;
    for (const run of runs(way.points)) {
      for (const piece of clipLine(run, lim)) {
        // Dry runs outside the bodies and off the roads, each reaching one step into the water it meets
        const pts = resample(piece, RIVER_STEP / 2);
        const dryRuns: MapPoint[][] = [];
        let current: MapPoint[] = [];
        const flush = () => {
          if (current.length >= 2 && polylineLength(current) >= MIN_RIVER_RUN) dryRuns.push(current);
          current = [];
        };
        for (let k = 0; k < pts.length; k++) {
          const stop = blocked(pts[k]);
          if (stop) {
            if (current.length && stop === 1) current.push(pts[k]);
            flush();
            continue;
          }
          if (!current.length && k > 0 && blocked(pts[k - 1]) === 1) current.push(pts[k - 1]);
          current.push(pts[k]);
        }
        flush();
        for (const raw of dryRuns) {
          let line = resample(raw, RIVER_STEP);
          if (line.length < 2) continue;
          if (land(line[0].x, line[0].y) < land(line[line.length - 1].x, line[line.length - 1].y) - 1) line = line.reverse();
          const half = type.width / 2;
          const surface = bankLevels(land, line, () => half, type.bank + 1);
          const along = [0];
          for (let k = 1; k < line.length; k++) along.push(along[k - 1] + Math.hypot(line[k].x - line[k - 1].x, line[k].y - line[k - 1].y));
          courses.push({ line, surface, along, width: type.width, depth: type.depth, bank: type.bank });
        }
      }
    }
  }
  if (!courses.length) return [];

  // The nearest course per sample: its distance, half width, bank, depth and surface there
  const best = new Float32Array(n * n).fill(Infinity);
  const level = new Float32Array(n * n);
  const which = new Int32Array(n * n).fill(-1);
  // The channel is dug at least a sample wide either side: the grid would miss a narrower ditch's bed
  const cut = (c: { width: number }) => Math.max(c.width / 2, grid.step);
  courses.forEach((c, index) => {
    const half = cut(c);
    stampLine(c.line, grid, half + c.bank, (i, j, dist, s, t) => {
      const k = j * n + i;
      if (owner[k] >= 0) return;
      // The share of the distance to the bank's outer edge, so a wide river's bank wins over a ditch beside it
      const rel = dist / (half + c.bank);
      if (rel >= best[k]) return;
      best[k] = rel;
      which[k] = index;
      level[k] = c.surface[s] + (c.surface[s + 1] - c.surface[s]) * t;
    });
  });
  const base = h.slice();
  for (let k = 0; k < best.length; k++) {
    const index = which[k];
    if (index < 0) continue;
    const c = courses[index];
    const half = cut(c);
    const dist = best[k] * (half + c.bank);
    const surface = level[k];
    if (dist < half) {
      const deep = Math.pow(1 - smooth(0.2, 1, dist / half), 1.3);
      h[k] = Math.min(base[k], surface - 0.15 - c.depth * deep);
      channel[k] = h[k];
      paint.bed[k] = Math.max(paint.bed[k], 1);
      wet[k] = 1;
    } else {
      // The bank: from just over the surface into the land
      const shore = surface + 0.25;
      const s = smooth(0, 1, (dist - half) / (c.bank * 0.7));
      h[k] = shore + (base[k] - shore) * s;
      paint.bank[k] = Math.max(paint.bank[k], 1 - smooth(0.3, 1, (dist - half) / c.bank));
    }
  }
  const round = (v: number) => round2(v);
  return courses.map((c, index) => ({
    id: `river-${index + 1}`,
    kind: 'water',
    points: riverPoints(c.line, c.along, c.surface).map(({ p, s }) => {
      let k = 1;
      while (k < c.along.length - 1 && c.along[k] < s) k++;
      const f = Math.min(1, Math.max(0, (s - c.along[k - 1]) / Math.max(1e-6, c.along[k] - c.along[k - 1])));
      return { x: round(p.x), y: round(p.y), width: round(c.width), height: round(c.surface[k - 1] + (c.surface[k] - c.surface[k - 1]) * f) };
    }),
  }));
}

/** The runs of a line inside the square |x|, |y| <= lim, each cut where it crosses the edge */
export function clipLine(line: readonly MapPoint[], lim: number): MapPoint[][] {
  const out: MapPoint[][] = [];
  let run: MapPoint[] = [];
  const inside = (p: MapPoint) => Math.abs(p.x) <= lim && Math.abs(p.y) <= lim;
  for (let k = 0; k < line.length; k++) {
    const p = line[k];
    if (k === 0) {
      if (inside(p)) run.push(p);
      continue;
    }
    const q = line[k - 1];
    const seg = clipSegment(q, p, lim);
    if (!seg) continue;
    const at = (t: number): MapPoint => ({ x: q.x + (p.x - q.x) * t, y: q.y + (p.y - q.y) * t });
    if (seg[0] > 0) {
      if (run.length >= 2) out.push(run);
      run = [at(seg[0])];
    }
    if (seg[1] < 1) {
      run.push(at(seg[1]));
      if (run.length >= 2) out.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length >= 2) out.push(run);
  return out;
}

/** The part of segment a-b inside the square, as parameters along it; null when none (Liang-Barsky) */
function clipSegment(a: MapPoint, b: MapPoint, lim: number): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x + lim],
    [dx, lim - a.x],
    [-dy, a.y + lim],
    [dy, lim - a.y],
  ] as const) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

/**
 * The sea's samples from the coastlines, null without any: the lines joined
 * end to end, cut to the map; each piece that crosses the map closed along
 * the edge clockwise (OSM draws the land on the left, so the water lies to
 * the right) to the next piece's start; closed rings inside (islands) cut
 * their holes. Pieces that end inside the map (the answer cut them) are run
 * straight on to the edge.
 */
export function coastMask(features: OsmFeatures, grid: RasterGrid): Uint8Array | null {
  const half = features.half;
  const chains: MapPoint[][] = [];
  for (const w of features.ways) if (w.tags['natural'] === 'coastline') chains.push(...runs(w.points));
  if (!chains.length) return null;
  const joined = joinChains(chains);
  const pieces: MapPoint[][] = [];
  const islands: MapPoint[][] = [];
  for (const chain of joined) {
    const closed = chain.length >= 4 && Math.hypot(chain[0].x - chain[chain.length - 1].x, chain[0].y - chain[chain.length - 1].y) < 0.01;
    if (closed && chain.every((p) => Math.abs(p.x) < half && Math.abs(p.y) < half)) {
      islands.push(chain.slice(0, -1));
      continue;
    }
    for (const piece of clipLine(chain, half)) pieces.push(piece.map((p) => ({ ...p })));
  }
  // Ends inside the map run on to the nearest edge
  for (const p of pieces) {
    p[0] = toEdge(p[0], half);
    p[p.length - 1] = toEdge(p[p.length - 1], half);
  }
  const rings: MapPoint[][] = [];
  if (!pieces.length) {
    // Only islands (or lakes drawn as coast): the sea is all around them, if they turn the way islands do
    if (!islands.some((r) => ringArea(r) > 0)) return null;
    rings.push([{ x: -half, y: half }, { x: half, y: half }, { x: half, y: -half }, { x: -half, y: -half }]);
  } else {
    const used = new Array(pieces.length).fill(false);
    for (let first = 0; first < pieces.length; first++) {
      if (used[first]) continue;
      const ring: MapPoint[] = [];
      let at = first;
      for (let guard = 0; guard <= pieces.length; guard++) {
        used[at] = true;
        ring.push(...pieces[at]);
        const exit = perimeter(pieces[at][pieces[at].length - 1], half);
        // The next start clockwise from the exit
        let next = -1;
        let gap = Infinity;
        pieces.forEach((p, k) => {
          const d = (perimeter(p[0], half) - exit + 8 * half) % (8 * half);
          if (d < gap && (!used[k] || k === first)) {
            gap = d;
            next = k;
          }
        });
        ring.push(...cornersBetween(exit, exit + gap, half));
        if (next === first || next < 0) break;
        at = next;
      }
      rings.push(ring);
    }
  }
  rings.push(...islands);
  const mask = new Uint8Array(grid.n * grid.n);
  fillRings(rings, grid, (i, j) => (mask[j * grid.n + i] = 1));
  return mask;
}

/** Coastline ways put end to end where one starts where another ends */
function joinChains(chains: MapPoint[][]): MapPoint[][] {
  const key = (p: MapPoint) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const open = chains.map((c) => [...c]);
  const out: MapPoint[][] = [];
  while (open.length) {
    let chain = open.pop()!;
    for (let grew = true; grew; ) {
      grew = false;
      const end = key(chain[chain.length - 1]);
      const start = key(chain[0]);
      for (let k = 0; k < open.length; k++) {
        if (key(open[k][0]) === end) {
          chain = chain.concat(open.splice(k, 1)[0].slice(1));
          grew = true;
          break;
        }
        if (key(open[k][open[k].length - 1]) === start) {
          chain = open.splice(k, 1)[0].concat(chain.slice(1));
          grew = true;
          break;
        }
      }
    }
    out.push(chain);
  }
  return out;
}

/** A point moved straight onto the nearest edge of the square, if it is inside */
function toEdge(p: MapPoint, half: number): MapPoint {
  const dx = half - Math.abs(p.x);
  const dy = half - Math.abs(p.y);
  if (dx <= 0.01 || dy <= 0.01) return p;
  return dx < dy ? { x: Math.sign(p.x || 1) * half, y: p.y } : { x: p.x, y: Math.sign(p.y || 1) * half };
}

/** Clockwise position along the square's edge from its north-west corner, 0 to 8 half */
function perimeter(p: MapPoint, half: number): number {
  const e = 0.02;
  if (p.y >= half - e) return p.x + half;
  if (p.x >= half - e) return 2 * half + (half - p.y);
  if (p.y <= -half + e) return 4 * half + (half - p.x);
  return 6 * half + (p.y + half);
}

/** The corners of the square passed walking clockwise from edge position `from` to `to` */
function cornersBetween(from: number, to: number, half: number): MapPoint[] {
  const corners: [number, MapPoint][] = [
    [2 * half, { x: half, y: half }],
    [4 * half, { x: half, y: -half }],
    [6 * half, { x: -half, y: -half }],
    [8 * half, { x: -half, y: half }],
  ];
  const out: MapPoint[] = [];
  for (let lap = 0; lap < 2; lap++) {
    for (const [s, p] of corners) {
      const at = s + lap * 8 * half;
      if (at > from && at < to) out.push(p);
    }
  }
  return out;
}

/**
 * The water's beds and shores painted into the ground: under the water
 * riverbed, at the rims pebbles, by the sea sand; each over what lies there.
 * Adds the materials to the layer list as needed (room kept by the ground
 * stage).
 */
export function paintWater(terrain: MapTerrain, water: WaterResult): void {
  const res = terrain.splat.resolution;
  const g = terrain.grid;
  const n = g.columns;
  const roles = (Object.keys(WATER_MATERIALS) as WaterPaintRole[]).filter((r) => water.paint[r].some((v) => v > 0));
  const layer: Partial<Record<WaterPaintRole, number>> = {};
  for (const r of roles) {
    const material = WATER_MATERIALS[r];
    let k = terrain.layers.findIndex((l) => l.material === material);
    if (k < 0 && terrain.layers.length < MAX_LAYERS) {
      terrain.layers.push({ material });
      k = terrain.layers.length - 1;
    }
    if (k >= 0) layer[r] = k;
  }
  fitSplatMaps(terrain);
  const w = new Float32Array(MAX_LAYERS);
  const scale = (n - 1) / res;
  for (let v = 0; v < res; v++) {
    const fy = (v + 0.5) * scale;
    const j = Math.min(n - 2, Math.floor(fy));
    const ty = fy - j;
    for (let u = 0; u < res; u++) {
      const fx = (u + 0.5) * scale;
      const i = Math.min(n - 2, Math.floor(fx));
      const tx = fx - i;
      let touched = false;
      for (const r of roles) {
        const L = layer[r];
        if (L === undefined) continue;
        const p = water.paint[r];
        const k = j * n + i;
        const a = (p[k] * (1 - tx) + p[k + 1] * tx) * (1 - ty) + (p[k + n] * (1 - tx) + p[k + n + 1] * tx) * ty;
        if (a <= 0.01) continue;
        if (!touched) readWeights(terrain, v * res + u, w);
        touched = true;
        for (let l = 0; l < MAX_LAYERS; l++) w[l] *= 1 - a;
        w[L] += 255 * a;
      }
      if (touched) writeWeights(terrain, v * res + u, w);
    }
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
