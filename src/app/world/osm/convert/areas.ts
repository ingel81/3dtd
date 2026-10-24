/**
 * The areas of use of an OSM world (docs/OSM_WORLD_ROUND2_PLAN.md, E237):
 * pitches of every sport, playgrounds, car parks, squares, platforms and
 * pools laid as surfaces over the ground (MapSurface, render/surfaces/)
 * with their lines, cemeteries and allotments in rows and plots, and the
 * objects of each kind: goals, nets and hoops on their lines, a fence round
 * a tennis court, devices and benches on a playground, cars in the stalls
 * of a car park, market stalls on a market square, graves along a
 * cemetery's paths, sheds and fences in the allotments.
 *
 * What each kind is comes from area-tags.ts. The lines go where the
 * outline fills its turned rectangle well (map-surfaces.ts MARKING_FILL),
 * else the surface keeps its material alone. A pitch, a court and a car
 * park get level ground (the median height inside, a slope over SLOPE
 * metres round it, the roads and water left alone), so lines and cars do
 * not tilt on a hillside.
 *
 * The objects keep off roads, water, buildings, the HQ and the spawns, and
 * hold their own share of the scene budget (AREA_BUDGET_SHARE): past it the
 * cars go first, then the tables of outdoor seating, then the devices far
 * from the routes. A map draws at most MAX_SURFACE_MATERIALS on its
 * surfaces: the materials covering the least fall back along their chains.
 */
import { hashCell } from '../../../map-ops/landscape-noise';
import { ObjectIds } from '../../../map-ops/object-ops';
import { EdgeIndex, pointSegmentDistance, spawnRoutes } from '../../../map-ops/path-graph';
import type { CustomMapDocument, MapObject, MapPoint, MapSurface, MapSurfaceMarking } from '../../custom-map/map-document';
import { SCENE_BUDGET } from '../../custom-map/render/objects/scene-cost';
import { centroid, fitMarking, insideRing, insideSurface, MARKING_FILL, markingPoint, MAX_SURFACE_MATERIALS, minAreaRect, surfaceArea } from '../../custom-map/map-surfaces';
import { areaLookOf, availableMaterial, MATERIAL_FALLBACK, PARKED_CARS, type AreaKind } from '../area-tags';
import type { OsmFeatures } from '../osm-parse';
import { LineClearance } from './line-clear';
import type { RailPlan } from './rails-types';
import { fillRings, sampleGrid, stampLine, distanceField, type RasterGrid } from './raster';
import type { WaterResult } from './water-types';
import { round2, round3 } from './geom';
import { type Add, allotmentPlots, at, benchesAt, BuildingIndex, cemetery, fenceRect, goals, hoops, loungers, marketStalls, multi, net, outdoorSeating, parkedCars, type Planned, playground, skatePark, soccer } from './area-objects';

/** Share of the scene budget the objects of the areas may take */
const AREA_BUDGET_SHARE = 0.1;
/** How much of its rectangle a car park must fill for its rows of stalls */
const PARKING_FILL = 0.6;
/** Square metres an area needs for a surface */
const MIN_AREA = 8;
/** Metres over which levelled ground meets the ground round it */
const SLOPE = 5;
/** Metres an object keeps from the HQ and from a spawn, and from a road's edge */
const HQ_CLEAR = 25;
const SPAWN_CLEAR = 10;
const ROAD_CLEAR = 0.4;
/** Metres from a route within which devices count as near (kept before the far ones) */
const ROUTE_NEAR = 200;

/** Every asset the areas may place, for the catalogue's costs (vegetation.ts assetCosts) */
export const AREA_ASSETS: readonly string[] = [
  'football-goal',
  'goal-small',
  'handball-goal',
  'basketball-hoop',
  'tennis-net',
  'volleyball-net',
  'table-tennis',
  'skate-ramp',
  'floodlight-mast',
  'fence-chainlink',
  'fence-rail',
  'fence-picket',
  'hedge-long',
  'bench',
  'playground-swing',
  'playground-slide',
  'climbing-frame',
  'seesaw',
  'spring-rider',
  'sandbox',
  'playground-roundabout',
  'market-stall-red',
  'market-stall-blue',
  'sun-lounger',
  'cafe-set',
  'parasol',
  'graves',
  'garden-shed',
  'flower-bed',
  ...PARKED_CARS,
];

