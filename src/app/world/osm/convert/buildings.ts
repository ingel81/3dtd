/**
 * The buildings of an OSM world (docs/OSM_WORLD_PLAN.md, "Gebäude"): each
 * footprint becomes one or more catalogue models.
 *
 * 1. Kind: building-tags.ts guesses it from the tags, the size and the land
 *    use the footprint stands in.
 * 2. Shape: the smallest turned rectangle round the footprint; one that
 *    fills less than FILL_SPLIT of it (an L, a U, a courtyard block) is cut
 *    into rectangles on a raster of the footprint, the biggest first.
 * 3. Model: each rectangle faces the nearest street with one of its sides
 *    and takes the model of its kind whose wall box fits best, at one scale
 *    for all axes (SCALE_MIN to SCALE_MAX); a rectangle longer or deeper than
 *    one model is a row (two back to back at most) of copies, modules with
 *    blank sides first, a corner house where a side street meets the row.
 *    A kind without a fitting model takes the next kind's and the report
 *    counts it as missing; one that nothing fits is a row of city-block
 *    modules (the block with a facade of decision 6), else it is left out.
 * 4. Clear of roads, water and the HQ: a model over a road shrinks, else it
 *    goes; one in water goes.
 * 5. Scene cost: the buildings may spend BUILDING_BUDGET_SHARE of the scene
 *    budget; past it the smallest buildings far from the HQ go first.
 * 6. Slope: the ground under each model (its wall box and a margin, never a
 *    road or water) is cut to its lowest corner, where the renderer seats it;
 *    where the hill then stands higher than RETAINING_FROM beside a wall, a
 *    retaining wall holds the cut.
 */
import { heightAt } from '../../../editor/model/grid';
import type { CustomMapDocument, MapObject, MapPoint } from '../../custom-map/map-document';
import { objectCost, SCENE_BUDGET, type CostEntry } from '../../custom-map/render/objects/scene-cost';
import { waterLevelAt } from '../../custom-map/water-level';
import { BUILDING_MODELS, buildingKind, buildingLandOf, buildingLevels, isGroundBuilding, KIND_MODELS, type BuildingKind, type BuildingModel } from '../building-tags';
import { ringArea, type OsmArea, type OsmFeatures } from '../osm-parse';

/** A catalogue entry as far as the buildings read it */
export type BuildingCatalogEntry = CostEntry & { id: string; footprint: number };

export interface BuildingOptions {
  /**
   * The asset catalogue: only its models are placed, and its triangles give
   * the scene cost. Without it every model of building-tags.ts is placed and
   * the cost is not held to the budget (a warning says so).
   */
  catalog?: readonly BuildingCatalogEntry[];
  /** Points of the scene budget the buildings may spend (default BUILDING_BUDGET_SHARE of SCENE_BUDGET) */
  budget?: number;
}

export interface BuildingReport {
  /** Footprints read (building areas on the ground) */
  footprints: number;
  /** Footprints that stand with at least one model, and the models placed */
  placed: number;
  objects: number;
  /** Footprints cut into several rectangles, and laid as rows of more than one model */
  split: number;
  rows: number;
  /** Footprints by kind */
  kinds: Partial<Record<BuildingKind, number>>;
  /** Footprints (some part of them) that took another kind's models ("garage>carport"), or none ("shed>none") */
  fallbacks: Record<string, number>;
  /** Footprints left out and why */
  dropped: { tiny: number; noModel: number; roads: number; water: number; hq: number; budget: number };
  /** Models shrunk off a road */
  shrunk: number;
  /** Pads cut into the slope, the deepest cut (m), retaining walls */
  pads: number;
  deepestCutM: number;
  retainingWalls: number;
  /** Scene points the buildings spend, and of the scene budget */
  cost: number;
  costShare: number;
  /**
   * What the catalogue lacks, most first: a kind with the size class of the
   * rectangles (whole footprints or their parts) none of its models fitted
   * (`house 10x4`), and how many
   */
  missing: { kind: string; count: number }[];
}

export interface BuildingResult {
  objects: MapObject[];
  report: BuildingReport;
  warnings: string[];
}

/** Share of SCENE_BUDGET the buildings may spend: the land's trees and plants take the rest */
export const BUILDING_BUDGET_SHARE = 0.6;
/** A footprint filling less of its turned rectangle than this is cut into rectangles */
export const FILL_SPLIT = 0.8;
/** One scale for all axes, within these */
export const SCALE_MIN = 0.8;
export const SCALE_MAX = 1.25;
/** Footprints smaller than this (m²) are left out */
const MIN_AREA = 6;
/** A worse fit than this (sum of the logs of both coverages and the penalties) takes the next kind */
const MAX_FIT_ERROR = 0.5;
/** What the block with a facade may miss of a footprint: it stands where nothing else fits */
const BLOCK_FIT_ERROR = 1.2;
/** What a front turned away from the street costs a fit */
const ACROSS_PENALTY = 0.15;
/** Most storeys a model may have for a footprint without `building:levels` or `height` */
const UNTAGGED_FLOORS = 5;
/** Copies of one model a rectangle may be laid with */
const MAX_COPIES = 24;
/** A part of a cut footprint smaller than this (m², and share of the footprint) is left to its neighbour */
const MIN_PART_AREA = 18;
const MIN_PART_SHARE = 0.12;
/** Rectangles a footprint is cut into at most */
const MAX_PARTS = 8;
/** A side street this near (m) to the end of a row of city-block modules makes the end a corner house */
const CORNER_REACH = 10;
/** Roads farther than this (m) from every side leave the front to the longer side */
const FRONT_REACH = 60;
/** Models keep this far (m) from the HQ's middle */
const HQ_CLEAR = 14;
/** Metres the levelled pad reaches past a model's walls */
const PAD_MARGIN = 0.6;
/** Metres beside a road's edge the pads leave alone */
const ROAD_GUARD = 0.5;
/** A cut deeper than this (m) beside a wall gets a retaining wall */
const RETAINING_FROM = 2;
const RETAINING_ASSET = 'retaining-wall';
/** The retaining wall's length and depth at scale 1 (m) */
const RETAINING_BOX: readonly [number, number] = [6, 1.2];
/** Path edges (footways) count this share of their width against buildings: pavements run along the walls */
const PATH_WIDTH_SHARE = 0.5;

