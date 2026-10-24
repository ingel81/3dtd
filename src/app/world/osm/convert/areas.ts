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
import { centroid, courtOf, fitMarking, insideRing, insideSurface, MARKING_FILL, markingPoint, MAX_SURFACE_MATERIALS, minAreaRect, parkingRows, signedArea, STALL, surfaceArea } from '../../custom-map/map-surfaces';
import { areaLookOf, availableMaterial, MATERIAL_FALLBACK, PARKED_CARS, PLAYGROUND_DEVICES, PLAYGROUND_SETS, type AreaKind, type AreaLook } from '../area-tags';
import type { OsmArea, OsmFeatures, OsmPoint } from '../osm-parse';
import { LineClearance } from './line-clear';
import type { RailPlan } from './rails';
import { fillRings, sampleGrid, stampLine, distanceField, type RasterGrid } from './raster';

/** Metres a cell of the buildings' index */
const BUILDING_CELL = 40;
import type { WaterResult } from './water';
import { round2, round3 } from './geom';

/** Share of the scene budget the objects of the areas may take */
export const AREA_BUDGET_SHARE = 0.1;
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
/** Most graves a cemetery gets, most plots an allotment area */
const MAX_GRAVES = 500;
const MAX_PLOTS = 120;

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

/** One surface to lay, before its material is settled */
interface Planned {
  surface: MapSurface;
  look: AreaLook;
  area: OsmArea;
}

/** The direction (radians from east) a model facing north at turn 0 turns to face from `from` to `to` */
const facing = (from: MapPoint, to: MapPoint) => Math.atan2(-(to.x - from.x), to.y - from.y);

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

const at = (p: MapPoint): MapPoint => ({ x: round2(p.x), y: round2(p.y) });

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

type Add = (o: Omit<MapObject, 'id'>, source: string, priority: number, reach?: number) => void;

const place = (asset: string, p: MapPoint, rotation: number, scale = 1): Omit<MapObject, 'id'> => ({ asset, x: p.x, y: p.y, z: 0, rotation, scale });

/** A football pitch: goals on the goal lines (a small pitch's small goals), floodlights at the corners of a big one in a sports centre */
function soccer(m: MapSurfaceMarking, centres: readonly OsmArea[], add: Add): void {
  const court = courtOf(m);
  if (court.length >= 60) goals(m, 'football-goal', 1, add);
  else goals(m, 'goal-small', 1, add);
  const centre = { x: m.x, y: m.y };
  if (court.length < 60 || !centres.some((a) => a.outer.some((r) => insideRing(centre, r)))) return;
  const hl = court.length / 2 + 3;
  const hw = court.width / 2 + 3;
  for (const [u, v] of [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]]) {
    const p = markingPoint(m, u, v);
    add(place('floodlight-mast', p, facing(p, centre)), 'floodlights', 1);
  }
}

/** A goal on each goal line, its mouth to the middle */
function goals(m: MapSurfaceMarking, asset: string, scale: number, add: Add): void {
  const court = courtOf(m);
  const centre = { x: m.x, y: m.y };
  for (const side of [-1, 1]) {
    const p = markingPoint(m, (side * court.length) / 2, 0);
    add(place(asset, p, facing(p, centre), scale), 'goals', 0);
  }
}

/** A basketball court's hoops, their boards 1.2 m inside the end lines, facing the middle */
function hoops(m: MapSurfaceMarking, add: Add): void {
  const court = courtOf(m);
  const centre = { x: m.x, y: m.y };
  for (const side of [-1, 1]) {
    const p = markingPoint(m, side * (court.length / 2 - 1.2 * (court.length / 28)), 0);
    add(place('basketball-hoop', p, facing(p, centre)), 'hoops', 0);
  }
}

/** A multi-sport court: small goals on the end lines, hoops behind them, a ball fence along the ends */
function multi(m: MapSurfaceMarking, add: Add): void {
  goals(m, 'goal-small', 1, add);
  const court = courtOf(m);
  const centre = { x: m.x, y: m.y };
  for (const side of [-1, 1]) {
    const p = markingPoint(m, side * (m.length / 2 - 0.4), 0);
    if (Math.abs(m.length / 2 - court.length / 2) > 0.8) add(place('basketball-hoop', p, facing(p, centre)), 'hoops', 0);
    const a = markingPoint(m, side * (m.length / 2 - 0.3), -m.width / 2 + 0.3);
    const b = markingPoint(m, side * (m.length / 2 - 0.3), m.width / 2 - 0.3);
    line(a, b, 'fence-chainlink', 3.6, add, 'ball fence');
  }
}