export interface AreaOptions {
  /** Scene cost of one object of an asset on this map */
  costOf: (asset: string) => number;
  /** Whether the catalogue has a ground material; null: take the last of each material's chain */
  hasMaterial?: ((id: string) => boolean) | null;
  /** Whether the catalogue has a model; an object without one is left out (null: all are there) */
  hasAsset?: ((id: string) => boolean) | null;
  /** Points the objects may cost, default AREA_BUDGET_SHARE of SCENE_BUDGET */
  budget?: number;
  /** The routes from the spawns to the HQ (spawnRoutes), worked out once for the import; found here when missing */
  routes?: readonly (readonly MapPoint[])[];
  /** The railway: the fences and hedges stop at its beds */
  rails?: RailPlan;
}

export interface AreaReport {
  /** Surfaces laid, by kind */
  surfaces: Partial<Record<AreaKind, number>>;
  /** Of those with lines, and the areas whose ground was levelled */
  marked: number;
  levelled: number;
  /** Materials laid (after the fallbacks), and the ones that fell back (material: the one taken) */
  materials: string[];
  fellBack: Record<string, string>;
  /** Objects placed by source, and those left out */
  placed: Record<string, number>;
  objects: number;
  dropped: { road: number; water: number; building: number; clearing: number; budget: number };
  cost: number;
  budget: number;
}

export interface AreaResult {
  report: AreaReport;
  /** Per height sample: 1 under a surface or an object of the areas (plants keep off) */
  keepOff: Uint8Array;
}

interface Candidate {
  o: Omit<MapObject, 'id'>;
  source: string;
  /** Lower goes first when the budget runs short */
  priority: number;
  /** A piece of a fence or hedge: metres it reaches along model X either side of its middle */
  reach?: number;
}

/**
 * The areas of `features` laid on `doc` (after the roads, water, HQ and
 * spawns, before the buildings, furniture and plants): surfaces to
 * `doc.surfaces`, objects to `doc.objects`, the ground levelled
 */