/** A turned rectangle: middle, unit axis `u` along side `a`, side `b` along `v` (u turned a quarter left) */
interface Rect {
  c: MapPoint;
  u: MapPoint;
  a: number;
  b: number;
}

/** One model to place */
interface Placement {
  asset: string;
  /** Middle of its scaled wall box, its front (unit, outward) and the box's half sides */
  p: MapPoint;
  front: MapPoint;
  hw: number;
  hd: number;
  scale: number;
  /** Turn of the model (front at local +z) */
  rotation: number;
  model: BuildingModel;
}

interface Footprint {
  id: number;
  kind: BuildingKind;
  area: number;
  centre: MapPoint;
  placements: Placement[];
  cost: number;
}

/** The buildings of `features` placed on `doc` (after the roads and the HQ): objects to add, the ground levelled under them */
export function placeBuildings(doc: CustomMapDocument, features: OsmFeatures, options: BuildingOptions = {}): BuildingResult {
  const report: BuildingReport = {
    footprints: 0,
    placed: 0,
    objects: 0,
    split: 0,
    rows: 0,
    kinds: {},
    fallbacks: {},
    dropped: { tiny: 0, noModel: 0, roads: 0, water: 0, hq: 0, budget: 0 },
    shrunk: 0,
    pads: 0,
    deepestCutM: 0,
    retainingWalls: 0,
    cost: 0,
    costShare: 0,
    missing: [],
  };
  const warnings: string[] = [];
  const catalog = options.catalog ? new Map(options.catalog.map((e) => [e.id, e])) : null;
  if (!catalog) warnings.push('buildings: no asset catalogue, the scene cost was not held to the budget');
  const known = (asset: string) => !catalog || catalog.has(asset);
  const roads = new SegmentIndex(doc);
  const lands = new AreaIndex(features.areas.filter((a) => buildingLandOf(a.tags) !== null));
  const waters = new AreaIndex(features.areas.filter((a) => isWaterTags(a.tags)));
  const missing = new Map<string, number>();
  const footprints: Footprint[] = [];

  for (const area of features.areas) {
    if (!area.tags['building'] || !isGroundBuilding(area.tags)) continue;
    report.footprints++;
    if (area.area < MIN_AREA) {
      report.dropped.tiny++;
      continue;
    }
    for (const outer of area.outer) {
      const holes = area.inner.filter((r) => pointInRing(r[0], outer));
      const ringA = Math.abs(ringArea(outer)) - holes.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
      if (ringA < MIN_AREA) {
        report.dropped.tiny++;
        continue;
      }
      const rect = minAreaRect(outer);
      const centre = rect.c;
      const land = (lands.at(centre)?.tags ?? null) as Record<string, string> | null;
      const kind = buildingKind(area.tags, ringA, Math.max(rect.a, rect.b) / Math.max(0.1, Math.min(rect.a, rect.b)), land ? buildingLandOf(land) : null);
      report.kinds[kind] = (report.kinds[kind] ?? 0) + 1;
      const fill = ringA / (rect.a * rect.b);
      const parts = fill < FILL_SPLIT ? splitFootprint(outer, holes, rect, ringA) : [rect];
      if (parts.length > 1) report.split++;
      const levels = buildingLevels(area.tags);
      const placements: Placement[] = [];
      const took = new Set<BuildingKind | null>();
      for (const part of parts) {
        const laid = layPart(part, kind, levels, roads, known, area.id, report);
        took.add(laid?.kind ?? null);
        if (laid) placements.push(...laid.placements);
        // The catalogue lacks this kind at this size: the part took another kind's models, or none
        if (laid?.kind !== kind) {
          const key = `${kind} ${sizeClass(part.a, part.b)}`;
          missing.set(key, (missing.get(key) ?? 0) + 1);
        }
      }
      for (const k of took) if (k !== kind) report.fallbacks[`${kind}>${k ?? 'none'}`] = (report.fallbacks[`${kind}>${k ?? 'none'}`] ?? 0) + 1;
      if (!placements.length) {
        report.dropped.noModel++;
        continue;
      }
      // Clear of water, roads and the HQ
      const kept: Placement[] = [];
      let why: 'water' | 'roads' | 'hq' | null = null;
      for (const pl of placements) {
        if (boxCorners(pl).some((q) => waters.at(q) !== null || waterLevelAt(doc.terrain, q.x, q.y, heightAt(doc.terrain, q.x, q.y)) !== null)) {
          why = 'water';
          continue;
        }
        if (boxDistance(pl, doc.hq) < HQ_CLEAR) {
          why = 'hq';
          continue;
        }
        const clear = clearOfRoads(pl, roads);
        if (!clear) {
          why = 'roads';
          continue;
        }
        if (clear === 'shrunk') report.shrunk++;
        kept.push(pl);
      }
      if (!kept.length) {
        report.dropped[why ?? 'roads']++;
        continue;
      }
      const cost = kept.reduce((s, pl) => s + costOf(pl.asset, catalog, doc), 0);
      footprints.push({ id: area.id, kind, area: ringA, centre, placements: kept, cost });
    }
  }

  // Scene cost: past the budget, the smallest footprints far from the HQ go first
  const budget = options.budget ?? BUILDING_BUDGET_SHARE * SCENE_BUDGET;
  let cost = footprints.reduce((s, f) => s + f.cost, 0);
  if (catalog && cost > budget) {
    const worth = (f: Footprint) => f.area / (1 + Math.hypot(f.centre.x - doc.hq.x, f.centre.y - doc.hq.y) / 400);
    const order = [...footprints].sort((p, q) => worth(p) - worth(q));
    const gone = new Set<Footprint>();
    for (const f of order) {
      if (cost <= budget) break;
      gone.add(f);
      cost -= f.cost;
    }
    report.dropped.budget = gone.size;
    if (gone.size) warnings.push(`buildings: ${gone.size} small buildings far from the HQ left out to keep the scene cost (${Math.round((budget / SCENE_BUDGET) * 100)} % of the budget)`);
    footprints.splice(0, footprints.length, ...footprints.filter((f) => !gone.has(f)));
  }

  // Pads, retaining walls and the objects
  const guard = roadGuard(doc);
  const boxes = new BoxIndex(footprints.flatMap((f) => f.placements));
  const objects: MapObject[] = [];
  let n = 0;
  for (const f of footprints) {
    const group = `osm-b${f.id}`;
    for (const pl of f.placements) {
      const seatR = (catalog?.get(pl.asset)?.footprint ?? Math.max(pl.model.box[0], pl.model.box[1]) * 0.45) * pl.scale;
      const pad = levelPad(doc, pl, seatR, guard);
      if (pad.cut > 0.05) report.pads++;
      report.deepestCutM = Math.max(report.deepestCutM, round1(pad.cut));
      objects.push({ id: `osm-b${++n}`, asset: pl.asset, x: round2(origin(pl).x), y: round2(origin(pl).y), z: 0, rotation: round3(pl.rotation), scale: round3(pl.scale), group });
      if (known(RETAINING_ASSET)) {
        for (const w of retainingWalls(doc, pl, pad.level, roads, boxes)) {
          objects.push({ id: `osm-b${++n}`, ...w, group });
          report.retainingWalls++;
        }
      }
    }
    report.placed++;
  }
  report.objects = objects.length;
  report.cost = Math.round(objects.reduce((s, o) => s + costOf(o.asset, catalog, doc), 0));
  report.costShare = Math.round((report.cost / SCENE_BUDGET) * 1000) / 1000;
  report.missing = [...missing.entries()].sort((p, q) => q[1] - p[1]).map(([kind, count]) => ({ kind, count }));
  return { objects, report, warnings };
}