/** A net across the middle of the court, its posts on the sidelines (the model's X along them) */
function net(m: MapSurfaceMarking, asset: string, add: Add): void {
  add(place(asset, { x: m.x, y: m.y }, m.angle + Math.PI / 2), 'nets', 0);
}

/** A fence round the marking's rectangle, 0.3 m inside it */
function fenceRect(m: MapSurfaceMarking, asset: string, spacing: number, add: Add, source: string): void {
  const l = m.length / 2 - 0.3;
  const w = m.width / 2 - 0.3;
  const corners = [markingPoint(m, -l, -w), markingPoint(m, l, -w), markingPoint(m, l, w), markingPoint(m, -l, w)];
  for (let k = 0; k < 4; k++) line(corners[k], corners[(k + 1) % 4], asset, spacing, add, source);
}

/** Pieces of a fence or hedge along a straight line, each across it (their length along model X) */
function line(a: MapPoint, b: MapPoint, asset: string, spacing: number, add: Add, source: string, priority = 1): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const count = Math.max(1, Math.round(len / spacing));
  const rotation = Math.atan2(b.y - a.y, b.x - a.x);
  for (let k = 0; k < count; k++) {
    const f = (k + 0.5) / count;
    add(place(asset, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, rotation), source, priority, spacing / 2);
  }
}

/** Skate ramps facing each other along the park, one in the middle of a small one */
function skatePark(s: MapSurface, add: Add): void {
  const r = minAreaRect(s.outer);
  const along = r.a >= r.b ? r.u : { x: -r.u.y, y: r.u.x };
  const length = Math.max(r.a, r.b);
  const centre = r.c;
  const ends = length >= 14 ? [-1, 1] : [0];
  for (const e of ends) {
    const p = { x: centre.x + along.x * e * (length / 2 - 3), y: centre.y + along.y * e * (length / 2 - 3) };
    add(place('skate-ramp', p, e === 0 ? facing(p, { x: p.x + along.x, y: p.y + along.y }) : facing(p, centre)), 'skate ramps', 0);
  }
}

/**
 * Spots inside a surface on a jittered grid of `size` metres, at least
 * `margin` from its edge, in an order of their own (the same data gives the
 * same spots)
 */
function spotsIn(s: MapSurface, size: number, margin: number, salt: number): MapPoint[] {
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
  const out: { p: MapPoint; order: number }[] = [];
  const rings = [s.outer, ...(s.holes ?? [])];
  for (let y = minY + size / 2, j = 0; y < maxY; y += size, j++) {
    for (let x = minX + size / 2, i = 0; x < maxX; x += size, i++) {
      const p = { x: x + (hashCell(i, j, salt) - 0.5) * size * 0.5, y: y + (hashCell(i, j, salt + 1) - 0.5) * size * 0.5 };
      if (!insideSurface(s, p)) continue;
      let d = Infinity;
      for (const r of rings) for (let k = 0; k < r.length; k++) d = Math.min(d, pointSegmentDistance(p, r[k], r[(k + 1) % r.length]));
      if (d < margin) continue;
      out.push({ p, order: hashCell(i, j, salt + 2) });
    }
  }
  return out.sort((a, b) => a.order - b.order).map((e) => e.p);
}

/** Benches at the edge of a surface, 1 m inside, facing its middle */
function benchesAt(s: MapSurface, count: number, salt: number, add: Add, source: string): void {
  const c = centroid(s.outer);
  const ring = s.outer;
  const perimeter = ring.reduce((sum, p, k) => sum + Math.hypot(ring[(k + 1) % ring.length].x - p.x, ring[(k + 1) % ring.length].y - p.y), 0);
  for (let b = 0; b < count; b++) {
    const along = ((b + hashCell(b, 3, salt)) / count) * perimeter;
    const edge = pointOnRing(ring, along);
    const d = Math.hypot(c.x - edge.x, c.y - edge.y) || 1;
    const p = { x: edge.x + ((c.x - edge.x) / d) * 1, y: edge.y + ((c.y - edge.y) / d) * 1 };
    if (insideSurface(s, p)) add(place('bench', p, facing(p, c)), source, 3);
  }
}

