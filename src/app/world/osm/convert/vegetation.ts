/**
 * The plants of an OSM world (docs/OSM_WORLD_PLAN.md, Zuordnung: Pflanzen):
 * forests, scrub and heath, parks, orchards and vineyards in rows, reeds on
 * the shores, single trees and tree rows from their nodes and lines.
 *
 * Each kind of plant of a land class has its density per hectare; candidates
 * come from a jittered grid per kind (one spot and one roll per cell, decided
 * by the cell, so the same data gives the same forest). A forest grows denser
 * at its edge (fields, clearings, the roads through it), and every kind grows
 * thinner far from the enemies' routes, where the camera rarely is. Plants
 * keep off roads, water, buildings and the HQ and spawns.
 *
 * The objects' scene cost (scene-cost.ts) is held to a share of the map's
 * budget, the rest left for buildings and furniture; past it the candidates
 * go by priority (single trees and rows first, then by nearness to a route
 * and their roll), and so does a cap on their number.
 */
import { hashCell } from '../../../editor/ops/landscape/landscape-noise';
import { resample } from '../../../editor/ops/landscape/lines';
import { ObjectIds } from '../../../editor/ops/object-ops';
import { spawnRoutes } from '../../../editor/ops/path-graph';
import type { CustomMapDocument, MapObject, MapPoint } from '../../custom-map/map-document';
import { objectCost, SCENE_BUDGET, type CostEntry } from '../../custom-map/render/objects/scene-cost';
import type { LandClass } from '../land-tags';
import { runs, type OsmFeatures } from '../osm-parse';
import { LAND_CLASSES } from './ground';
import { distanceField, fillRings, sampleGrid, stampLine, type RasterGrid } from './raster';
import type { WaterResult } from './water';

/** Share of the scene budget the plants may take; buildings and furniture get the rest */
export const PLANT_BUDGET_SHARE = 0.5;
/** Most plants an OSM world gets: the file and the renderer's work grow with the count */
export const PLANT_LIMIT = 60_000;
/** Share of the plants' budget rows of a crop may take: a vine row costs three trees, and a wine village would spend it all on vines */
export const ROW_BUDGET_SHARE = 0.4;

/** How one kind of plant grows on a land class */
interface PlantKind {
  /** Candidates, one picked per spot */
  assets: readonly string[];
  /** Plants per hectare inside the area */
  perHa: number;
  /** Plants per hectare at the area's edge, fading to perHa over `band` metres */
  edgePerHa?: number;
  band?: number;
  scale: readonly [number, number];
  /** Metres it keeps off a road's edge */
  clear: number;
}

/** Rows of a crop: across the slope (vines) or along the area (orchards) */
interface RowKind {
  asset: string;
  /** Metres between rows and between plants in a row */
  across: number;
  along: number;
  /** Rows run down the slope (vines on a hillside) instead of along the area's longest side */
  downhill?: boolean;
  /** The model is a length of row along its x axis */
  segment?: boolean;
  scale: readonly [number, number];
}

const BROADLEAF = ['tree-oak', 'tree-maple', 'tree-birch', 'tree-oak-young'];
const CONIFERS = ['tree-fir', 'tree-pine', 'tree-fir-young'];
const BUSHES = ['bush', 'shrub', 'shrub-wide'];