function costOf(asset: string, catalog: ReadonlyMap<string, BuildingCatalogEntry> | null, doc: CustomMapDocument): number {
  return catalog ? objectCost(catalog.get(asset), doc.terrain.width * doc.terrain.depth) : 0;
}

/** `natural=water`, riverbanks, basins: no building stands in them */
function isWaterTags(tags: Readonly<Record<string, string>>): boolean {
  return tags['natural'] === 'water' || tags['waterway'] === 'riverbank' || tags['landuse'] === 'basin' || tags['landuse'] === 'reservoir' || !!tags['water'];
}

// ---- Shape ----

/** Convex hull (Andrew's monotone chain), counter-clockwise */
export function convexHull(points: readonly MapPoint[]): MapPoint[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  if (pts.length < 3) return pts;
  const cross = (o: MapPoint, a: MapPoint, b: MapPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: MapPoint[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: MapPoint[] = [];
  for (let k = pts.length - 1; k >= 0; k--) {
    const p = pts[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** The smallest turned rectangle round a ring: one side lies on an edge of its hull (rotating calipers, tried edge by edge) */
export function minAreaRect(ring: readonly MapPoint[]): Rect {
  const hull = convexHull(ring);
  let best: Rect | null = null;
  let bestArea = Infinity;
  for (let k = 0; k < hull.length; k++) {
    const p = hull[k];
    const q = hull[(k + 1) % hull.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 1e-6) continue;
    const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const h of hull) {
      const su = h.x * u.x + h.y * u.y;
      const sv = -h.x * u.y + h.y * u.x;
      minU = Math.min(minU, su);
      maxU = Math.max(maxU, su);
      minV = Math.min(minV, sv);
      maxV = Math.max(maxV, sv);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < bestArea - 1e-9) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = { c: { x: cu * u.x - cv * u.y, y: cu * u.y + cv * u.x }, u, a: maxU - minU, b: maxV - minV };
    }
  }
  return best ?? { c: ring[0] ?? { x: 0, y: 0 }, u: { x: 1, y: 0 }, a: 0, b: 0 };
}

/** Even-odd: whether point `p` lies inside `ring` */
export function pointInRing(p: MapPoint, ring: readonly MapPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  }
  return inside;
}

/**
 * A footprint that fills its rectangle badly cut into rectangles: the
 * footprint rasterised in the rectangle's own axes, then the biggest
 * rectangle of filled cells taken again and again (the largest rectangle
 * under each row's histogram) until the parts left are small
 */
export function splitFootprint(outer: readonly MapPoint[], holes: readonly MapPoint[][], rect: Rect, area: number): Rect[] {
  const cell = Math.max(0.5, Math.min(2, Math.sqrt(rect.a * rect.b) / 60));
  const nu = Math.max(1, Math.ceil(rect.a / cell));
  const nv = Math.max(1, Math.ceil(rect.b / cell));
  const v = { x: -rect.u.y, y: rect.u.x };
  const filled = new Uint8Array(nu * nv);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const su = -rect.a / 2 + (i + 0.5) * (rect.a / nu);
      const sv = -rect.b / 2 + (j + 0.5) * (rect.b / nv);
      const p = { x: rect.c.x + su * rect.u.x + sv * v.x, y: rect.c.y + su * rect.u.y + sv * v.y };
      if (pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h))) filled[j * nu + i] = 1;
    }
  }
  const du = rect.a / nu;
  const dv = rect.b / nv;
  const minCells = Math.max(MIN_PART_AREA, MIN_PART_SHARE * area) / (du * dv);
  const parts: Rect[] = [];
  const heights = new Int32Array(nu);
  while (parts.length < MAX_PARTS) {
    // Largest rectangle of filled cells: histogram per row, a stack per histogram
    let best = { cells: 0, i0: 0, i1: 0, j0: 0, j1: 0 };
    heights.fill(0);
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) heights[i] = filled[j * nu + i] ? heights[i] + 1 : 0;
      const stack: number[] = [];
      for (let i = 0; i <= nu; i++) {
        const h = i < nu ? heights[i] : 0;
        while (stack.length && heights[stack[stack.length - 1]] >= h) {
          const top = stack.pop()!;
          const height = heights[top];
          const left = stack.length ? stack[stack.length - 1] + 1 : 0;
          const cells = height * (i - left);
          if (cells > best.cells) best = { cells, i0: left, i1: i - 1, j0: j - height + 1, j1: j };
        }
        stack.push(i);
      }
    }
    if (best.cells < minCells) break;
    for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) filled[j * nu + i] = 0;
    const su = -rect.a / 2 + ((best.i0 + best.i1 + 1) / 2) * du;
    const sv = -rect.b / 2 + ((best.j0 + best.j1 + 1) / 2) * dv;
    parts.push({
      c: { x: rect.c.x + su * rect.u.x + sv * v.x, y: rect.c.y + su * rect.u.y + sv * v.y },
      u: rect.u,
      a: (best.i1 - best.i0 + 1) * du,
      b: (best.j1 - best.j0 + 1) * dv,
    });
  }
  return parts.length ? parts : [rect];
}