export function layAreas(doc: CustomMapDocument, features: OsmFeatures, water: WaterResult, options: AreaOptions): AreaResult {
  const t = doc.terrain;
  const half = t.width / 2;
  const grid = sampleGrid(t.width, t.grid.cellSize);
  const n = grid.n;
  const seed = Math.round(features.frame.lat * 1e4) ^ Math.round(features.frame.lon * 1e4);
  const report: AreaReport = { surfaces: {}, marked: 0, levelled: 0, materials: [], fellBack: {}, placed: {}, objects: 0, dropped: { road: 0, water: 0, building: 0, clearing: 0, budget: 0 }, cost: 0, budget: 0 };
  const roads = new EdgeIndex({ nodes: doc.paths.nodes, edges: doc.paths.edges.filter((e) => !e.tunnel) });
  const cell = (p: MapPoint) => {
    const i = Math.round((p.x - grid.origin) / grid.step);
    const j = Math.round((p.y - grid.origin) / grid.step);
    return i < 0 || j < 0 || i >= n || j >= n ? -1 : j * n + i;
  };
  // The buildings by the cells of a coarse grid their boxes touch: a few hundred objects test a few footprints each
  const buildings = new BuildingIndex(features.areas.filter((a) => a.tags['building']));
  const centres = features.areas.filter((a) => a.tags['leisure'] === 'sports_centre' || a.tags['leisure'] === 'stadium');
  const markets = features.points.filter((p) => p.tags['amenity'] === 'marketplace');
  const devices = features.points.filter((p) => !!p.tags['playground']);

  // The surfaces: one per outer ring of each area of use, its holes the inner rings inside it
  const planned: Planned[] = [];
  const cemeteries: Planned[] = [];
  const allotments: Planned[] = [];
  const seating: Planned[] = [];
  for (const area of features.areas) {
    const look = areaLookOf(area.tags);
    if (!look || area.area < MIN_AREA) continue;
    area.outer.forEach((outer, k) => {
      const holes = area.inner.filter((h) => h.length >= 3 && insideRing(h[0], outer));
      const id = `osm-a${area.id}${k ? `-${k}` : ''}`;
      const surface: MapSurface = { id, material: look.material ?? '', outer: outer.map(at), group: `osm-a${area.id}` };
      if (holes.length) surface.holes = holes.map((h) => h.map(at));
      if (surfaceArea(surface) < MIN_AREA) return;
      const entry = { surface, look, area };
      if (look.kind === 'cemetery') cemeteries.push(entry);
      else if (look.kind === 'allotments') allotments.push(entry);
      else if (look.kind === 'seating') seating.push(entry);
      else if (look.kind === 'pool') {
        const ring = poolDeck(surface);
        if (ring) planned.push({ surface: ring, look, area });
      } else planned.push(entry);
    });
  }

  // Materials: the catalogue's, a square of setts where the streets round it are, at most MAX_SURFACE_MATERIALS.
  // An untagged square inside a larger one (a footway's area across a pedestrian square) takes its material
  const squares = planned.filter((p) => p.look.kind === 'square').sort((p, q) => surfaceArea(q.surface) - surfaceArea(p.surface));
  for (const p of planned) {
    if (p.look.kind === 'square' && !p.area.tags['surface'] && settsAround(p.surface, roads)) p.look = { ...p.look, material: 'cobblestone' };
    p.surface.material = availableMaterial(p.look.material!, options.hasMaterial ?? null);
    if (p.surface.material !== p.look.material) report.fellBack[p.look.material!] = p.surface.material;
  }
  squares.forEach((p, k) => {
    if (p.area.tags['surface']) return;
    const c = centroid(p.surface.outer);
    const outer = squares.slice(0, k).find((q) => insideSurface(q.surface, c));
    if (outer) p.surface.material = outer.surface.material;
  });
  fitMaterials(planned, options.hasMaterial ?? null, report);

  // Lines, level ground
  for (const p of planned) {
    const s = p.surface;
    if (p.look.marking) {
      // A car park's stalls follow its outline (the shader draws them only on the surface, cars stand only in whole
      // stalls): a park in an odd shape still gets its rows
      const m = fitMarking(p.look.marking, s.outer, s.holes ?? [], p.look.marking === 'parking' ? PARKING_FILL : MARKING_FILL);
      // A car park needs a row's depth, a running track a stadium's length (a long-jump pit is no oval)
      if (m && (p.look.marking !== 'parking' || m.width >= 5) && (p.look.marking !== 'track' || m.length >= 60)) {
        s.marking = m;
        report.marked++;
      }
    }
    if (p.look.level && (s.marking || p.look.kind === 'parking') && levelGround(doc, s, water)) report.levelled++;
    report.surfaces[p.look.kind] = (report.surfaces[p.look.kind] ?? 0) + 1;
  }

  // Cemeteries: gravel paths across the middle (surfaces of their own), rows of graves along them, a hedge round
  const extra: MapSurface[] = [];
  const candidates: Candidate[] = [];
  const add = (o: Omit<MapObject, 'id'>, source: string, priority: number, reach?: number) =>
    candidates.push({ o: { ...o, x: round2(o.x), y: round2(o.y), rotation: round3(o.rotation), scale: round2(o.scale) }, source, priority, reach });
  // The objects of an area carry its group, as its surface does: the editor picks and moves them together
  const into = (group: string | undefined): Add => (o, source, priority, reach) => add(group ? { ...o, group } : o, source, priority, reach);
  for (const c of cemeteries) cemetery(c, extra, into(c.surface.group), options.hasMaterial ?? null);
  for (const a of allotments) allotmentPlots(a, buildings, into(a.surface.group));
  for (const s of seating) outdoorSeating(s, into(s.surface.group));

  // Nearness to the routes, for the devices kept first
  const routeLines = options.routes ?? [...spawnRoutes(doc).values()].filter((r) => !!r).map((r) => r!.points);
  const coarse: RasterGrid = { n: Math.ceil(t.width / 8) + 1, origin: -half, step: 8 };
  const onRoute = new Uint8Array(coarse.n * coarse.n);
  for (const line of routeLines) stampLine(line, coarse, coarse.step, (i, j) => (onRoute[j * coarse.n + i] = 1));
  const routeDist = routeLines.length ? distanceField(onRoute, coarse.n, coarse.step, ROUTE_NEAR * 2, false) : null;
  const nearRoute = (p: MapPoint) => {
    if (!routeDist) return true;
    const i = Math.min(coarse.n - 1, Math.max(0, Math.round((p.x - coarse.origin) / coarse.step)));
    const j = Math.min(coarse.n - 1, Math.max(0, Math.round((p.y - coarse.origin) / coarse.step)));
    return routeDist[j * coarse.n + i] <= ROUTE_NEAR;
  };

  for (const p of planned) {
    const s = p.surface;
    const m = s.marking;
    const salt = hashCell(p.area.id % 1e6, 17, seed);
    const add = into(s.group);
    switch (p.look.kind) {
      case 'soccer':
        if (m) soccer(m, centres, add);
        break;
      case 'handball':
        if (m) goals(m, 'handball-goal', 1, add);
        break;
      case 'multi':
        if (m) multi(m, add);
        break;
      case 'basketball':
        if (m) hoops(m, add);
        break;
      case 'tennis':
        if (m) {
          net(m, 'tennis-net', add);
          fenceRect(m, 'fence-chainlink', 3.6, add, 'tennis fence');
        }
        break;
      case 'volleyball':
      case 'beachvolleyball':
        if (m) net(m, 'volleyball-net', add);
        break;
      case 'table_tennis': {
        const r = minAreaRect(s.outer);
        add({ asset: 'table-tennis', x: r.c.x, y: r.c.y, z: 0, rotation: Math.atan2(r.u.y, r.u.x), scale: 1 }, 'table tennis', 0);
        break;
      }
      case 'skateboard':
        skatePark(s, add);
        break;
      case 'equestrian':
        if (m) fenceRect(m, 'fence-rail', 3.8, add, 'riding fence');
        break;
      case 'boules':
        benchesAt(s, 2, salt, add, 'boules benches');
        break;
      case 'playground':
        playground(s, devices, salt, nearRoute, add);
        break;
      case 'parking':
        if (m) parkedCars(s, m, salt, add);
        break;
      case 'square':
        if (p.area.tags['amenity'] === 'marketplace' || markets.some((q) => insideSurface(s, q))) marketStalls(s, salt, add);
        break;
      case 'pool':
        loungers(p.area, add);
        break;
      default:
        break;
    }
  }

  // The objects: off roads, water, buildings and clearings, models the catalogue has, then the budget by priority
  const clearings = [{ ...doc.hq, r: HQ_CLEAR }, ...doc.spawns.map((sp) => ({ x: sp.x, y: sp.y, r: SPAWN_CLEAR }))];
  // A fence's or hedge's piece stops at the roads, paths and track beds with all its length
  const clearance = new LineClearance(doc.paths, options.rails ?? null, { roadClear: ROAD_CLEAR, pavements: false });
  const why = (p: MapPoint, reach?: number): keyof AreaReport['dropped'] | 'outside' | null => {
    if (Math.abs(p.x) > half - 1 || Math.abs(p.y) > half - 1) return 'outside';
    const k = cell(p);
    if (k < 0) return 'outside';
    if (water.wet[k] || water.sea[k]) return 'water';
    if (buildings.holds(p)) return 'building';
    if (clearings.some((c) => Math.hypot(c.x - p.x, c.y - p.y) < c.r)) return 'clearing';
    const hit = roads.nearest(p, 16);
    if (hit && hit.dist < hit.edge.width / 2 + ROAD_CLEAR) return 'road';
    if (reach !== undefined && !clearance.fits(p as MapObject, reach)) return 'road';
    return null;
  };
  const budget = options.budget ?? AREA_BUDGET_SHARE * SCENE_BUDGET;
  report.budget = Math.round(budget);
  candidates.sort((a, b) => a.priority - b.priority);
  const ids = new ObjectIds(doc.objects);
  const keepOff = new Uint8Array(n * n);
  let cost = 0;
  for (const c of candidates) {
    if (options.hasAsset && !options.hasAsset(c.o.asset)) continue;
    const no = why(c.o, c.reach);
    if (no === 'outside') continue;
    if (no) {
      report.dropped[no]++;
      continue;
    }
    const price = options.costOf(c.o.asset);
    if (cost + price > budget) {
      report.dropped.budget++;
      continue;
    }
    cost += price;
    doc.objects.push({ id: ids.take(), ...c.o });
    report.placed[c.source] = (report.placed[c.source] ?? 0) + 1;
    report.objects++;
    const k = cell(c.o);
    if (k >= 0) keepOff[k] = 1;
  }
  report.cost = Math.round(cost);

  const surfaces = [...planned.map((p) => p.surface), ...extra];
  for (const s of surfaces) fillRings([s.outer, ...(s.holes ?? [])], grid, (i, j) => (keepOff[j * n + i] = 1));
  if (surfaces.length) doc.surfaces = [...(doc.surfaces ?? []), ...surfaces];
  report.materials = [...new Set(surfaces.map((s) => s.material))];
  return { report, keepOff };
}