/** What grows on each class (classes without an entry grow nothing but their ground) */
const PLANTS: Partial<Record<LandClass, readonly PlantKind[]>> = {
  forest: [
    { assets: BROADLEAF, perHa: 100, edgePerHa: 200, band: 18, scale: [0.85, 1.3], clear: 2 },
    { assets: ['tree-fir', 'tree-pine'], perHa: 12, scale: [0.85, 1.2], clear: 2 },
    { assets: BUSHES, perHa: 6, edgePerHa: 120, band: 8, scale: [0.8, 1.4], clear: 1 },
    { assets: ['fern'], perHa: 30, scale: [0.8, 1.3], clear: 1 },
    { assets: ['stump', 'log', 'stump-mossy', 'log-fallen'], perHa: 3, scale: [0.8, 1.2], clear: 1 },
  ],
  conifers: [
    { assets: CONIFERS, perHa: 120, edgePerHa: 220, band: 18, scale: [0.85, 1.25], clear: 2 },
    { assets: BUSHES, perHa: 4, edgePerHa: 80, band: 8, scale: [0.8, 1.3], clear: 1 },
    { assets: ['fern'], perHa: 20, scale: [0.8, 1.2], clear: 1 },
  ],
  scrub: [
    { assets: BUSHES, perHa: 140, scale: [0.8, 1.5], clear: 1 },
    { assets: ['tree-oak-young', 'tree-birch'], perHa: 6, scale: [0.7, 1.1], clear: 2 },
    { assets: ['grass-tall-dry'], perHa: 60, scale: [0.8, 1.3], clear: 0.5 },
  ],
  heath: [
    { assets: ['shrub', 'bush'], perHa: 50, scale: [0.6, 1.1], clear: 1 },
    { assets: ['grass-tall-dry', 'grass-autumn'], perHa: 100, scale: [0.8, 1.3], clear: 0.5 },
  ],
  meadow: [
    { assets: ['flowers', 'flowers-yellow', 'flowers-blue'], perHa: 25, scale: [0.8, 1.3], clear: 0.5 },
    { assets: BUSHES, perHa: 2, scale: [0.8, 1.3], clear: 1 },
  ],
  park: [
    { assets: ['tree-oak', 'tree-maple', 'tree-birch'], perHa: 18, scale: [0.9, 1.3], clear: 2 },
    { assets: BUSHES, perHa: 14, scale: [0.8, 1.3], clear: 1 },
  ],
  cemetery: [
    { assets: ['tree-fir-young', 'tree-birch', 'tree-oak'], perHa: 12, scale: [0.8, 1.1], clear: 2 },
    { assets: ['bush', 'shrub'], perHa: 20, scale: [0.6, 1], clear: 1 },
  ],
  allotments: [
    { assets: ['fruit-tree'], perHa: 12, scale: [0.8, 1.1], clear: 1.5 },
    { assets: BUSHES, perHa: 30, scale: [0.6, 1.1], clear: 1 },
  ],
  wetland: [
    { assets: ['reeds', 'reed-bed', 'grass-swamp'], perHa: 220, scale: [0.8, 1.3], clear: 1 },
    { assets: ['tree-willow', 'tree-birch'], perHa: 3, scale: [0.8, 1.2], clear: 2 },
  ],
  pitch: [],
};

const ROWS: Partial<Record<LandClass, RowKind>> = {
  vineyard: { asset: 'vine-row', across: 2.4, along: 10, downhill: true, segment: true, scale: [1, 1] },
  orchard: { asset: 'fruit-tree', across: 8, along: 7, scale: [0.85, 1.15] },
};

/** Reeds at the shores of lakes, ponds and streams, per hectare of the band within 3 m of the water */
const SHORE_REEDS: PlantKind = { assets: ['reeds', 'reed-bed'], perHa: 300, scale: [0.8, 1.3], clear: 1 };
const SHORE_BAND = 3;

/** Metres a plant keeps from the HQ and from a spawn */
const HQ_CLEAR = 25;
const SPAWN_CLEAR = 12;
/** Metres from a route within which plants grow fully, and beyond which at FAR_SHARE */
const ROUTE_NEAR = 150;
const ROUTE_FAR = 700;
const FAR_SHARE = 0.3;
/** Metres between the single trees of a tree row */
const TREE_ROW_SPACING = 9;

export interface VegetationOptions {
  /** Scene cost of one object of an asset (scene-cost.ts objectCost on this map) */
  costOf: (asset: string) => number;
  /** Points the plants may cost, default PLANT_BUDGET_SHARE of SCENE_BUDGET */
  budget?: number;
  limit?: number;
}

export interface VegetationReport {
  /** Plants placed, by land class or source (single trees, rows of trees, shores) */
  placed: Record<string, number>;
  objects: number;
  /** Scene cost of the plants and their budget, points */
  cost: number;
  budget: number;
  /** Candidates before the budget and the cap thinned them */
  candidates: number;
}

interface Candidate {
  asset: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  /** Lower goes first when the budget runs short */
  priority: number;
  source: string;
  /** A row of a crop (ROW_BUDGET_SHARE) */
  row?: boolean;
}

/**
 * Grows the plants of `features` on `doc` (after its HQ, spawns and routes
 * are laid): `land` is the land class grid of paintGround, `water` what
 * carveWater left
 */