// ---- Models ----

interface Fit {
  model: BuildingModel;
  copies: number;
  rows: number;
  scale: number;
  error: number;
}

/** The best fit of `kind`'s models to a front `wide` m and `deep` m; null when none is good enough */
export function fitModels(
  kind: BuildingKind,
  wide: number,
  deep: number,
  levels: number | null,
  known: (asset: string) => boolean,
  salt = 0,
  maxError = MAX_FIT_ERROR,
): Fit | null {
  let best: Fit | null = null;
  const models = KIND_MODELS[kind].models.filter((m) => known(m) && BUILDING_MODELS[m]);
  models.forEach((asset, rank) => {
    const model = BUILDING_MODELS[asset];
    // High-rises only where the tags say so: a village's winery is no office tower
    if (levels === null && model.floors > UNTAGGED_FLOORS) return;
    const [w, d] = model.box;
    for (let rows = 1; rows <= 2; rows++) {
      const most = Math.min(MAX_COPIES, Math.max(1, Math.ceil(wide / (w * SCALE_MIN))));
      for (let copies = 1; copies <= most; copies++) {
        const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.min(wide / (copies * w), deep / (rows * d))));
        const cu = (copies * w * scale) / wide;
        const cv = (rows * d * scale) / deep;
        // A model bigger than the footprint costs twice: it stands in the street or the neighbour
        let error = Math.abs(Math.log(cu)) * (cu > 1 ? 2 : 1) + Math.abs(Math.log(cv)) * (cv > 1 ? 2 : 1);
        const extra = copies * rows - 1;
        // Copies: cheap for modules of a kind that stands in rows, dearer for a house cut in two
        error += extra * (model.module ? (KIND_MODELS[kind].rows ? 0.01 : 0.06) : 0.12) + (rows > 1 ? 0.12 : 0);
        if (levels !== null) error += Math.min(0.6, Math.abs(levels - model.floors) * 0.08);
        // A little order (the first model of the kind) and a little variety (the footprint's salt) for ties
        error += rank * 0.01 + (((salt * 31 + rank * 17) % 7) / 7) * 0.03;
        if (!best || error < best.error) best = { model, copies, rows, scale, error };
      }
    }
  });
  return best && (best as Fit).error <= maxError ? best : null;
}