/** A playground's devices: those mapped inside it (`devices`: the points with a `playground` tag), else a set by its size; benches at its edge */
function playground(s: MapSurface, devices: readonly OsmPoint[], salt: number, nearRoute: (p: MapPoint) => boolean, add: Add): void {
  const mapped = devices.filter((q) => insideSurface(s, q));
  const priority = (p: MapPoint) => (nearRoute(p) ? 2 : 4);
  if (mapped.length) {
    for (const q of mapped) {
      const asset = PLAYGROUND_DEVICES[q.tags['playground']];
      if (asset) add(place(asset, q, hashCell(q.id % 1e6, 5, salt) * Math.PI * 2), 'playground', priority(q));
    }
  } else {
    const area = surfaceArea(s);
    const set = [...PLAYGROUND_SETS].reverse().find((e) => area >= e.from)!;
    const spots = spotsIn(s, 6, 2.5, salt);
    const taken: MapPoint[] = [];
    for (const asset of set.devices) {
      const p = spots.find((q) => taken.every((t) => Math.hypot(t.x - q.x, t.y - q.y) >= 5));
      if (!p) break;
      taken.push(p);
      add(place(asset, p, hashCell(Math.round(p.x), Math.round(p.y), salt) * Math.PI * 2), 'playground', priority(p));
    }
  }
  benchesAt(s, Math.min(4, Math.max(1, Math.round(surfaceArea(s) / 400))), salt, add, 'playground benches');
}

/** Cars on 40 to 70 % of a car park's stalls (a share of its own) that lie wholly on it, nose in */
function parkedCars(s: MapSurface, m: MapSurfaceMarking, salt: number, add: Add): void {
  const fill = 0.4 + 0.3 * salt;
  parkingRows(m).forEach((row, r) => {
    const v = (row.v0 + row.v1) / 2;
    row.stalls.forEach((u, k) => {
      const roll = hashCell(k, r, Math.round(salt * 1e6));
      if (roll >= fill) return;
      // The stall's corners a little inside it: a row along the park's edge has them on its outline
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => markingPoint(m, u + a * (STALL.width / 2 - 0.3), v + b * ((row.v1 - row.v0) / 2 - 0.3)));
      if (!corners.every((q) => insideSurface(s, q))) return;
      const p = markingPoint(m, u, v);
      const back = markingPoint(m, u, v - row.aisle);
      add(place(PARKED_CARS[Math.floor(hashCell(k, r + 99, Math.round(salt * 1e6)) * PARKED_CARS.length)], p, facing(p, back)), 'cars', 6);
    });
  });
}

/** A market square's stalls in two rows along the middle */
function marketStalls(s: MapSurface, salt: number, add: Add): void {
  const r = minAreaRect(s.outer);
  const along = r.a >= r.b ? r.u : { x: -r.u.y, y: r.u.x };
  const across = { x: -along.y, y: along.x };
  const length = Math.max(r.a, r.b);
  const count = Math.min(8, Math.max(2, Math.floor(length / 7)));
  for (let k = 0; k < count; k++) {
    const u = (k - (count - 1) / 2) * 5;
    for (const side of [-1, 1]) {
      const p = { x: r.c.x + along.x * u + across.x * side * 3, y: r.c.y + along.y * u + across.y * side * 3 };
      if (!insideSurface(s, p)) continue;
      const centre = { x: r.c.x + along.x * u, y: r.c.y + along.y * u };
      add(place(hashCell(k, side + 2, salt) < 0.5 ? 'market-stall-red' : 'market-stall-blue', p, facing(p, centre)), 'market stalls', 4);
    }
  }
}

/** Loungers beside a pool of an open-air bath, along its long sides, facing it */
function loungers(pool: OsmArea, add: Add): void {
  const ring = pool.outer[0];
  if (!ring || pool.area < 150) return;
  const r = minAreaRect(ring);
  const along = r.a >= r.b ? r.u : { x: -r.u.y, y: r.u.x };
  const across = { x: -along.y, y: along.x };
  const length = Math.max(r.a, r.b);
  const off = Math.min(r.a, r.b) / 2 + 3.5;
  const count = Math.min(12, Math.floor(length / 1.6));
  for (let k = 0; k < count; k++) {
    const u = (k - (count - 1) / 2) * 1.6;
    const p = { x: r.c.x + along.x * u + across.x * off, y: r.c.y + along.y * u + across.y * off };
    add(place('sun-lounger', p, facing(p, { x: p.x - across.x, y: p.y - across.y })), 'loungers', 5);
  }
}