export function growVegetation(doc: CustomMapDocument, features: OsmFeatures, land: Uint8Array, water: WaterResult, options: VegetationOptions): VegetationReport {
  const t = doc.terrain;
  const grid = sampleGrid(t.width, t.grid.cellSize);
  const n = grid.n;
  const seed = Math.round(features.frame.lat * 1e4) ^ Math.round(features.frame.lon * 1e4);
  const cell = (p: MapPoint) => {
    const i = Math.round((p.x - grid.origin) / grid.step);
    const j = Math.round((p.y - grid.origin) / grid.step);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };

  // Where nothing grows: roads (with the distance to them), water, buildings, the HQ and spawns
  const roadDist = distanceField(water.roads, n, grid.step, 6, false);
  const blocked = new Uint8Array(n * n);
  for (let k = 0; k < blocked.length; k++) if (water.wet[k] || water.sea[k]) blocked[k] = 1;
  for (const a of features.areas) {
    if (!a.tags['building']) continue;
    fillRings([...a.outer, ...a.inner], grid, (i, j) => (blocked[j * n + i] = 1));
  }
  const clearings = [{ ...doc.hq, r: HQ_CLEAR }, ...doc.spawns.map((s) => ({ x: s.x, y: s.y, r: SPAWN_CLEAR }))];
  const free = (x: number, y: number, clear: number) => {
    const k = cell({ x, y });
    if (k < 0 || blocked[k] || roadDist[k] < clear) return false;
    return !clearings.some((c) => Math.hypot(c.x - x, c.y - y) < c.r);
  };

  // Nearness to the routes: full within ROUTE_NEAR, FAR_SHARE past ROUTE_FAR (on a coarse grid)
  const coarse: RasterGrid = { n: Math.ceil(t.width / 8) + 1, origin: -t.width / 2, step: 8 };
  const onRoute = new Uint8Array(coarse.n * coarse.n);
  let routes = 0;
  for (const route of spawnRoutes(doc).values()) {
    if (!route) continue;
    routes++;
    stampLine(route.points, coarse, coarse.step, (i, j) => (onRoute[j * coarse.n + i] = 1));
  }
  const routeDist = routes ? distanceField(onRoute, coarse.n, coarse.step, ROUTE_FAR, false) : null;
  const nearRoute = (x: number, y: number) => {
    if (!routeDist) return 0;
    const i = Math.min(coarse.n - 1, Math.max(0, Math.round((x - coarse.origin) / coarse.step)));
    const j = Math.min(coarse.n - 1, Math.max(0, Math.round((y - coarse.origin) / coarse.step)));
    return routeDist[j * coarse.n + i];
  };
  const routeShare = (d: number) => (d <= ROUTE_NEAR ? 1 : d >= ROUTE_FAR ? FAR_SHARE : 1 - ((1 - FAR_SHARE) * (d - ROUTE_NEAR)) / (ROUTE_FAR - ROUTE_NEAR));

  // Distance from the edge of each class that grows denser there, inside it (roads and water count as outside)
  const edgeOf = new Map<number, Float32Array>();
  for (const [cls, kinds] of Object.entries(PLANTS) as [LandClass, PlantKind[]][]) {
    const band = Math.max(0, ...kinds.map((k) => k.band ?? 0));
    if (!band) continue;
    const index = LAND_CLASSES.indexOf(cls) + 1;
    const mask = new Uint8Array(n * n);
    let any = false;
    for (let k = 0; k < mask.length; k++) {
      if (land[k] === index && !water.roads[k] && !blocked[k]) {
        mask[k] = 1;
        any = true;
      }
    }
    if (any) edgeOf.set(index, distanceField(mask, n, grid.step, band, true));
  }

  const candidates: Candidate[] = [];
  const random = (i: number, j: number, channel: number) => hashCell(i, j, seed * 31 + channel);
  const pick = <T>(list: readonly T[], u: number) => list[Math.min(list.length - 1, Math.floor(u * list.length))];
  const lerp = (r: readonly [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

  // Areas: a jittered grid per kind over the whole map, kept where its class is
  (Object.entries(PLANTS) as [LandClass, PlantKind[]][]).forEach(([cls, kinds], c) => {
    const index = LAND_CLASSES.indexOf(cls) + 1;
    if (!land.includes(index)) return;
    kinds.forEach((kind, kk) => scatter(kind, cls, index, 100 + c * 16 + kk));
  });
  function scatter(kind: PlantKind, source: string, index: number, channel: number, where?: (k: number) => number) {
    const most = Math.max(kind.perHa, kind.edgePerHa ?? 0);
    const size = 100 / Math.sqrt(most);
    const cells = Math.ceil(t.width / size);
    const edge = edgeOf.get(index);
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const x = -t.width / 2 + (i + random(i, j, channel)) * size;
        const y = -t.depth / 2 + (j + random(i, j, channel + 1)) * size;
        const k = cell({ x, y });
        if (k < 0) continue;
        let density: number;
        if (where) density = where(k) * kind.perHa;
        else {
          if (land[k] !== index) continue;
          density = kind.perHa;
          if (kind.edgePerHa && edge) density += (kind.edgePerHa - kind.perHa) * (1 - Math.min(1, edge[k] / (kind.band ?? 1)));
        }
        const near = routeShare(nearRoute(x, y));
        const roll = random(i, j, channel + 2);
        if (roll >= (density / most) * near || !free(x, y, kind.clear)) continue;
        candidates.push({
          asset: pick(kind.assets, random(i, j, channel + 3)),
          x,
          y,
          rotation: random(i, j, channel + 4) * Math.PI * 2,
          scale: lerp(kind.scale, random(i, j, channel + 5)),
          priority: 1 + roll / near,
          source,
        });
      }
    }
  }

  // Reeds where a dry sample lies within SHORE_BAND of water that is not the sea or a pool
  const shoreWater = new Uint8Array(n * n);
  for (let k = 0; k < shoreWater.length; k++) if (water.wet[k] && !water.sea[k]) shoreWater[k] = 1;
  const shore = distanceField(shoreWater, n, grid.step, SHORE_BAND + 1, false);
  scatter(SHORE_REEDS, 'shore', -1, 900, (k) => (shore[k] > 0 && shore[k] <= SHORE_BAND ? 1 : 0));

  // Rows: vines and orchards, each area on its own grid, kept nearest the routes first
  for (const a of features.areas) {
    const tags = a.tags;
    const cls = (tags['landuse'] === 'vineyard' ? 'vineyard' : tags['landuse'] === 'orchard' ? 'orchard' : null) as LandClass | null;
    const row = cls ? ROWS[cls] : undefined;
    if (!cls || !row) continue;
    const index = LAND_CLASSES.indexOf(cls) + 1;
    const angle = row.downhill ? downhill(doc, a.outer[0]) : longestSide(a.outer[0]);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const p of a.outer[0]) {
      const s = p.x * ux + p.y * uy;
      const r = -p.x * uy + p.y * ux;
      minA = Math.min(minA, s);
      maxA = Math.max(maxA, s);
      minB = Math.min(minB, r);
      maxB = Math.max(maxB, r);
    }
    for (let b = Math.ceil(minB / row.across) * row.across; b <= maxB; b += row.across) {
      for (let s = Math.ceil(minA / row.along) * row.along + row.along / 2; s <= maxA; s += row.along) {
        const x = s * ux - b * uy;
        const y = s * uy + b * ux;
        const k = cell({ x, y });
        if (k < 0 || land[k] !== index) continue;
        // A segment of row needs its ends in the vineyard as well
        if (row.segment) {
          const e1 = cell({ x: x + ux * row.along * 0.45, y: y + uy * row.along * 0.45 });
          const e2 = cell({ x: x - ux * row.along * 0.45, y: y - uy * row.along * 0.45 });
          if (e1 < 0 || e2 < 0 || land[e1] !== index || land[e2] !== index || !free(x + ux * 4, y + uy * 4, 1) || !free(x - ux * 4, y - uy * 4, 1)) continue;
        }
        if (!free(x, y, 1)) continue;
        const u = hashCell(Math.round(s * 10), Math.round(b * 10), seed + 7);
        candidates.push({
          asset: row.asset,
          x,
          y,
          rotation: row.segment ? angle : u * Math.PI * 2,
          scale: lerp(row.scale, u),
          priority: 1 + nearRoute(x, y) / ROUTE_FAR,
          source: cls,
          row: true,
        });
      }
    }
  }

  // Single trees and tree rows: always (priority 0) where they are free
  const built = (p: MapPoint) => {
    const k = cell(p);
    const c = k < 0 ? 0 : land[k];
    return c === 0 || LAND_CLASSES[c - 1] === 'paved' || LAND_CLASSES[c - 1] === 'parking';
  };
  const tree = (p: MapPoint, tags: Record<string, string>, source: string, u: number) => {
    if (!free(p.x, p.y, 1)) return;
    candidates.push({ asset: treeAsset(tags, built(p), u), x: p.x, y: p.y, rotation: u * Math.PI * 2, scale: 0.85 + 0.3 * hashCell(Math.round(p.x * 10), Math.round(p.y * 10), seed + 3), priority: 0, source });
  };
  for (const p of features.points) {
    if (p.tags['natural'] === 'tree') tree(p, p.tags, 'trees', hashCell(p.id % 1e6, 1, seed));
  }
  for (const w of features.ways) {
    if (w.tags['natural'] !== 'tree_row') continue;
    for (const line of runs(w.points)) {
      resample(line, TREE_ROW_SPACING).forEach((p, k) => {
        if (Math.abs(p.x) < features.half && Math.abs(p.y) < features.half) tree(p, w.tags, 'tree rows', hashCell(w.id % 1e6, k, seed));
      });
    }
  }

  // The budget: by priority until the points or the count run out
  const budget = options.budget ?? PLANT_BUDGET_SHARE * SCENE_BUDGET;
  const limit = options.limit ?? PLANT_LIMIT;
  candidates.sort((p, q) => p.priority - q.priority);
  const ids = new ObjectIds(doc.objects);
  const placed: Record<string, number> = {};
  let cost = 0;
  let rowCost = 0;
  let count = 0;
  for (const c of candidates) {
    if (count >= limit) break;
    const add = options.costOf(c.asset);
    if (cost + add > budget || (c.row && rowCost + add > budget * ROW_BUDGET_SHARE)) continue;
    cost += add;
    if (c.row) rowCost += add;
    count++;
    placed[c.source] = (placed[c.source] ?? 0) + 1;
    const o: MapObject = { id: ids.take(), asset: c.asset, x: round2(c.x), y: round2(c.y), z: 0, rotation: Math.round(c.rotation * 1000) / 1000, scale: round2(c.scale) };
    doc.objects.push(o);
  }
  return { placed, objects: count, cost: Math.round(cost), budget: Math.round(budget), candidates: candidates.length };
}