/** Size class of a footprint for the missing list: its sides rounded to 5 m (2 m under 10 m) */
function sizeClass(a: number, b: number): string {
  const r = (v: number) => (v < 10 ? Math.max(2, Math.round(v / 2) * 2) : Math.round(v / 5) * 5);
  return `${r(Math.max(a, b))}x${r(Math.min(a, b))}`;
}

/** The models of one rectangle of a footprint, facing the nearest street; null when nothing fits */
function layPart(
  rect: Rect,
  kind: BuildingKind,
  levels: number | null,
  roads: SegmentIndex,
  known: (asset: string) => boolean,
  salt: number,
  report: BuildingReport,
): { placements: Placement[]; kind: BuildingKind } | null {
  const v = { x: -rect.u.y, y: rect.u.x };
  // The four sides: outward normal, the axis along it, its length and the depth behind it
  const sides = [
    { n: v, along: rect.u, len: rect.a, depth: rect.b },
    { n: { x: -v.x, y: -v.y }, along: rect.u, len: rect.a, depth: rect.b },
    { n: rect.u, along: v, len: rect.b, depth: rect.a },
    { n: { x: -rect.u.x, y: -rect.u.y }, along: v, len: rect.b, depth: rect.a },
  ];
  const dists = sides.map((s) => roads.distance({ x: rect.c.x + (s.n.x * s.depth) / 2, y: rect.c.y + (s.n.y * s.depth) / 2 }, FRONT_REACH));
  let front = 0;
  for (let k = 1; k < 4; k++) if (dists[k] < dists[front]) front = k;
  if (!Number.isFinite(dists[front])) front = rect.a >= rect.b ? 0 : 2;
  // The other way round: the nearer of the two sides across the front
  const across = front < 2 ? (dists[2] <= dists[3] ? 2 : 3) : dists[0] <= dists[1] ? 0 : 1;

  // The kind's models with the front on the street, else on a side across it; else the next kind's
  let chosen: { fit: Fit; side: number; kind: BuildingKind } | null = null;
  for (let k: BuildingKind | undefined = kind, step = 0; k && step < 3 && !chosen; k = KIND_MODELS[k].fallback, step++) {
    const onFront = fitModels(k, sides[front].len, sides[front].depth, levels, known, salt);
    const onSide = fitModels(k, sides[across].len, sides[across].depth, levels, known, salt);
    // Turning the front away from the street costs
    if (onFront && (!onSide || onFront.error <= onSide.error + ACROSS_PENALTY)) chosen = { fit: onFront, side: front, kind: k };
    else if (onSide && onSide.error + ACROSS_PENALTY <= MAX_FIT_ERROR) chosen = { fit: onSide, side: across, kind: k };
    else if (onFront) chosen = { fit: onFront, side: front, kind: k };
  }
  if (!chosen) {
    // The block with a facade: a row of city-block modules (two back to back), as well as they cover
    const block = (levels ?? 4) >= 5 ? 'block-row-6' : 'block-row-4';
    const s = sides[front];
    const fit = fitModels('apartments', s.len, s.depth, levels, (a) => a === block && known(a), salt, BLOCK_FIT_ERROR);
    if (fit) chosen = { fit, side: front, kind: 'apartments' };
  }
  if (!chosen) return null;
  const { fit, side } = chosen;
  const s = sides[side];
  if (fit.copies * fit.rows > 1) report.rows++;
  const mw = fit.model.box[0] * fit.scale;
  const md = fit.model.box[1] * fit.scale;
  const total = fit.copies * mw;
  // Ends of a row of city-block modules where a side street runs: corner houses there
  const corner = fit.model.floors >= 6 ? 'block-corner-6' : 'block-corner-4';
  const cornerAt = (end: number): boolean => {
    if (!fit.model.module || fit.model.floors < 4 || !known(corner)) return false;
    const k = [0, 1, 2, 3].find((q) => q >> 1 !== side >> 1 && (sides[q].n.x * s.along.x + sides[q].n.y * s.along.y) * end > 0.5);
    return k !== undefined && dists[k] <= CORNER_REACH;
  };
  const out: Placement[] = [];
  for (let row = 0; row < fit.rows; row++) {
    const face = row === 0 ? s.n : { x: -s.n.x, y: -s.n.y };
    // Rows against the front and the back: the street front lines up with the footprint's
    const depthOff = (row === 0 ? 1 : -1) * (s.depth / 2 - md / 2);
    for (let k = 0; k < fit.copies; k++) {
      const along = -total / 2 + (k + 0.5) * mw;
      const p = { x: rect.c.x + s.along.x * along + s.n.x * depthOff, y: rect.c.y + s.along.y * along + s.n.y * depthOff };
      // A lone module takes the corner on the side its street is
      const end = fit.copies === 1 ? (cornerAt(-1) ? -1 : 1) : k === 0 ? -1 : k === fit.copies - 1 ? 1 : 0;
      let model = fit.model;
      let front = face;
      if (row === 0 && end !== 0 && cornerAt(end)) {
        model = BUILDING_MODELS[corner];
        // Its second street side is its west (model -x, the front turned right): turned to face the row's end
        const toEnd = { x: s.along.x * end, y: s.along.y * end };
        const west = rightOf(face);
        if (west.x * toEnd.x + west.y * toEnd.y < 0) front = toEnd;
      }
      const scale = model === fit.model ? fit.scale : Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.min(mw / model.box[0], md / model.box[1])));
      out.push({ asset: model.asset, p, front, hw: (model.box[0] * scale) / 2, hd: (model.box[1] * scale) / 2, scale, rotation: Math.atan2(-front.x, front.y), model });
    }
  }
  return { placements: out, kind: chosen.kind };
}