/** Tables with chairs and parasols on an outdoor seating area, a few metres apart */
function outdoorSeating(e: Planned, add: Add): void {
  const salt = e.area.id % 1e6;
  const spots = spotsIn(e.surface, 3, 1, salt).slice(0, 12);
  spots.forEach((p, k) => {
    add(place('cafe-set', p, hashCell(k, 1, salt) * Math.PI), 'outdoor seating', 5);
    if (k % 2 === 0) add(place('parasol', p, 0), 'outdoor seating', 5);
  });
}

/**
 * A cemetery: two gravel paths across its middle along its rectangle's
 * axes (surfaces of their own, cut to its outline), graves in rows along
 * them, 3 m from the paths and the edge, nearest the middle first, a hedge
 * along its outline
 */
function cemetery(e: Planned, extra: MapSurface[], add: Add, has: ((id: string) => boolean) | null): void {
  const s = e.surface;
  const r = minAreaRect(s.outer);
  const along = r.a >= r.b ? r.u : { x: -r.u.y, y: r.u.x };
  const angle = Math.atan2(along.y, along.x);
  const length = Math.max(r.a, r.b);
  const width = Math.min(r.a, r.b);
  const m: MapSurfaceMarking = { kind: 'platform', x: r.c.x, y: r.c.y, angle, length, width };
  const gravel = availableMaterial('gravel-light', has);
  const strips = [
    [markingPoint(m, -length / 2 - 1, -1.5), markingPoint(m, length / 2 + 1, -1.5), markingPoint(m, length / 2 + 1, 1.5), markingPoint(m, -length / 2 - 1, 1.5)],
    [markingPoint(m, -1.5, -width / 2 - 1), markingPoint(m, 1.5, -width / 2 - 1), markingPoint(m, 1.5, width / 2 + 1), markingPoint(m, -1.5, width / 2 + 1)],
  ];
  strips.forEach((strip, k) => {
    const cut = clipConvex(s.outer, strip);
    if (cut.length >= 3 && Math.abs(signedArea(cut)) > 20) extra.push({ id: `${s.id}-path-${k + 1}`, material: gravel, outer: cut.map(at), group: s.group });
  });
  // Rows of graves, nearest the middle first
  const spots: { p: MapPoint; d: number }[] = [];
  const rings = [s.outer, ...(s.holes ?? [])];
  for (let v = -width / 2 + 3; v <= width / 2 - 3; v += 3.2) {
    if (Math.abs(v) < 3.2) continue;
    for (let u = -length / 2 + 3; u <= length / 2 - 3; u += 2.6) {
      if (Math.abs(u) < 3) continue;
      const p = markingPoint(m, u, v);
      if (!insideSurface(s, p)) continue;
      let d = Infinity;
      for (const ring of rings) for (let k = 0; k < ring.length; k++) d = Math.min(d, pointSegmentDistance(p, ring[k], ring[(k + 1) % ring.length]));
      if (d < 3) continue;
      spots.push({ p, d: Math.hypot(u, v) });
    }
  }
  spots.sort((a, b) => a.d - b.d);
  for (const { p } of spots.slice(0, MAX_GRAVES)) add(place('graves', p, angle + Math.PI / 2), 'graves', 2);
  // A hedge round it, 0.8 m inside
  const c = centroid(s.outer);
  const inset = s.outer.map((p) => {
    const d = Math.hypot(c.x - p.x, c.y - p.y) || 1;
    return { x: p.x + ((c.x - p.x) / d) * 0.8, y: p.y + ((c.y - p.y) / d) * 0.8 };
  });
  for (let k = 0; k < inset.length; k++) line(inset[k], inset[(k + 1) % inset.length], 'hedge-long', 6, add, 'cemetery hedge', 1);
}

/**
 * Allotments: plots of about 15 x 25 m along the area's rectangle, each with
 * a picket fence on its front and one side, a raised bed in the middle and a
 * shed at the back where OSM maps no hut in it; nearest the middle first
 */