/** Whether the streets round a square are mostly setts: its own ground is then setts too (an old town) */
function settsAround(s: MapSurface, roads: EdgeIndex): boolean {
  let setts = 0;
  let all = 0;
  const step = Math.max(1, Math.floor(s.outer.length / 12));
  for (let k = 0; k < s.outer.length; k += step) {
    const hit = roads.nearest(s.outer[k], 25);
    if (!hit || !hit.edge.surface) continue;
    all++;
    if (hit.edge.surface === 'cobblestone') setts++;
  }
  return all >= 3 && setts * 2 > all;
}

/**
 * At most MAX_SURFACE_MATERIALS materials: the ones covering the most stay,
 * each other falls back along its chain to one that stays (else the one
 * covering the most)
 */
function fitMaterials(planned: Planned[], has: ((id: string) => boolean) | null, report: AreaReport): void {
  const cover = new Map<string, number>();
  for (const p of planned) cover.set(p.surface.material, (cover.get(p.surface.material) ?? 0) + surfaceArea(p.surface));
  if (cover.size <= MAX_SURFACE_MATERIALS) return;
  const kept = new Set([...cover.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_SURFACE_MATERIALS).map(([m]) => m));
  const most = [...kept][0];
  for (const p of planned) {
    const m = p.surface.material;
    if (kept.has(m)) continue;
    const next = (MATERIAL_FALLBACK[m] ?? []).find((f) => kept.has(f) && (!has || has(f))) ?? most;
    report.fellBack[m] = next;
    p.surface.material = next;
  }
}