/** The unit vector a quarter turn clockwise (to the right) of `f` */
function rightOf(f: MapPoint): MapPoint {
  return { x: f.y, y: -f.x };
}

/**
 * A placement's own axes in the map: the front, and the model's +x (the
 * renderer turns local +z to the front and local +x a quarter turn left of
 * it, map-coords.ts mirrors x: so model +x is the front turned left, and
 * model -x, a corner house's west side, the front turned right)
 */
function placementAxes(pl: Placement): { f: MapPoint; x: MapPoint } {
  const f = pl.front;
  return { f, x: { x: -f.y, y: f.x } };
}

/** The model's origin: the box middle less the model's own offset of its walls */
function origin(pl: Placement): MapPoint {
  const at = pl.model.at;
  if (!at) return pl.p;
  const { f, x } = placementAxes(pl);
  return { x: pl.p.x - (at[0] * x.x + at[1] * f.x) * pl.scale, y: pl.p.y - (at[0] * x.y + at[1] * f.y) * pl.scale };
}

/** The four corners of a placement's wall box, `grow` m larger on each side */
function boxCorners(pl: Placement, grow = 0): MapPoint[] {
  const { f } = placementAxes(pl);
  const r = rightOf(f);
  const hw = pl.hw + grow;
  const hd = pl.hd + grow;
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([a, b]) => ({ x: pl.p.x + r.x * hw * a + f.x * hd * b, y: pl.p.y + r.y * hw * a + f.y * hd * b }));
}

/** Point `q` in a placement's box axes: across (along its width) and along its face normal */
function toBox(pl: Placement, q: MapPoint): { s: number; t: number } {
  const f = pl.front;
  const r = rightOf(f);
  const dx = q.x - pl.p.x;
  const dy = q.y - pl.p.y;
  return { s: dx * r.x + dy * r.y, t: dx * f.x + dy * f.y };
}

/** Distance from point `q` to a placement's wall box (0 inside) */
function boxDistance(pl: Placement, q: MapPoint): number {
  const { s, t } = toBox(pl, q);
  return Math.hypot(Math.max(0, Math.abs(s) - pl.hw), Math.max(0, Math.abs(t) - pl.hd));
}

/** Distance from segment a-b to a placement's wall box */
function segmentBoxDistance(pl: Placement, a: MapPoint, b: MapPoint): number {
  const p = toBox(pl, a);
  const q = toBox(pl, b);
  // Crossing the box: Liang-Barsky against |s| <= hw, |t| <= hd
  let t0 = 0;
  let t1 = 1;
  const ds = q.s - p.s;
  const dt = q.t - p.t;
  let crosses = true;
  for (const [pp, qq] of [
    [-ds, p.s + pl.hw],
    [ds, pl.hw - p.s],
    [-dt, p.t + pl.hd],
    [dt, pl.hd - p.t],
  ]) {
    if (pp === 0) {
      if (qq < 0) crosses = false;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
  }
  if (crosses && t0 <= t1) return 0;
  let best = Math.min(boxDistance(pl, a), boxDistance(pl, b));
  for (const c of boxCorners(pl)) best = Math.min(best, pointSegment(c, a, b));
  return best;
}

function pointSegment(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** Shrinking steps for a model over a road, and the smallest scale it may reach */
const SHRINK_STEPS = [0.9, 0.8, 0.7];
const SHRINK_FLOOR = SCALE_MIN;

/**
 * Whether a placement stays off the roads: 'clear', or 'shrunk' when it had
 * to shrink about the back of its box (the front pulls back from the street,
 * down to SHRINK_FLOOR), false when it stays on one
 */
function clearOfRoads(pl: Placement, roads: SegmentIndex): 'clear' | 'shrunk' | false {
  const touches = (q: Placement) => roads.near(q.p, Math.max(q.hw, q.hd) + 1).some((seg) => segmentBoxDistance(q, seg.a, seg.b) < seg.half);
  if (!touches(pl)) return 'clear';
  for (const k of SHRINK_STEPS) {
    if (pl.scale * k < SHRINK_FLOOR) break;
    const back = pl.hd * (1 - k);
    const f = pl.front;
    const trial: Placement = { ...pl, p: { x: pl.p.x - f.x * back, y: pl.p.y - f.y * back }, hw: pl.hw * k, hd: pl.hd * k, scale: pl.scale * k };
    if (!touches(trial)) {
      Object.assign(pl, trial);
      return 'shrunk';
    }
  }
  return false;
}

// ---- Ground ----

/** Height samples beside the roads (their half width and ROAD_GUARD) and under water: the pads leave them */
function roadGuard(doc: CustomMapDocument): Uint8Array {
  const t = doc.terrain;
  const g = t.grid;
  const mask = new Uint8Array(g.columns * g.rows);
  const nodes = new Map(doc.paths.nodes.map((nd) => [nd.id, nd]));
  for (const e of doc.paths.edges) {
    const a = nodes.get(e.a);
    const b = nodes.get(e.b);
    if (!a || !b) continue;
    const line = [a, ...(e.via ?? []), b];
    const reach = e.width / 2 + ROAD_GUARD;
    for (let s = 0; s + 1 < line.length; s++) {
      const p = line[s];
      const q = line[s + 1];
      const i0 = Math.max(0, Math.floor((Math.min(p.x, q.x) - reach + t.width / 2) / g.cellSize));
      const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(p.x, q.x) + reach + t.width / 2) / g.cellSize));
      const j0 = Math.max(0, Math.floor((Math.min(p.y, q.y) - reach + t.depth / 2) / g.cellSize));
      const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(p.y, q.y) + reach + t.depth / 2) / g.cellSize));
      for (let j = j0; j <= j1; j++) {
        const y = -t.depth / 2 + j * g.cellSize;
        for (let i = i0; i <= i1; i++) {
          const x = -t.width / 2 + i * g.cellSize;
          if (pointSegment({ x, y }, p, q) <= reach) mask[j * g.columns + i] = 1;
        }
      }
    }
  }
  for (const body of [t.water, ...(t.waterBodies ?? [])]) {
    if (!body) continue;
    for (let k = 0; k < mask.length; k++) if (body.mask[k]) mask[k] = 1;
  }
  return mask;
}