function allotmentPlots(e: Planned, buildings: BuildingIndex, add: Add): void {
  const s = e.surface;
  const r = minAreaRect(s.outer);
  const along = r.a >= r.b ? r.u : { x: -r.u.y, y: r.u.x };
  const angle = Math.atan2(along.y, along.x);
  const length = Math.max(r.a, r.b);
  const width = Math.min(r.a, r.b);
  const m: MapSurfaceMarking = { kind: 'platform', x: r.c.x, y: r.c.y, angle, length, width };
  const plots: { u: number; v: number; d: number }[] = [];
  const W = 15;
  const D = 25;
  for (let v = -width / 2 + D / 2; v <= width / 2 - D / 2 + 0.01; v += D) {
    for (let u = -length / 2 + W / 2; u <= length / 2 - W / 2 + 0.01; u += W) {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => markingPoint(m, u + (a * W) / 2, v + (b * D) / 2));
      if (!corners.every((q) => insideSurface(s, q))) continue;
      plots.push({ u, v, d: Math.hypot(u, v) });
    }
  }
  plots.sort((a, b) => a.d - b.d);
  const huts = buildings.near(s.outer).map((b) => centroid(b.outer[0] ?? [])).filter((p) => insideSurface(s, p));
  for (const { u, v } of plots.slice(0, MAX_PLOTS)) {
    const p = (du: number, dv: number) => markingPoint(m, u + du, v + dv);
    line(p(-W / 2, -D / 2), p(W / 2, -D / 2), 'fence-picket', 3.6, add, 'allotment fences', 3);
    line(p(-W / 2, -D / 2), p(-W / 2, D / 2), 'fence-picket', 3.6, add, 'allotment fences', 3);
    add(place('flower-bed', p(0, -2), angle), 'allotment beds', 3);
    const corners = [p(-W / 2, -D / 2), p(W / 2, -D / 2), p(W / 2, D / 2), p(-W / 2, D / 2)];
    if (huts.some((h) => insideRing(h, corners))) continue;
    const shed = p(W / 2 - 3, D / 2 - 3);
    add(place('garden-shed', shed, facing(shed, p(0, 0))), 'allotment sheds', 3);
  }
}

/** The point `along` metres round a ring from its first point */
function pointOnRing(ring: readonly MapPoint[], along: number): MapPoint {
  let left = along;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len) return { x: a.x + ((b.x - a.x) * left) / (len || 1), y: a.y + ((b.y - a.y) * left) / (len || 1) };
    left -= len;
  }
  return ring[0];
}

/** A ring cut to a convex polygon (Sutherland-Hodgman); the clip polygon counter-clockwise or clockwise alike */
function clipConvex(subject: readonly MapPoint[], clip: readonly MapPoint[]): MapPoint[] {
  const sign = signedArea(clip) >= 0 ? 1 : -1;
  let out = subject.slice();
  for (let k = 0; k < clip.length && out.length; k++) {
    const a = clip[k];
    const b = clip[(k + 1) % clip.length];
    const side = (p: MapPoint) => sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const p = input[i];
      const q = input[(i + 1) % input.length];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      }
    }
  }
  return out;
}

/** The buildings' footprints by the cells of a coarse grid their boxes touch */
class BuildingIndex {
  private readonly cells = new Map<number, OsmArea[]>();

  constructor(buildings: readonly OsmArea[]) {
    for (const b of buildings) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const r of b.outer) {
        for (const p of r) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
      for (let j = Math.floor(minY / BUILDING_CELL); j <= Math.floor(maxY / BUILDING_CELL); j++) {
        for (let i = Math.floor(minX / BUILDING_CELL); i <= Math.floor(maxX / BUILDING_CELL); i++) {
          const key = i * 65536 + j;
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(b);
        }
      }
    }
  }

  /** Whether a point lies in a footprint (inside an outer ring, in none of its holes) */
  holds(p: MapPoint): boolean {
    const list = this.cells.get(Math.floor(p.x / BUILDING_CELL) * 65536 + Math.floor(p.y / BUILDING_CELL));
    return !!list?.some((b) => b.outer.some((r) => insideRing(p, r)) && !b.inner.some((r) => insideRing(p, r)));
  }

  /** The buildings whose cells a ring's box touches */
  near(ring: readonly MapPoint[]): OsmArea[] {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const out = new Set<OsmArea>();
    for (let j = Math.floor(minY / BUILDING_CELL); j <= Math.floor(maxY / BUILDING_CELL); j++) {
      for (let i = Math.floor(minX / BUILDING_CELL); i <= Math.floor(maxX / BUILDING_CELL); i++) for (const b of this.cells.get(i * 65536 + j) ?? []) out.add(b);
    }
    return [...out];
  }
}