/** Scene cost per asset on an OSM world of side `side` from the catalogue's objects, for the import's options */
export function plantCosts(objects: readonly (CostEntry & { id: string })[], side: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of objects) if (o.category === 'tree' || o.category === 'plant') out[o.id] = Math.round(objectCost(o, side * side) * 100) / 100;
  return out;
}

/** A single tree's model from its tags: needles or leaves, the genus where a model has it; street trees in town */
export function treeAsset(tags: Readonly<Record<string, string>>, inTown: boolean, u: number): string {
  const genus = (tags['genus'] ?? tags['taxon'] ?? tags['species'] ?? '').split(/\s/)[0].toLowerCase();
  const byGenus: Record<string, string> = {
    betula: 'tree-birch',
    salix: 'tree-willow',
    quercus: 'tree-oak',
    acer: 'tree-maple',
    pinus: 'tree-pine',
    picea: 'tree-fir',
    abies: 'tree-fir',
    malus: 'fruit-tree',
    prunus: 'fruit-tree',
    pyrus: 'fruit-tree',
  };
  if (byGenus[genus]) return byGenus[genus];
  if (tags['leaf_type'] === 'needleleaved') return u < 0.5 ? 'tree-fir' : 'tree-pine';
  if (inTown) return 'tree-street';
  return BROADLEAF[Math.min(BROADLEAF.length - 1, Math.floor(u * BROADLEAF.length))];
}

/** The direction (radians from east) of a ring's longest side */
function longestSide(ring: readonly MapPoint[]): number {
  let best = 0;
  let angle = 0;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) {
      best = len;
      angle = Math.atan2(b.y - a.y, b.x - a.x);
    }
  }
  return angle;
}

/** The direction (radians from east) down the slope at a ring's middle, its longest side on flat ground */
function downhill(doc: CustomMapDocument, ring: readonly MapPoint[]): number {
  const t = doc.terrain;
  const g = t.grid;
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const at = (x: number, y: number) => {
    const i = Math.min(g.columns - 1, Math.max(0, Math.round((x + t.width / 2) / g.cellSize)));
    const j = Math.min(g.rows - 1, Math.max(0, Math.round((y + t.depth / 2) / g.cellSize)));
    return g.heights[j * g.columns + i];
  };
  const d = 12;
  const gx = at(cx + d, cy) - at(cx - d, cy);
  const gy = at(cx, cy + d) - at(cx, cy - d);
  if (Math.hypot(gx, gy) < 0.5) return longestSide(ring);
  return Math.atan2(-gy, -gx);
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