/**
 * Cuts the ground under a placement (its wall box and PAD_MARGIN) to the
 * lowest of its corners and of the points the renderer seats it by (eight
 * round its footprint, seatR, object-seat.ts), so it stands at that height
 * with z 0 and nothing of it hangs: the level and the deepest cut
 */
function levelPad(doc: CustomMapDocument, pl: Placement, seatR: number, guard: Uint8Array): { level: number; cut: number } {
  const t = doc.terrain;
  const g = t.grid;
  const o = origin(pl);
  let level = heightAt(t, o.x, o.y);
  for (const c of boxCorners(pl)) level = Math.min(level, heightAt(t, c.x, c.y));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    level = Math.min(level, heightAt(t, o.x + Math.cos(a) * seatR, o.y + Math.sin(a) * seatR));
  }
  const corners = boxCorners(pl, PAD_MARGIN);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) + t.width / 2) / g.cellSize));
  const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + t.width / 2) / g.cellSize));
  const j0 = Math.max(0, Math.floor((Math.min(...ys) + t.depth / 2) / g.cellSize));
  const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + t.depth / 2) / g.cellSize));
  let cut = 0;
  for (let j = j0; j <= j1; j++) {
    const y = -t.depth / 2 + j * g.cellSize;
    for (let i = i0; i <= i1; i++) {
      const k = j * g.columns + i;
      if (guard[k]) continue;
      const x = -t.width / 2 + i * g.cellSize;
      const { s, t: tt } = toBox(pl, { x, y });
      if (Math.abs(s) > pl.hw + PAD_MARGIN || Math.abs(tt) > pl.hd + PAD_MARGIN) continue;
      const h = g.heights[k];
      if (h > level) {
        cut = Math.max(cut, h - level);
        g.heights[k] = level;
      }
    }
  }
  return { level, cut };
}

/** Retaining walls along the sides of a pad where the hill beside it stands more than RETAINING_FROM over it */
function retainingWalls(doc: CustomMapDocument, pl: Placement, level: number, roads: SegmentIndex, boxes: BoxIndex): Omit<MapObject, 'id'>[] {
  const t = doc.terrain;
  const f = pl.front;
  const r = rightOf(f);
  const out: Omit<MapObject, 'id'>[] = [];
  const sides = [
    { n: f, along: r, len: pl.hw * 2, off: pl.hd },
    { n: { x: -f.x, y: -f.y }, along: r, len: pl.hw * 2, off: pl.hd },
    { n: r, along: f, len: pl.hd * 2, off: pl.hw },
    { n: { x: -r.x, y: -r.y }, along: f, len: pl.hd * 2, off: pl.hw },
  ];
  const [wl, wd] = RETAINING_BOX;
  for (const side of sides) {
    if (side.len < 4) continue;
    const dist = side.off + PAD_MARGIN + wd / 2;
    let bank = Infinity;
    for (const u of [-0.35, 0, 0.35]) {
      const q = { x: pl.p.x + side.n.x * (dist + 1.5) + side.along.x * side.len * u, y: pl.p.y + side.n.y * (dist + 1.5) + side.along.y * side.len * u };
      bank = Math.min(bank, heightAt(t, q.x, q.y) - level);
    }
    if (!(bank > RETAINING_FROM)) continue;
    const count = Math.max(1, Math.round(side.len / wl));
    const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, side.len / (count * wl)));
    for (let k = 0; k < count; k++) {
      const u = -side.len / 2 + (k + 0.5) * (side.len / count);
      const p = { x: pl.p.x + side.n.x * dist + side.along.x * u, y: pl.p.y + side.n.y * dist + side.along.y * u };
      // Not on a road, not in the next building
      if (roads.near(p, wl).some((seg) => pointSegment(p, seg.a, seg.b) < seg.half + wd)) continue;
      if (boxes.near(p).some((q) => q !== pl && boxDistance(q, p) < wd)) continue;
      // Its face to the pad
      out.push({ asset: RETAINING_ASSET, x: round2(p.x), y: round2(p.y), z: 0, rotation: round3(Math.atan2(side.n.x, -side.n.y)), scale: round3(scale) });
    }
  }
  return out;
}