/** A pool's deck: a band of tiles 2 m wide round a pool that fills its rectangle, the pool its hole; null for another */
function poolDeck(pool: MapSurface): MapSurface | null {
  const r = minAreaRect(pool.outer);
  if (r.a * r.b < 20 || surfaceArea(pool) < 0.85 * r.a * r.b) return null;
  const m: MapSurfaceMarking = { kind: 'platform', x: r.c.x, y: r.c.y, angle: Math.atan2(r.u.y, r.u.x), length: r.a + 4, width: r.b + 4 };
  const outer = [markingPoint(m, -m.length / 2, -m.width / 2), markingPoint(m, m.length / 2, -m.width / 2), markingPoint(m, m.length / 2, m.width / 2), markingPoint(m, -m.length / 2, m.width / 2)].map(at);
  return { id: `${pool.id}-deck`, material: pool.material, outer, holes: [pool.outer.slice()], group: pool.group };
}

/**
 * The ground under a surface levelled to the median height inside it, the
 * ground round it eased to that over SLOPE metres; the samples of roads and
 * water stay. Whether anything moved
 */
function levelGround(doc: CustomMapDocument, s: MapSurface, water: WaterResult): boolean {
  const t = doc.terrain;
  const g = t.grid;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of s.outer) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const i0 = Math.max(0, Math.floor((minX - SLOPE + t.width / 2) / g.cellSize));
  const i1 = Math.min(g.columns - 1, Math.ceil((maxX + SLOPE + t.width / 2) / g.cellSize));
  const j0 = Math.max(0, Math.floor((minY - SLOPE + t.depth / 2) / g.cellSize));
  const j1 = Math.min(g.rows - 1, Math.ceil((maxY + SLOPE + t.depth / 2) / g.cellSize));
  const inside: number[] = [];
  const near: { k: number; d: number }[] = [];
  const edges = s.outer.map((p, k) => [p, s.outer[(k + 1) % s.outer.length]] as const);
  for (let j = j0; j <= j1; j++) {
    const y = -t.depth / 2 + j * g.cellSize;
    for (let i = i0; i <= i1; i++) {
      const k = j * g.columns + i;
      if (water.roads[k] || water.wet[k] || water.sea[k]) continue;
      const p = { x: -t.width / 2 + i * g.cellSize, y };
      if (insideRing(p, s.outer)) {
        inside.push(k);
        continue;
      }
      let d = Infinity;
      for (const [a, b] of edges) d = Math.min(d, pointSegmentDistance(p, a, b));
      if (d < SLOPE) near.push({ k, d });
    }
  }
  if (!inside.length) return false;
  const heights = inside.map((k) => g.heights[k]).sort((a, b) => a - b);
  const level = heights[Math.floor(heights.length / 2)];
  if (heights[heights.length - 1] - heights[0] < 0.1) return false;
  for (const k of inside) g.heights[k] = level;
  for (const { k, d } of near) {
    const f = d / SLOPE;
    const w = f * f * (3 - 2 * f);
    g.heights[k] = level + (g.heights[k] - level) * w;
  }
  return true;
}