// ---- Indexes ----

interface Segment {
  a: MapPoint;
  b: MapPoint;
  /** Half the width that counts against buildings */
  half: number;
  road: boolean;
}

/** The map's path segments in a grid of cells, for the nearest street and the roads near a building */
class SegmentIndex {
  private readonly cell = 32;
  private readonly cells = new Map<number, Segment[]>();

  constructor(doc: CustomMapDocument) {
    const nodes = new Map(doc.paths.nodes.map((nd) => [nd.id, nd]));
    for (const e of doc.paths.edges) {
      const a = nodes.get(e.a);
      const b = nodes.get(e.b);
      if (!a || !b) continue;
      const line = [a, ...(e.via ?? []), b];
      const half = (e.width / 2) * (e.kind === 'path' ? PATH_WIDTH_SHARE : 1);
      for (let s = 0; s + 1 < line.length; s++) {
        const seg = { a: line[s], b: line[s + 1], half, road: e.kind !== 'path' };
        const i0 = Math.floor(Math.min(seg.a.x, seg.b.x) / this.cell);
        const i1 = Math.floor(Math.max(seg.a.x, seg.b.x) / this.cell);
        const j0 = Math.floor(Math.min(seg.a.y, seg.b.y) / this.cell);
        const j1 = Math.floor(Math.max(seg.a.y, seg.b.y) / this.cell);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const key = this.key(i, j);
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push(seg);
          }
        }
      }
    }
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** Segments whose cells come within `reach` of `p` */
  near(p: MapPoint, reach: number): Segment[] {
    const out = new Set<Segment>();
    const i0 = Math.floor((p.x - reach) / this.cell);
    const i1 = Math.floor((p.x + reach) / this.cell);
    const j0 = Math.floor((p.y - reach) / this.cell);
    const j1 = Math.floor((p.y + reach) / this.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const s of this.cells.get(this.key(i, j)) ?? []) out.add(s);
    return [...out];
  }

  /** Distance from `p` to the nearest road's edge (paths only where no road is within `reach`), Infinity past `reach` */
  distance(p: MapPoint, reach: number): number {
    let road = Infinity;
    let path = Infinity;
    for (const s of this.near(p, reach)) {
      const d = Math.max(0, pointSegment(p, s.a, s.b) - s.half);
      if (s.road) road = Math.min(road, d);
      else path = Math.min(path, d);
    }
    const best = road <= reach ? road : path;
    return best <= reach ? best : Infinity;
  }
}

/** Placements in a grid of cells by their middles, for what stands next to a point */
class BoxIndex {
  private readonly cell = 32;
  private readonly cells = new Map<number, Placement[]>();
  private widest = 0;

  constructor(placements: readonly Placement[]) {
    for (const pl of placements) {
      const key = this.key(Math.floor(pl.p.x / this.cell), Math.floor(pl.p.y / this.cell));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(pl);
      this.widest = Math.max(this.widest, Math.hypot(pl.hw, pl.hd));
    }
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** Placements whose boxes may reach `p` */
  near(p: MapPoint): Placement[] {
    const r = Math.ceil(this.widest / this.cell);
    const ci = Math.floor(p.x / this.cell);
    const cj = Math.floor(p.y / this.cell);
    const out: Placement[] = [];
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) out.push(...(this.cells.get(this.key(i, j)) ?? []));
    return out;
  }
}

/** Areas in a grid of cells by their bounds, for the area a point lies in (the smallest) */
class AreaIndex {
  private readonly cell = 64;
  private readonly cells = new Map<number, OsmArea[]>();

  constructor(areas: readonly OsmArea[]) {
    for (const area of areas) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const r of area.outer) {
        for (const p of r) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      }
      for (let j = Math.floor(minY / this.cell); j <= Math.floor(maxY / this.cell); j++) {
        for (let i = Math.floor(minX / this.cell); i <= Math.floor(maxX / this.cell); i++) {
          const key = (i + 4096) * 8192 + (j + 4096);
          let list = this.cells.get(key);
          if (!list) this.cells.set(key, (list = []));
          list.push(area);
        }
      }
    }
  }

  at(p: MapPoint): OsmArea | null {
    let best: OsmArea | null = null;
    for (const area of this.cells.get((Math.floor(p.x / this.cell) + 4096) * 8192 + (Math.floor(p.y / this.cell) + 4096)) ?? []) {
      if (best && area.area >= best.area) continue;
      if (area.outer.some((r) => pointInRing(p, r)) && !area.inner.some((r) => pointInRing(p, r))) best = area;
    }
    return best;
  }
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

