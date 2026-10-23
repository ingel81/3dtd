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
 *    goes; one in water goes. "Over a road" is the editor's check
 *    (objectsOnPaths): the catalogue's ground of the model against the road's
 *    width, a footpath's half, so the editor reports none of them. A passage
 *    through a building and a square's outline hold nothing off (roads.ts).
 * 4b. Fit: models that cover less than MODEL_COVER of the footprint or
 *    stand more than MODEL_OVERHANG of it outside give way to the footprint
 *    raised from its own outline (building-mass.ts), cut back off the roads;
 *    they stay only where that cannot stand (water). The report gives the
 *    coverage (CoverageReport).
 * 5. Scene cost: with a cap (BUILDING_BUDGET_SHARE of the scene budget, off
 *    for now, or `budget`) the smallest buildings far from the HQ go first
 *    past it.
 * 6. Slope: each model's floor lies at the ground before its entrance
 *    (floorLevel); towards the valley it stands over a basement down to the
 *    ground (MapObject.basement, its z the same), up the hill the ground is cut
 *    to its floor, a yard and a bank beyond, a retaining wall at the yard's
 *    edge only where the bank would stand higher than RETAINING_FROM on a side
 *    facing up the hill (cutSlope). Never under a road or in water.
 * 7. Door: an entrance OSM maps on the outline (EntranceIndex) gives its part
 *    the front; the building's door (`doors`, the footpath's start in
 *    plots.ts) is there, else its model's door nearest the street (the
 *    catalogue's `doors`), on a raised building the wall point nearest the
 *    street (MapMass.door, its only door). Kinds without one (NO_DOOR) none.
 */
import { heightAt } from '../../../map-ops/grid';
import type { CustomMapDocument, MapObject, MapPoint } from '../../custom-map/map-document';
import { objectCost, SCENE_BUDGET, type CostEntry } from '../../custom-map/render/objects/scene-cost';
import { waterLevelAt } from '../../custom-map/water-level';
import { groundRing, type GroundBox } from '../../custom-map/object-ground';
import { seatHeight, type ObjectFooting } from '../../custom-map/render/objects/object-seat';
import { CoveredWays, garageFloors, massOpenings, type OpeningReport } from './building-openings';
import { doorNodes, EdgeIndex, offDoors } from '../../../map-ops/path-graph';
import { objectsOnPaths, PATH_WALL_SHARE } from '../../../map-ops/validation/map-validation';
import {
  BUILDING_MODELS,
  buildingKind,
  buildingLandOf,
  buildingLevels,
  buildingMinLevel,
  buildingRole,
  footprintKindOf,
  isCompoundTags,
  isGroundBuilding,
  KIND_MODELS,
  ROW_ENDS,
  type BuildingKind,
  type BuildingModel,
  type LandmarkRole,
} from '../building-tags';
import type { OsmArea, OsmFeatures } from '../osm-parse';
import { ringArea } from '../square-clip';
import { convexHull, pointInRing } from './raster';
import { MASS_ASSET, type MapFootprints, type MapMass } from '../../custom-map/map-document';
import { packFootprints, type FootprintDrop, type FootprintRing } from '../../custom-map/map-footprints';
import { massArea, massBodies, massBox, massDistance, massOnRamp, massRadius, massTop, massTriangles, ringsContain } from '../../custom-map/object-mass';
import { toModel } from '../../custom-map/object-ground';
import { CLIP_KEEP, CLIP_LEAST, clipOffRoads, isDrawnPart, raiseMass, sharedWalls, shareWalls, type OsmPart } from './building-mass';
import { findOldTown } from './old-town';
import type { ImportNote } from '../../import-notes';
import type { CatalogDoor } from '../../custom-map/render/asset-catalog';

/** A catalogue entry as far as the buildings read it */
export type BuildingCatalogEntry = CostEntry & { id: string; footprint: number; box?: GroundBox; doors?: readonly CatalogDoor[] };

/** The catalogue entries the buildings read (their models and the retaining wall), slim for the worker's message */
export function buildingCatalog(objects: readonly (BuildingCatalogEntry & { id: string })[]): BuildingCatalogEntry[] {
  return objects
    .filter((o) => BUILDING_MODELS[o.id] || o.id === RETAINING_ASSET || o.id === MASS_ASSET)
    .map(({ id, category, height, file, triangles, lod, far, effects, footprint, box, doors }) => ({ id, category, height, file, triangles, lod, far, effects, footprint, box, doors }));
}

export interface BuildingOptions {
  /**
   * The asset catalogue: only its models are placed, and its triangles give
   * the scene cost. Without it every model of building-tags.ts is placed and
   * the cost is not held to the budget (a warning says so).
   */
  catalog?: readonly BuildingCatalogEntry[];
  /** Hears the share of the footprints gone through, now and then (the frame's progress, osm-progress.ts) */
  onShare?: (share: number) => void;
  /** Points of the scene budget the buildings may spend (default BUILDING_BUDGET_SHARE of SCENE_BUDGET) */
  budget?: number;
}

export interface BuildingReport {
  /** Footprints read (building areas on the ground) */
  footprints: number;
  /** Footprints that stand with at least one model, and the models placed */
  placed: number;
  objects: number;
  /** Buildings standing with a door, and of them those whose door is at the entrance OSM maps */
  doors: number;
  entrances: number;
  /** Footprints cut into several rectangles, and laid as rows of more than one model */
  split: number;
  /** Footprints raised from their own outline (no model covers them well enough, building-mass.ts) */
  masses: number;
  /** Of those, the ones raised as their OSM parts (`building:part`), and the parts (with the ones filling what they leave) */
  withParts: number;
  parts: number;
  /** Row modules at the end of their row, with windows in the gable no house abuts */
  rowEnds: number;
  /** Footprints in the old town, by why (old-town.ts): their own tags, an old-town area, inside the town wall, built densely */
  oldTown: { tags: number; area: number; wall: number; dense: number };
  rows: number;
  /** Footprints by kind */
  kinds: Partial<Record<BuildingKind, number>>;
  /** Landmarks by role (building-tags.ts landmarkRole), and the footprints built as ruins (`damage` 3 from the start) */
  landmarks: Partial<Record<LandmarkRole, number>>;
  ruins: number;
  /** Footprints (some part of them) that took another kind's models ("garage>carport"), or none ("shed>none") */
  fallbacks: Record<string, number>;
  /** Footprints left out and why */
  dropped: Record<FootprintDrop, number>;
  /** Models shrunk off a road */
  shrunk: number;
  /** Pads cut into the slope, the deepest cut (m), retaining walls */
  pads: number;
  deepestCutM: number;
  retainingWalls: number;
  /** Buildings standing over a basement (MapObject.basement), the deepest (m) */
  basements: number;
  deepestBasementM: number;
  /** Scene points the buildings spend, and of the scene budget */
  cost: number;
  costShare: number;
  /**
   * What the catalogue lacks, most first: a kind with the size class of the
   * rectangles (whole footprints or their parts) none of its models fitted
   * (`house 10x4`), and how many
   */
  missing: { kind: string; count: number }[];
  /** How well the built follows the footprints from COVER_FROM m² (FootprintCover), each left out as none */
  coverage: CoverageReport;
  /** Openings cut where covered ways run through raised buildings (building-openings.ts), and the stretches left closed */
  openings: OpeningReport;
}

/**
 * How well the built follows OSM's footprints (docs/OSM_LANDMARKS_PLAN.md,
 * "Abdeckung"): per outer ring of COVER_FROM m² or more, the share of it
 * (less its courtyards) under the models' wall boxes or the raised
 * building's outline, and the share of its area the models' boxes stand
 * outside it. A footprint left out covers nothing
 */
export interface CoverageReport {
  footprints: number;
  /** Median of the covered shares (0 to 1) */
  median: number;
  /** Share of the footprints covered less than 70 % */
  below70: number;
  /** Share of the footprints whose models stand more than 10 % of its area outside it */
  overhang10: number;
}

/** A building's door: the middle of its foot on the wall (map metres) and the way out of it (unit) */
export interface BuildingDoor {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export interface BuildingResult {
  objects: MapObject[];
  /** Each standing building's door, by its area's id (OsmArea.id): its footpath starts there (plots.ts) */
  doors: Map<number, BuildingDoor>;
  report: BuildingReport;
  warnings: ImportNote[];
  /** The outer rings (of `features.areas`) left out and why, as `report.dropped` counts them: for osmFootprints */
  droppedRings: Map<readonly MapPoint[], FootprintDrop>;
}

/**
 * Share of SCENE_BUDGET the buildings may spend. Off for now (user,
 * 2026-10-15): every footprint stands, the report still gives the cost;
 * 0.6 held Stuttgart to about 2 450 of 7 900 footprints. Set a share (or
 * pass `budget`) to bring the cap back.
 */
export const BUILDING_BUDGET_SHARE = Infinity;
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
/** Kinds whose model keeps its front, the door, on the street whenever a model fits that way */
const DOOR_ON_STREET: ReadonlySet<BuildingKind> = new Set(['house', 'semi', 'terrace']);

/**
 * Entrances OSM maps on building outlines (`entrance`), by how much they say
 * where the door is: the main entrance first; service, exits and emergency
 * doors give no front
 */
const ENTRANCE_RANKS: Readonly<Record<string, number>> = { main: 0, yes: 1, home: 1, staircase: 1 };
/** Metres an entrance may lie off its building's outline (the node is on it; a cut outline moved it) */
const ENTRANCE_REACH = 1;
/** Metres a door of a raised building keeps from the corners of its wall, and how long that wall is at least */
const DOOR_CORNER = 1.2;
const DOOR_WALL = DOOR_CORNER * 2 + 0.2;
/** Kinds with no door to walk in by (a carport, a car park, a transformer): no door drawn, no footpath, unless OSM maps one */
const NO_DOOR: ReadonlySet<BuildingKind> = new Set(['garage', 'carport', 'canopy', 'parking', 'transformer', 'gate', 'monument']);

/** What a model with its door on a side (doorSide) costs laid with that side off the street, against its turn to it */
const SIDE_DOOR = 0.05;

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
/** Metres beside a road's edge the cuts leave alone */
const ROAD_GUARD = 0.5;
/** Metres outside the front wall the ground before the entrance is read (the floor's height) */
const ENTRANCE_OUT = 1.5;
/** A building's floor stands at most this far (m) over its seat: the deepest basement */
const MAX_BASEMENT = 6;
/** A basement shallower than this (m) is none: the foundation covers it */
const BASEMENT_FROM = 0.15;
/** Metres beside the walls the hill is cut level with the floor (a yard behind a house dug into the slope) */
const YARD = 2;
/** Rise over run of the bank from the yard back up to the hill */
const BANK_SLOPE = 0.9;
/** A bank higher than this (m) is held by a retaining wall at the yard's edge instead */
const RETAINING_FROM = 2;
/** Metres of hill a retaining wall holds over the floor (its height less a coping's) */
const RETAINING_HOLD = 2.6;
const RETAINING_ASSET = 'retaining-wall';
/** Metres a retaining wall keeps from the HQ (the furniture's room round it) */
const RETAINING_HQ_CLEAR = 25;
/** The retaining wall's length and depth at scale 1 (m) */
const RETAINING_BOX: readonly [number, number] = [5.4, 1.2];
/** A side of a building faces up the hill when its normal lies this near the way up (cosine): only there retaining walls */
const UPHILL = 0.5;
/** Metres past a wall's yard the cut's bank reaches at most */
const BANK_REACH = 8;
/** The buildings within this (m) give a footprint the median size of its neighbourhood (buildingKind's `around`) */
const AROUND_REACH = 100;
/** Footprints smaller than this (m²) are no house of the neighbourhood (sheds, garages) */
const AROUND_FROM = 45;
/** What a model of a kind may lose to another (fit error) and still be drawn by the footprint's salt: houses vary */
const VARIETY = 0.08;
/** What a module (blank sides) standing alone costs in a kind that does not stand in rows: a narrow house only */
const LONE_MODULE = 0.1;
/**
 * Models stand for a footprint only where they fit it (docs/OSM_LANDMARKS_PLAN.md,
 * decision 1): covering at least MODEL_COVER of it and standing at most
 * MODEL_OVERHANG of its area outside it; else it is raised from its outline
 * (building-mass.ts), and the models stay only where that cannot stand
 */
const MODEL_COVER = 0.85;
const MODEL_OVERHANG = 0.1;
/** Footprints from this size (m²) count in the coverage report */
const COVER_FROM = 40;
/** A footprint filling less of its turned rectangle than this has wings (buildingKind's `winged`) */
const WINGED_FILL = 0.6;
/**
 * Tints of the small buildings, one per footprint by its id (white walls to
 * cream and sand, the red and anthracite roofs to brown and grey). Instance
 * colours: no draw call more
 */
const BUILDING_TINTS: readonly (string | null)[] = [null, null, null, '#f6eee2', '#efe5d6', '#f3e3cb', '#e4ddd5', '#e9d6c2', '#dcd2c6'];
const TINTED_KINDS: ReadonlySet<BuildingKind> = new Set(['house', 'semi', 'terrace', 'garage', 'shed', 'farm']);

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
  /** The side its door is in, where that is not its front (a model turned to show it to the street, frontFor) */
  doorFace?: MapPoint;
  model: BuildingModel;
  /** A building raised from the footprint (asset MASS_ASSET) instead of a model */
  mass?: MapMass;
}

interface Footprint {
  id: number;
  /** Its outer ring in `features` */
  ring: readonly MapPoint[];
  kind: BuildingKind;
  area: number;
  centre: MapPoint;
  placements: Placement[];
  cost: number;
  /** The tint of its models, null for none */
  tint: string | null;
  /** A ruin in OSM: it starts the run fallen (MapObject.damage 3, the ruins of destroyed buildings) */
  ruin: boolean;
  /** The entrance OSM maps on its outline (EntranceIndex), null for none */
  entrance: MapPoint | null;
}

/**
 * Every footprint OSM has in the frame, as it has it: each outer ring with
 * its courtyards, storeys and kind (footprintKindOf: also parts, those
 * below or off the ground), and why the import built nothing on one
 * (`dropped`, placeBuildings). What the map keeps for the developer layer
 * that lays them over the buildings made of them (TODO E290)
 */
export function osmFootprints(features: OsmFeatures, dropped: ReadonlyMap<readonly MapPoint[], FootprintDrop> = new Map()): MapFootprints {
  const rings: FootprintRing[] = [];
  for (const area of features.areas) {
    const kind = footprintKindOf(area.tags);
    if (!kind) continue;
    const levels = buildingLevels(area.tags);
    const minLevel = buildingMinLevel(area.tags);
    for (const points of area.outer) {
      const holes = area.inner.filter((r) => pointInRing(r[0], points));
      rings.push({ points, holes, levels, minLevel, kind, dropped: dropped.get(points) ?? null });
    }
  }
  return packFootprints(rings);
}

/** The buildings of `features` placed on `doc` (after the roads and the HQ): objects to add, the ground levelled under them */
export function placeBuildings(doc: CustomMapDocument, features: OsmFeatures, options: BuildingOptions = {}): BuildingResult {
  const report: BuildingReport = {
    footprints: 0,
    placed: 0,
    objects: 0,
    doors: 0,
    entrances: 0,
    split: 0,
    masses: 0,
    withParts: 0,
    parts: 0,
    rowEnds: 0,
    oldTown: { tags: 0, area: 0, wall: 0, dense: 0 },
    rows: 0,
    kinds: {},
    landmarks: {},
    ruins: 0,
    fallbacks: {},
    dropped: { tiny: 0, noModel: 0, roads: 0, water: 0, hq: 0, budget: 0 },
    shrunk: 0,
    pads: 0,
    deepestCutM: 0,
    retainingWalls: 0,
    basements: 0,
    deepestBasementM: 0,
    cost: 0,
    costShare: 0,
    missing: [],
    coverage: { footprints: 0, median: 0, below70: 0, overhang10: 0 },
    openings: { passages: 0, arches: 0, garages: 0, closed: 0 },
  };
  // Per footprint of COVER_FROM m² or more: its covered share and the models' share outside it
  const covered: number[] = [];
  const outside: number[] = [];
  const measure = (ringA: number, cover: number, over: number) => {
    if (ringA < COVER_FROM) return;
    covered.push(cover);
    outside.push(over);
  };
  const warnings: ImportNote[] = [];
  const catalog = options.catalog ? new Map(options.catalog.map((e) => [e.id, e])) : null;
  if (!catalog) warnings.push({ key: 'noCatalogue' });
  const known = (asset: string) => !catalog || catalog.has(asset);
  const roads = new SegmentIndex(doc);
  // The editor's check of objects on roads, with the catalogue's ground of each model (the model's walls without one)
  const edges = new EdgeIndex(doc.paths);
  const footings = new Map<string, ObjectFooting>();
  const footingOf = (asset: string): ObjectFooting => {
    let f = footings.get(asset);
    if (!f) footings.set(asset, (f = buildingFooting(asset, catalog?.get(asset))));
    return f;
  };
  const onRoad = (o: Pick<MapObject, 'asset' | 'x' | 'y' | 'rotation' | 'scale' | 'mass'>): boolean =>
    objectsOnPaths({ ...doc, objects: [{ id: 'probe', z: 0, ...o }] }, { blocksBuild: () => true, footingOf }, edges).length > 0;
  const lands = new AreaIndex(features.areas.filter((a) => buildingLandOf(a.tags) !== null));
  // A castle mapped as its grounds: the buildings in it take its role (building-tags.ts buildingRole)
  const compounds = new AreaIndex(features.areas.filter((a) => isCompoundTags(a.tags)));
  const waters = new AreaIndex(features.areas.filter((a) => isWaterTags(a.tags)));
  const missing = new Map<string, number>();
  const footprints: Footprint[] = [];
  const around = new AroundIndex(features.areas.filter((a) => a.tags['building'] && isGroundBuilding(a.tags) && a.area >= AROUND_FROM));
  const oldTown = findOldTown(features, doc.terrain.width);
  report.oldTown = oldTown.reasons;

  const droppedRings = new Map<readonly MapPoint[], FootprintDrop>();
  const partsOf = partsByOutline(features);
  // The covered ways through buildings: those buildings raised from their outline, their walls opened (building-openings.ts)
  const coveredWays = new CoveredWays(doc);
  const entrances = new EntranceIndex(features.points);
  // A model with no door on its front turns the side its door is in to the street (kiosk, annex, small shop)
  const doorSide = (asset: string): DoorSide => {
    const doors = catalog?.get(asset)?.doors;
    return !doors?.length || doors.some((d) => d[2] === 'front') ? 'front' : doors[0][2];
  };
  let seen = 0;
  for (const area of features.areas) {
    if (options.onShare && ++seen % 256 === 0) options.onShare((0.9 * seen) / features.areas.length);
    if (!area.tags['building'] || !isGroundBuilding(area.tags)) continue;
    report.footprints++;
    if (area.area < MIN_AREA) {
      report.dropped.tiny++;
      for (const outer of area.outer) droppedRings.set(outer, 'tiny');
      continue;
    }
    for (const outer of area.outer) {
      const holes = area.inner.filter((r) => pointInRing(r[0], outer));
      const ringA = Math.abs(ringArea(outer)) - holes.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
      if (ringA < MIN_AREA) {
        report.dropped.tiny++;
        droppedRings.set(outer, 'tiny');
        continue;
      }
      const rect = minAreaRect(outer);
      const centre = rect.c;
      const land = (lands.at(centre)?.tags ?? null) as Record<string, string> | null;
      const aspect = Math.max(rect.a, rect.b) / Math.max(0.1, Math.min(rect.a, rect.b));
      const fill = ringA / (rect.a * rect.b);
      const median = around.median(centre, AROUND_REACH);
      const role = buildingRole(area.tags, ringA, compounds.at(centre)?.tags ?? null);
      const inOldTown = oldTown.has(centre, area.tags, median);
      const kind = buildingKind(area.tags, ringA, aspect, land ? buildingLandOf(land) : null, median, holes.length > 0 || fill < WINGED_FILL, inOldTown, role);
      report.kinds[kind] = (report.kinds[kind] ?? 0) + 1;
      if (role.landmark) report.landmarks[role.landmark] = (report.landmarks[role.landmark] ?? 0) + 1;
      // OSM's parts of it (Simple 3D Buildings): raised as them; the models only where that cannot stand (as below)
      const ownParts = partsOf.get(outer) ?? [];
      // A ruin is raised from its outline and falls (the ruins of the raised buildings, no model's)
      const parts = role.ruin ? [] : fill < FILL_SPLIT ? splitFootprint(outer, holes, rect, ringA) : [rect];
      if (parts.length > 1) report.split++;
      const levels = buildingLevels(area.tags);
      const placements: Placement[] = [];
      const took = new Set<BuildingKind | null>();
      // A mapped entrance gives the part it is on its front
      const entrance = entrances.on(outer);
      const entered = entrance ? parts.reduce((best, part) => (rectReach(part, entrance) < rectReach(best, entrance) ? part : best), parts[0]) : null;
      for (const part of parts) {
        const laid = layPart(part, kind, levels, roads, known, area.id, report, part === entered ? entrance : null, doorSide);
        took.add(laid?.kind ?? null);
        if (laid) placements.push(...laid.placements);
        // The catalogue lacks this kind at this size: the part took another kind's models, or none (a landmark
        // without models of its own is raised by intent)
        if (laid?.kind !== kind && KIND_MODELS[kind].models.length) {
          const key = `${kind} ${sizeClass(part.a, part.b)}`;
          missing.set(key, (missing.get(key) ?? 0) + 1);
        }
      }
      for (const k of took) if (k !== kind) report.fallbacks[`${kind}>${k ?? 'none'}`] = (report.fallbacks[`${kind}>${k ?? 'none'}`] ?? 0) + 1;
      // Clear of water, roads and the HQ
      const kept: Placement[] = [];
      let why: 'water' | 'roads' | 'hq' | null = null;
      for (const pl of placements) {
        if (boxCorners(pl).some((q) => waters.at(q) !== null || waterLevelAt(doc.terrain, q.x, q.y, heightAt(doc.terrain, q.x, q.y)) !== null)) {
          why = 'water';
          continue;
        }
        // The room round the HQ takes no landmark (decision 4): the HQ stands where the player put it, the landmark too
        if (!role.landmark && boxDistance(pl, doc.hq) < HQ_CLEAR) {
          why = 'hq';
          continue;
        }
        const clear = clearOfRoads(pl, onRoad);
        if (!clear) {
          why = 'roads';
          continue;
        }
        if (clear === 'shrunk') report.shrunk++;
        kept.push(pl);
      }
      // How the models fit the footprint: raised from its outline instead where they fit badly and that stands
      const cover = kept.length ? coverage(outer, holes, rect, (q) => kept.some((pl) => inBox(pl, q))) : 0;
      const over = kept.length ? overhang(outer, holes, kept, ringA) : 0;
      // A covered way through it (a passage, a car park's entrance): raised from its outline, its walls open there
      const passage = coveredWays.through(outer, holes);
      const raised = cover >= MODEL_COVER && over <= MODEL_OVERHANG && !ownParts.length && !passage
        ? null
        : raiseMass(outer, holes, rect, kind, area.tags, ringA, hashId(area.id), inOldTown, ownParts);
      if (raised) {
        const pl: Placement = {
          asset: MASS_ASSET,
          p: raised.centre,
          front: raised.front,
          hw: raised.hw,
          hd: raised.hd,
          scale: 1,
          rotation: raised.rotation,
          model: { asset: MASS_ASSET, box: [raised.hw * 2, raised.hd * 2], floors: raised.mass.floors },
          mass: raised.mass,
        };
        const blocked = massBlocked(pl, raised.mass, outer, doc, waters, roads, onRoad, !role.landmark);
        if (!blocked) {
          report.masses++;
          if (pl.scale < 1) report.shrunk++;
          if (role.ruin) report.ruins++;
          if (raised.mass.parts) {
            report.withParts++;
            report.parts += raised.mass.parts.length;
          }
          const cost = costOf(MASS_ASSET, catalog, doc) + massTriangles(raised.mass);
          footprints.push({ id: area.id, ring: outer, kind, area: ringA, centre, placements: [pl], cost, tint: raised.tint, ruin: role.ruin, entrance });
          measure(ringA, ringA >= COVER_FROM ? coverage(outer, holes, rect, (q) => inMass(pl, raised.mass, q)) : 0, 0);
          continue;
        }
        why ??= blocked;
      }
      if (!placements.length) {
        report.dropped[why ?? 'noModel']++;
        droppedRings.set(outer, why ?? 'noModel');
        measure(ringA, 0, 0);
        continue;
      }
      if (!kept.length) {
        report.dropped[why ?? 'roads']++;
        droppedRings.set(outer, why ?? 'roads');
        measure(ringA, 0, 0);
        continue;
      }
      // The models that are left where the raised building cannot stand (water), however they fit
      measure(ringA, cover, over);
      const cost = kept.reduce((s, pl) => s + costOf(pl.asset, catalog, doc), 0);
      footprints.push({ id: area.id, ring: outer, kind, area: ringA, centre, placements: kept, cost, tint: TINTED_KINDS.has(kind) ? BUILDING_TINTS[hashId(area.id) % BUILDING_TINTS.length] : null, ruin: false, entrance });
    }
  }

  // Scene cost: past the budget, the smallest footprints far from the HQ go first
  const budget = options.budget ?? BUILDING_BUDGET_SHARE * SCENE_BUDGET;
  let cost = footprints.reduce((s, f) => s + f.cost, 0);
  if (catalog && Number.isFinite(budget) && cost > budget) {
    const worth = (f: Footprint) => f.area / (1 + Math.hypot(f.centre.x - doc.hq.x, f.centre.y - doc.hq.y) / 400);
    const order = [...footprints].sort((p, q) => worth(p) - worth(q));
    const gone = new Set<Footprint>();
    for (const f of order) {
      if (cost <= budget) break;
      gone.add(f);
      cost -= f.cost;
    }
    report.dropped.budget = gone.size;
    for (const f of gone) droppedRings.set(f.ring, 'budget');
    if (gone.size) warnings.push({ key: 'buildingsLeftOut', v: { count: gone.size, percent: Math.round((budget / SCENE_BUDGET) * 100) } });
    footprints.splice(0, footprints.length, ...footprints.filter((f) => !gone.has(f)));
  }

  // Pads, retaining walls and the objects
  const guard = roadGuard(doc);
  const boxes = new BoxIndex(footprints.flatMap((f) => f.placements));
  // The end of a row: a module whose blank gable no house abuts takes the model with windows on that side
  for (const f of footprints) {
    for (const pl of f.placements) {
      const ends = ROW_ENDS[pl.asset];
      if (!ends) continue;
      const west = !abutted(pl, -1, boxes);
      const east = !abutted(pl, 1, boxes);
      const end = west && east ? ends.both : west ? ends.w : east ? ends.e : null;
      if (!end || !known(end)) continue;
      // The open gable's verge reaches a little further: not onto a road
      if (onRoad({ asset: end, ...origin(pl), rotation: pl.rotation, scale: pl.scale })) continue;
      pl.asset = end;
      pl.model = BUILDING_MODELS[end];
      report.rowEnds++;
    }
  }
  const objects: MapObject[] = [];
  let n = 0;
  // The floors are read off the hill as it was, before any building's cut: a neighbour's yard leaves an entrance be
  const hill: CustomMapDocument['terrain'] = { ...doc.terrain, grid: { ...doc.terrain.grid, heights: doc.terrain.grid.heights.slice() } };
  const standing: { object: MapObject; floor: number }[] = [];
  // Walls other buildings stand against (party walls): a sloped roof ends there in a gable (building-mass.ts shareWalls)
  const neighbours = new FootprintGrid(footprints);
  const doors = new Map<number, BuildingDoor>();
  for (const f of footprints) {
    const group = `osm-b${f.id}`;
    // Its door: where its footpath starts (plots.ts), a raised building's drawn there (MapMass.door)
    const door = f.ruin ? null : footprintDoor(f, catalog, roads);
    if (door && !doors.has(f.id)) {
      doors.set(f.id, door);
      report.doors++;
      if (f.entrance) report.entrances++;
    }
    for (const pl of f.placements) {
      if (pl.mass && !pl.mass.parts) {
        const o = { x: round2(origin(pl).x), y: round2(origin(pl).y), rotation: round3(pl.rotation), scale: round3(pl.scale) };
        shareWalls(pl.mass, partyWalls(pl.mass, o, neighbours, f));
      }
      const entry = catalog?.get(pl.asset);
      const object: MapObject = {
        id: `osm-b${++n}`,
        asset: pl.asset,
        x: round2(origin(pl).x),
        y: round2(origin(pl).y),
        z: 0,
        rotation: round3(pl.rotation),
        scale: round3(pl.scale),
        ...(f.tint ? { tint: f.tint } : {}),
        group,
        ...(pl.mass ? { mass: pl.mass } : {}),
        ...(f.ruin ? { damage: 3 as const } : {}),
      };
      // The covered ways through it open its walls (building-openings.ts); a car park's ramp before its entrance is
      // no ground it stands on (object-mass.ts massOnRamp)
      const mass = pl.mass;
      const openings = mass ? massOpenings(mass, object, coveredWays, report.openings) : [];
      if (mass && openings.length) mass.openings = openings;
      const onRamp = mass?.openings ? (x: number, y: number) => onRampAt(object, mass, x, y) : undefined;
      // On a slope: its floor at the ground before its entrance, the hill behind it cut to that, a basement under
      // it towards the valley. A way into it (a passage, a car park's ramp: their floors count from the seat) and a
      // ruin stand on the lowest ground
      const floor = mass
        ? floorLevel(hill, pl, massRadius(mass), massBox(mass), onRamp, !openings.length && !f.ruin)
        : floorLevel(hill, pl, entry?.footprint ?? Math.max(pl.model.box[0], pl.model.box[1]) * 0.45, entry?.box, undefined, true);
      const cut = cutSlope(doc, pl, floor, guard, known(RETAINING_ASSET) ? onRoad : null, boxes);
      if (cut.depth > 0.05) report.pads++;
      report.deepestCutM = Math.max(report.deepestCutM, round1(cut.depth));
      objects.push(object);
      standing.push({ object, floor });
      for (const w of cut.walls) {
        objects.push({ id: `osm-b${++n}`, ...w, group });
        report.retainingWalls++;
      }
    }
    report.placed++;
  }
  // Each building over its seat on the ground as all the cuts left it, as the renderer seats it: lifted to its floor
  // over a basement where the hill falls away under it
  const ground = (x: number, y: number) => heightAt(doc.terrain, x, y);
  for (const { object, floor } of standing) {
    const mass = object.mass;
    const seat = seatHeight(mass ? { category: 'building', footprint: 1, height: mass.height } : footingOf(object.asset), object, ground, () => null);
    const basement = round2(floor - seat);
    if (basement >= BASEMENT_FROM) {
      object.z = basement;
      object.basement = basement;
      report.basements++;
      report.deepestBasementM = Math.max(report.deepestBasementM, round1(basement));
    }
    // Its car park entrances' floors under the seat, where the ramps meet the wall
    if (mass?.openings?.some((o) => o.kind === 'garage')) garageFloors(mass.openings, object, doc.terrain, seat);
  }
  report.objects = objects.length;
  report.cost = Math.round(objects.reduce((s, o) => s + costOf(o.asset, catalog, doc) + (o.mass ? massTriangles(o.mass) : 0), 0));
  report.costShare = Math.round((report.cost / SCENE_BUDGET) * 1000) / 1000;
  report.missing = [...missing.entries()].sort((p, q) => q[1] - p[1]).map(([kind, count]) => ({ kind, count }));
  report.coverage = coverageReport(covered, outside);
  return { objects, doors, report, warnings, droppedRings };
}

function costOf(asset: string, catalog: ReadonlyMap<string, BuildingCatalogEntry> | null, doc: CustomMapDocument): number {
  return catalog ? objectCost(catalog.get(asset), doc.terrain.width * doc.terrain.depth) : 0;
}

/** `natural=water`, riverbanks, basins: no building stands in them */
function isWaterTags(tags: Readonly<Record<string, string>>): boolean {
  return tags['natural'] === 'water' || tags['waterway'] === 'riverbank' || tags['landuse'] === 'basin' || tags['landuse'] === 'reservoir' || !!tags['water'];
}

// ---- Raised buildings ----

/** The footprints that stand, on a grid of their bounds, with how high they stand: which one holds a point */
class FootprintGrid {
  private static readonly CELL = 40;
  private readonly cells = new Map<number, Footprint[]>();
  /** Per footprint its top (a raised building's, a model's about by its storeys and a roof) and its bounds */
  private readonly of = new Map<Footprint, { top: number; minX: number; maxX: number; minY: number; maxY: number }>();

  constructor(footprints: readonly Footprint[]) {
    const c = FootprintGrid.CELL;
    for (const f of footprints) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const p of f.ring) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
      const top = Math.max(...f.placements.map((pl) => (pl.mass ? massTop(pl.mass) : pl.model.floors * 3.1 + 3) * pl.scale));
      this.of.set(f, { top, minX, maxX, minY, maxY });
      for (let i = Math.floor(minX / c); i <= Math.floor(maxX / c); i++) {
        for (let j = Math.floor(minY / c); j <= Math.floor(maxY / c); j++) {
          const key = i * 100003 + j;
          const list = this.cells.get(key);
          if (list) list.push(f);
          else this.cells.set(key, [f]);
        }
      }
    }
  }

  /** Whether a footprint other than `self`, standing at least `least` high, holds the point */
  holds(p: MapPoint, self: Footprint, least: number): boolean {
    const c = FootprintGrid.CELL;
    for (const f of this.cells.get(Math.floor(p.x / c) * 100003 + Math.floor(p.y / c)) ?? []) {
      const b = this.of.get(f)!;
      if (f === self || b.top < least || p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
      if (pointInRing(p, f.ring)) return true;
    }
    return false;
  }
}

/**
 * The walls of a raised building's outline another standing footprint lies
 * against (MapMass.shared), the building placed as `o`: one standing half way
 * up its roof at least (a lower one leaves its slopes free, no bare gable
 * stands high over a shed)
 */
function partyWalls(mass: MapMass, o: Pick<MapObject, 'x' | 'y' | 'rotation' | 'scale'>, grid: FootprintGrid, self: Footprint): number[] {
  const cos = Math.cos(o.rotation);
  const sin = Math.sin(o.rotation);
  const s = o.scale || 1;
  const least = (mass.height + 0.5 * (mass.ridge ?? 0)) * s;
  // Model (x, z) to the map: the inverse of toModel (object-ground.ts)
  return sharedWalls(mass.rings[0], (x, z) => grid.holds({ x: o.x - (x * cos + z * sin) * s, y: o.y - x * sin * s + z * cos * s }, self, least));
}

/**
 * Share of a footprint (outer less holes) the built covers (`covers`, a map
 * point): points on a raster of its rectangle, about 300 of them on the
 * footprint
 */
function coverage(outer: readonly MapPoint[], holes: readonly MapPoint[][], rect: Rect, covers: (q: MapPoint) => boolean): number {
  const cell = Math.max(0.4, Math.sqrt((rect.a * rect.b) / 300));
  const v = { x: -rect.u.y, y: rect.u.x };
  let inside = 0;
  let covered = 0;
  for (let sv = -rect.b / 2 + cell / 2; sv < rect.b / 2; sv += cell) {
    for (let su = -rect.a / 2 + cell / 2; su < rect.a / 2; su += cell) {
      const q = { x: rect.c.x + su * rect.u.x + sv * v.x, y: rect.c.y + su * rect.u.y + sv * v.y };
      if (!pointInRing(q, outer) || holes.some((h) => pointInRing(q, h))) continue;
      inside++;
      if (covers(q)) covered++;
    }
  }
  return inside ? covered / inside : 0;
}

/**
 * Share of a footprint's area (`area`, m²) the models' wall boxes stand
 * outside it (beyond its outline or in a courtyard): points on a raster of
 * each box, about 150 of them per box, a point under an earlier box once
 */
function overhang(outer: readonly MapPoint[], holes: readonly MapPoint[][], kept: readonly Placement[], area: number): number {
  let out = 0;
  kept.forEach((pl, k) => {
    const cell = Math.max(0.3, Math.sqrt((4 * pl.hw * pl.hd) / 150));
    const f = pl.front;
    const r = rightOf(f);
    for (let t = -pl.hd + cell / 2; t < pl.hd; t += cell) {
      for (let s = -pl.hw + cell / 2; s < pl.hw; s += cell) {
        const q = { x: pl.p.x + r.x * s + f.x * t, y: pl.p.y + r.y * s + f.y * t };
        if (pointInRing(q, outer) && !holes.some((h) => pointInRing(q, h))) continue;
        if (kept.some((o, j) => j < k && inBox(o, q))) continue;
        out += cell * cell;
      }
    }
  });
  return area > 0 ? out / area : 0;
}

/** Whether map point `q` lies in a placement's wall box */
function inBox(pl: Placement, q: MapPoint): boolean {
  const b = toBox(pl, q);
  return Math.abs(b.s) <= pl.hw && Math.abs(b.t) <= pl.hd;
}

/**
 * Whether map point `q` lies under a raised building (its outline less its
 * courtyards, at its scale; with parts, under one of them: what is built)
 */
function inMass(pl: Placement, mass: MapMass, q: MapPoint): boolean {
  const m = toModel(q.x - pl.p.x, q.y - pl.p.y, Math.cos(pl.rotation), Math.sin(pl.rotation));
  return massBodies(mass).some((b) => ringsContain(b.rings, m.x / pl.scale, m.z / pl.scale));
}

/** The coverage report of the footprints' covered shares and the models' shares outside them */
function coverageReport(covered: readonly number[], outside: readonly number[]): CoverageReport {
  const n = covered.length;
  if (!n) return { footprints: 0, median: 0, below70: 0, overhang10: 0 };
  const sorted = [...covered].sort((a, b) => a - b);
  const share = (count: number) => Math.round((count / n) * 1000) / 1000;
  return {
    footprints: n,
    median: Math.round(sorted[n >> 1] * 1000) / 1000,
    below70: share(covered.filter((c) => c < 0.7).length),
    overhang10: share(outside.filter((o) => o > 0.1).length),
  };
}

/** Metres off a module's gable within which another building counts as abutting it */
const ABUT_REACH = 0.8;

/**
 * Whether another building stands against a placement's gable on the model's
 * west (`side` -1, model -x) or east (+1): one of three points just off that
 * wall (its middle and towards front and back) lies in another wall box
 */
function abutted(pl: Placement, side: -1 | 1, boxes: BoxIndex): boolean {
  const { f, x } = placementAxes(pl);
  for (const t of [-0.5, 0, 0.5]) {
    const q = { x: pl.p.x + x.x * side * (pl.hw + ABUT_REACH) + f.x * pl.hd * t, y: pl.p.y + x.y * side * (pl.hw + ABUT_REACH) + f.y * pl.hd * t };
    if (boxes.near(q).some((o) => o !== pl && boxDistance(o, q) < ABUT_REACH * 0.5)) return true;
  }
  return false;
}

/** Why a raised building cannot stand (its outline in water, at the HQ unless `clearOfHq` is off: a landmark, on a road), null when it can */
function massBlocked(
  pl: Placement,
  mass: MapMass,
  outer: readonly MapPoint[],
  doc: CustomMapDocument,
  waters: AreaIndex,
  roads: SegmentIndex,
  onRoad: (o: Pick<MapObject, 'asset' | 'x' | 'y' | 'rotation' | 'scale' | 'mass'>) => boolean,
  clearOfHq = true,
): 'water' | 'hq' | 'roads' | null {
  if (outer.some((q) => waters.at(q) !== null || waterLevelAt(doc.terrain, q.x, q.y, heightAt(doc.terrain, q.x, q.y)) !== null)) return 'water';
  const hq = toModel(doc.hq.x - pl.p.x, doc.hq.y - pl.p.y, Math.cos(pl.rotation), Math.sin(pl.rotation));
  if (clearOfHq && massDistance(mass, hq.x, hq.z) < HQ_CLEAR) return 'hq';
  // Over a road: its walls cut back from the roads, then shrunk about its middle as far as a model may (MASS_SHRINK);
  // where that leaves less than half of it, cut back further (CLIP_LEAST): never worse than the models it replaces
  const cos = Math.cos(pl.rotation);
  const sin = Math.sin(pl.rotation);
  const local = (g: { a: MapPoint; b: MapPoint; half: number }) => {
    const a = toModel(g.a.x - pl.p.x, g.a.y - pl.p.y, cos, sin);
    const b = toModel(g.b.x - pl.p.x, g.b.y - pl.p.y, cos, sin);
    return { ax: a.x, az: a.z, bx: b.x, bz: b.z, half: g.half + ROAD_GUARD };
  };
  const pieces = roads.blocking(pl.p, massRadius(mass) + 40).map(local);
  // A passage that runs along its wall, not through it (an alley between two houses OSM maps on their party wall):
  // the walls keep off it as off any way, else the alley runs into them
  const radius = massRadius(mass);
  for (const g of roads.coveredNear(pl.p, radius + 40)) {
    const piece = local(g);
    // Only pieces that come near the building's ground at all (its circle round the origin)
    if (pointSegment({ x: 0, y: 0 }, { x: piece.ax, y: piece.az }, { x: piece.bx, y: piece.bz }) > radius + piece.half) continue;
    if (alongWalls(mass, piece)) pieces.push(piece);
  }
  const rings = mass.rings;
  const parts = mass.parts;
  const restore = () => {
    mass.rings = rings;
    if (parts) mass.parts = parts;
  };
  for (const keep of [CLIP_KEEP, CLIP_LEAST]) {
    restore();
    // Cut back further only to what is still a house
    const clipped = clipOffRoads(mass, pieces, keep);
    if (keep < CLIP_KEEP && (!clipped || massArea(mass) < CLIPPED_LEAST_M2)) continue;
    for (const scale of MASS_SHRINK) {
      if (!onRoad({ asset: pl.asset, x: pl.p.x, y: pl.p.y, rotation: pl.rotation, scale, mass })) {
        pl.scale = scale;
        pl.hw *= scale;
        pl.hd *= scale;
        return null;
      }
    }
  }
  restore();
  return 'roads';
}

/**
 * Whether a piece of a passage (model x, z with its half width) runs along a
 * raised building's walls rather than under it: it comes within its half
 * width of the building, its line on the walls or outside them (OSM maps an
 * alley between two houses on their party wall). One inside, under the
 * building (a passage through it, an arcade behind its front), opens its
 * walls instead or stays under it (building-openings.ts)
 */
function alongWalls(mass: MapMass, piece: { ax: number; az: number; bx: number; bz: number; half: number }): boolean {
  const deep = 0.3;
  let near = false;
  for (const t of [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1]) {
    const x = piece.ax + (piece.bx - piece.ax) * t;
    const z = piece.az + (piece.bz - piece.az) * t;
    const inside = ringsContain(mass.rings, x, z);
    const d = inside ? wallDistance(mass.rings, x, z) : massDistance(mass, x, z);
    if (inside && d > deep) return false;
    if (inside || d < piece.half) near = true;
  }
  return near;
}

/** Distance from model point (x, z) to the nearest wall of `rings` */
function wallDistance(rings: readonly (readonly number[])[], x: number, z: number): number {
  let best = Infinity;
  for (const r of rings) {
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const dx = r[i] - r[j];
      const dz = r[i + 1] - r[j + 1];
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - r[j]) * dx + (z - r[j + 1]) * dz) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - r[j] - t * dx, z - r[j + 1] - t * dz));
    }
  }
  return best;
}

/** Ground (m²) a raised building cut back past CLIP_KEEP keeps at least */
const CLIPPED_LEAST_M2 = 20;
/** Scales a raised building tries off a road */
const MASS_SHRINK = [1, 0.95, 0.9, 0.85, 0.8];

// ---- Shape ----

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
  /** A model with its door on a side (doorSide), laid with that side to the street: its depth along the front */
  turned: boolean;
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
  doorSide: (asset: string) => DoorSide = () => 'front',
): Fit | null {
  let best: Fit | null = null;
  const models = KIND_MODELS[kind].models.filter((m) => known(m) && BUILDING_MODELS[m]);
  models.forEach((asset, rank) => {
    const model = BUILDING_MODELS[asset];
    // High-rises only where the tags say so: a village's winery is no office tower
    if (levels === null && model.floors > UNTAGGED_FLOORS) return;
    // A model with its door on a side: as it stands (the door off the street) and turned to show it to the street
    const side = sideways(doorSide(asset));
    // A module in a kind that does not stand in rows (a terraced house among houses): alone, a narrow house
    const lone = model.module && !KIND_MODELS[kind].rows;
    // Its best fit, the door on the street preferred (SIDE_DOOR) among its own; against the other models by its error
    let own: { fit: Fit; rank: number } | null = null;
    for (const turned of side ? [false, true] : [false]) {
      const [w, d] = turned ? [model.box[1], model.box[0]] : model.box;
      for (let rows = 1; rows <= (lone ? 1 : 2); rows++) {
        const most = lone ? 1 : Math.min(MAX_COPIES, Math.max(1, Math.ceil(wide / (w * SCALE_MIN))));
        for (let copies = 1; copies <= most; copies++) {
          const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.min(wide / (copies * w), deep / (rows * d))));
          const cu = (copies * w * scale) / wide;
          const cv = (rows * d * scale) / deep;
          // Turned, only where it covers enough to stand as a model (MODEL_COVER): else the model as it stands
          if (turned && Math.min(cu, 1) * Math.min(cv, 1) < MODEL_COVER) continue;
          // A model bigger than the footprint costs twice: it stands in the street or the neighbour
          let error = Math.abs(Math.log(cu)) * (cu > 1 ? 2 : 1) + Math.abs(Math.log(cv)) * (cv > 1 ? 2 : 1);
          const extra = copies * rows - 1;
          // Copies: cheap for modules of a kind that stands in rows, dearer for a house cut in two
          error += extra * (model.module ? (KIND_MODELS[kind].rows ? 0.01 : 0.06) : 0.12) + (rows > 1 ? 0.12 : 0);
          if (levels !== null) error += Math.min(0.6, Math.abs(levels - model.floors) * 0.08);
          if (lone) error += LONE_MODULE;
          // A little order (the first model of the kind) and variety (the footprint's salt) among fits about as good
          error += rank * 0.01 + (((salt * 31 + rank * 17) % 7) / 7) * VARIETY;
          // Its door on a side off the street
          const mine = error + (side && !turned ? SIDE_DOOR : 0);
          if (!own || mine < own.rank) own = { fit: { model, copies, rows, scale, error, turned }, rank: mine };
        }
      }
    }
    if (own && (!best || own.fit.error < best.error)) best = own.fit;
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
  entrance: MapPoint | null = null,
  doorSide: (asset: string) => DoorSide = () => 'front',
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
  // A mapped entrance: the side it is on (the most out along a side's normal, by the depth behind it)
  if (entrance) {
    const out = (k: number) => ((entrance.x - rect.c.x) * sides[k].n.x + (entrance.y - rect.c.y) * sides[k].n.y) / sides[k].depth;
    front = 0;
    for (let k = 1; k < 4; k++) if (out(k) > out(front)) front = k;
  }
  // The other way round: the nearer of the two sides across the front
  const across = front < 2 ? (dists[2] <= dists[3] ? 2 : 3) : dists[0] <= dists[1] ? 0 : 1;

  // The kind's models with the front on the street, else on a side across it; else the next kind's
  let chosen: { fit: Fit; side: number; kind: BuildingKind } | null = null;
  for (let k: BuildingKind | undefined = kind, step = 0; k && step < 3 && !chosen; k = KIND_MODELS[k].fallback, step++) {
    const onFront = fitModels(k, sides[front].len, sides[front].depth, levels, known, salt, MAX_FIT_ERROR, doorSide);
    const onSide = fitModels(k, sides[across].len, sides[across].depth, levels, known, salt, MAX_FIT_ERROR, doorSide);
    // Turning the front away from the street costs; a house keeps its door on the street (its footpath, plots.ts), any
    // building on its mapped entrance
    if (onFront && (((DOOR_ON_STREET.has(k) || entrance) && onFront.error <= MAX_FIT_ERROR) || !onSide || onFront.error <= onSide.error + ACROSS_PENALTY)) chosen = { fit: onFront, side: front, kind: k };
    else if (onSide && onSide.error + ACROSS_PENALTY <= MAX_FIT_ERROR) chosen = { fit: onSide, side: across, kind: k };
    else if (onFront) chosen = { fit: onFront, side: front, kind: k };
  }
  if (!chosen && !KIND_MODELS[kind].own) {
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
  // The model's door side turned to the street (doorSide): a model with its door on a side stands across
  const door = doorSide(fit.model.asset);
  const turned = fit.turned;
  const mw = fit.model.box[turned ? 1 : 0] * fit.scale;
  const md = fit.model.box[turned ? 0 : 1] * fit.scale;
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
      let front = turned || door === 'back' ? frontFor(door, face) : face;
      if (row === 0 && end !== 0 && cornerAt(end)) {
        model = BUILDING_MODELS[corner];
        // Its second street side is its west (model -x, the front turned right): turned to face the row's end
        const toEnd = { x: s.along.x * end, y: s.along.y * end };
        const west = rightOf(face);
        if (west.x * toEnd.x + west.y * toEnd.y < 0) front = toEnd;
      }
      const scale = model === fit.model ? fit.scale : Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.min(mw / model.box[0], md / model.box[1])));
      out.push({ asset: model.asset, p, front, hw: (model.box[0] * scale) / 2, hd: (model.box[1] * scale) / 2, scale, rotation: Math.atan2(-front.x, front.y), model, ...(front !== face && model === fit.model ? { doorFace: face } : {}) });
    }
  }
  return { placements: out, kind: chosen.kind };
}

/** The side of a model its door is in, as the catalogue measured its doors (CatalogDoor) */
type DoorSide = CatalogDoor[2];

/** Whether a door's side runs along the model's depth (its east or west) */
function sideways(side: DoorSide): boolean {
  return side === 'east' || side === 'west';
}

/**
 * The model's front (local +z) that turns its door side to `face`: its
 * east (+x, the front turned left) to it, its west, its back, or the front
 * itself
 */
function frontFor(side: DoorSide, face: MapPoint): MapPoint {
  if (side === 'east') return rightOf(face);
  if (side === 'west') return { x: -face.y, y: face.x };
  if (side === 'back') return { x: -face.x, y: -face.y };
  return face;
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

function pointSegment(p: MapPoint, a: MapPoint, b: MapPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/**
 * The ground of a building model as the editor's check and the renderer take
 * it: the catalogue's footprint and ground rectangle, or without a catalogue
 * the model's measured walls (BUILDING_MODELS)
 */
function buildingFooting(asset: string, entry: BuildingCatalogEntry | undefined): ObjectFooting {
  if (entry) return { category: 'building', footprint: entry.footprint, height: entry.height ?? 6, box: entry.box };
  const model = BUILDING_MODELS[asset];
  const [w, d] = model ? model.box : asset === RETAINING_ASSET ? RETAINING_BOX : [4, 4];
  const [ax, az] = model?.at ?? [0, 0];
  return { category: 'building', footprint: Math.hypot(Math.abs(ax) + w / 2, Math.abs(az) + d / 2), height: 6, box: [ax, az, w / 2, d / 2] };
}

/** Shrinking steps for a model over a road, and the smallest scale it may reach */
const SHRINK_STEPS = [0.9, 0.8, 0.7];
const SHRINK_FLOOR = SCALE_MIN;

/**
 * Whether a placement stays off the roads: 'clear', or 'shrunk' when it had
 * to shrink about the back of its box (the front pulls back from the street,
 * down to SHRINK_FLOOR), false when it stays on one
 */
function clearOfRoads(pl: Placement, onRoad: (o: Pick<MapObject, 'asset' | 'x' | 'y' | 'rotation' | 'scale'>) => boolean): 'clear' | 'shrunk' | false {
  const touches = (q: Placement) => onRoad({ asset: q.asset, ...origin(q), rotation: q.rotation, scale: q.scale });
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
 * The floor a building stands at on a slope: the ground before its entrance
 * (ENTRANCE_OUT outside the middle of its front wall, on hill `t` as it
 * was), within the ground under its walls and at most MAX_BASEMENT over the
 * lowest of it. That lowest (its corners and the points the renderer seats
 * it by, the catalogue's footprint at scale 1 and ground rectangle,
 * object-seat.ts) for one without an `entrance`. A car park's ramp before
 * the building is no ground it stands on
 */
function floorLevel(
  t: CustomMapDocument['terrain'],
  pl: Placement,
  footprint: number,
  box: GroundBox | undefined,
  onRamp: ((x: number, y: number) => boolean) | undefined,
  entrance: boolean,
): number {
  const o = origin(pl);
  let low = heightAt(t, o.x, o.y);
  let high = low;
  for (const c of boxCorners(pl)) {
    if (onRamp?.(c.x, c.y)) continue;
    const h = heightAt(t, c.x, c.y);
    low = Math.min(low, h);
    high = Math.max(high, h);
  }
  // The samples round each seat point, not the ground between them: one beside a seat point under the floor would
  // pull the seat under it
  const ring = groundRing(footprint, box, { x: o.x, y: o.y, rotation: pl.rotation, scale: pl.scale });
  for (let k = 0; k < ring.length; k += 2) if (!onRamp?.(ring[k], ring[k + 1])) low = Math.min(low, lowestSample(t, ring[k], ring[k + 1]));
  if (!entrance) return low;
  // Before its door: the front, or the side its door is in (doorFace)
  const f = pl.doorFace ?? pl.front;
  const r = rightOf(f);
  const turned = !!pl.doorFace && Math.abs(f.x * pl.front.x + f.y * pl.front.y) < 0.5;
  const d = (turned ? pl.hw : pl.hd) + ENTRANCE_OUT;
  const half = turned ? pl.hd : pl.hw;
  let sum = 0;
  for (const u of [-0.3, 0, 0.3]) sum += heightAt(t, pl.p.x + f.x * d + r.x * half * 2 * u, pl.p.y + f.y * d + r.y * half * 2 * u);
  return Math.min(Math.max(sum / 3, low), high, low + MAX_BASEMENT);
}

/**
 * Cuts the hill round a building down to its floor: level under its walls
 * and YARD beyond them, then a bank rising at BANK_SLOPE back to the hill,
 * BANK_REACH past the yard at most. Along a side where the hill past the yard
 * stands more than RETAINING_FROM over the floor, retaining walls at the
 * yard's edge (their face to the building, the yard's width past the
 * corners) hold it instead and the bank rises from RETAINING_HOLD over the
 * floor behind them; a stretch where no wall can stand (a road, water, the
 * map's edge, the next building) keeps the bank. Never under a road or in
 * water, nothing filled: towards the valley the hill stays, the building's
 * basement shows there (MapObject.basement). Without `onRoad` no walls.
 * The walls and the deepest cut
 */
function cutSlope(
  doc: CustomMapDocument,
  pl: Placement,
  floor: number,
  guard: Uint8Array,
  onRoad: ((o: Pick<MapObject, 'asset' | 'x' | 'y' | 'rotation' | 'scale'>) => boolean) | null,
  boxes: BoxIndex,
): { depth: number; walls: Omit<MapObject, 'id'>[] } {
  const t = doc.terrain;
  const g = t.grid;
  const f = pl.front;
  const r = rightOf(f);
  const [wl, wd] = RETAINING_BOX;
  // Each side: its outward normal and the way along it, which of the box's coordinates (toBox: s along r, t along f)
  // runs across it and with what sign, its half length, its distance from the middle; its walls' stretches
  const sides = [
    { n: f, along: r, across: 't' as const, sign: 1, half: pl.hw, off: pl.hd },
    { n: { x: -f.x, y: -f.y }, along: r, across: 't' as const, sign: -1, half: pl.hw, off: pl.hd },
    { n: r, along: f, across: 's' as const, sign: 1, half: pl.hd, off: pl.hw },
    { n: { x: -r.x, y: -r.y }, along: f, across: 's' as const, sign: -1, half: pl.hd, off: pl.hw },
  ].map((side) => {
    const run = side.half * 2 + YARD * 2;
    const count = Math.max(1, Math.round(run / wl));
    return { ...side, run, count, held: new Array<boolean>(count).fill(false) };
  });
  const walls: Omit<MapObject, 'id'>[] = [];
  // Walls only across the slope, on the sides facing up the hill: along it the bank runs down beside the building
  const mid = (d: MapPoint, k: number) => heightAt(t, pl.p.x + d.x * k, pl.p.y + d.y * k);
  const up = { x: f.x * (mid(f, pl.hd) - mid(f, -pl.hd)) / (2 * pl.hd) + r.x * (mid(r, pl.hw) - mid(r, -pl.hw)) / (2 * pl.hw), y: 0 };
  up.y = f.y * (mid(f, pl.hd) - mid(f, -pl.hd)) / (2 * pl.hd) + r.y * (mid(r, pl.hw) - mid(r, -pl.hw)) / (2 * pl.hw);
  const steep = Math.hypot(up.x, up.y);
  for (const side of onRoad ? sides : []) {
    if (side.half * 2 < 4 || side.n.x * up.x + side.n.y * up.y < UPHILL * steep) continue;
    const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, side.run / (side.count * wl)));
    for (let k = 0; k < side.count; k++) {
      const u = -side.run / 2 + (k + 0.5) * (side.run / side.count);
      const at = (d: number) => ({ x: pl.p.x + side.n.x * (side.off + d) + side.along.x * u, y: pl.p.y + side.n.y * (side.off + d) + side.along.y * u });
      const behind = at(YARD + wd + 1.5);
      if (!(heightAt(t, behind.x, behind.y) - floor > RETAINING_FROM)) continue;
      const p = at(YARD + wd / 2);
      // Its face to the building; not on a road (the editor's check), not in the water or off the map, not in the next building
      const wall = { asset: RETAINING_ASSET, x: round2(p.x), y: round2(p.y), rotation: round3(Math.atan2(side.n.x, -side.n.y)), scale: round3(scale) };
      if (onRoad!(wall) || inWater(t, p.x, p.y) || Math.abs(p.x) > t.width / 2 - wl || Math.abs(p.y) > t.depth / 2 - wl) continue;
      // The room round the HQ takes none, as it takes no furniture
      if (Math.hypot(p.x - doc.hq.x, p.y - doc.hq.y) < RETAINING_HQ_CLEAR) continue;
      if (boxes.near(p).some((q) => q !== pl && boxDistance(q, p) < wd)) continue;
      walls.push({ ...wall, z: 0 });
      side.held[k] = true;
    }
  }
  const corners = boxCorners(pl, YARD + wd + BANK_REACH);
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const i0 = Math.max(0, Math.floor((Math.min(...xs) + t.width / 2) / g.cellSize));
  const i1 = Math.min(g.columns - 1, Math.ceil((Math.max(...xs) + t.width / 2) / g.cellSize));
  const j0 = Math.max(0, Math.floor((Math.min(...ys) + t.depth / 2) / g.cellSize));
  const j1 = Math.min(g.rows - 1, Math.ceil((Math.max(...ys) + t.depth / 2) / g.cellSize));
  let depth = 0;
  for (let j = j0; j <= j1; j++) {
    const y = -t.depth / 2 + j * g.cellSize;
    for (let i = i0; i <= i1; i++) {
      const k = j * g.columns + i;
      const h = g.heights[k];
      if (guard[k] || h <= floor) continue;
      const x = -t.width / 2 + i * g.cellSize;
      const b = toBox(pl, { x, y });
      const dist = Math.hypot(Math.max(0, Math.abs(b.s) - pl.hw), Math.max(0, Math.abs(b.t) - pl.hd));
      let allowed = dist <= YARD ? floor : dist <= YARD + BANK_REACH ? floor + (dist - YARD) * BANK_SLOPE : Infinity;
      if (dist > YARD) {
        // Behind a retaining wall the hill it holds, a bank over its top
        for (const side of sides) {
          const e = side.sign * b[side.across] - side.off;
          const a = side.across === 't' ? b.s : b.t;
          if (e <= YARD || e > YARD + wd + BANK_REACH || Math.abs(a) > side.run / 2) continue;
          const piece = Math.min(side.count - 1, Math.floor(((a + side.run / 2) / side.run) * side.count));
          if (!side.held[piece]) continue;
          const held = e <= YARD + wd ? floor : floor + RETAINING_HOLD + (e - YARD - wd) * BANK_SLOPE;
          allowed = allowed === Infinity ? held : Math.max(allowed, held);
        }
      }
      if (h > allowed) {
        depth = Math.max(depth, h - allowed);
        g.heights[k] = allowed;
      }
    }
  }
  return { depth, walls };
}

/** Whether map point (x, y) lies in the cutting of a car park's ramp before raised building `o` (object-mass.ts massOnRamp) */
function onRampAt(o: Pick<MapObject, 'x' | 'y' | 'rotation' | 'scale'>, mass: MapMass, x: number, y: number): boolean {
  const m = toModel(x - o.x, y - o.y, Math.cos(o.rotation), Math.sin(o.rotation));
  const s = o.scale || 1;
  return massOnRamp(mass, m.x / s, m.z / s);
}

/** The lowest of the four height samples round map point (x, y) */
function lowestSample(t: CustomMapDocument['terrain'], x: number, y: number): number {
  const g = t.grid;
  const fi = Math.min(g.columns - 1, Math.max(0, (x + t.width / 2) / g.cellSize));
  const fj = Math.min(g.rows - 1, Math.max(0, (y + t.depth / 2) / g.cellSize));
  let low = Infinity;
  for (const j of [Math.floor(fj), Math.ceil(fj)]) for (const i of [Math.floor(fi), Math.ceil(fi)]) low = Math.min(low, g.heights[j * g.columns + i]);
  return low;
}

/** Whether map (x, y) lies in a water body's mask (its nearest height sample) or a river */
function inWater(t: CustomMapDocument['terrain'], x: number, y: number): boolean {
  const g = t.grid;
  const i = Math.round((x + t.width / 2) / g.cellSize);
  const j = Math.round((y + t.depth / 2) / g.cellSize);
  if (i >= 0 && j >= 0 && i < g.columns && j < g.rows) {
    const k = j * g.columns + i;
    for (const body of [t.water, ...(t.waterBodies ?? [])]) if (body?.mask[k]) return true;
  }
  return waterLevelAt(t, x, y, heightAt(t, x, y)) !== null;
}

// ---- Indexes ----

interface Segment {
  a: MapPoint;
  b: MapPoint;
  /** Half the width that counts against buildings */
  half: number;
  road: boolean;
  /** Holds buildings off: not a square's outline (pulled off the walls, square-outlines.ts) */
  blocks: boolean;
}

/**
 * The map's path segments in a grid of cells, for the nearest street and the
 * roads near a building. A passage through a building (`covered`) is in
 * neither, but kept apart: where it runs along a building's wall instead of
 * through it, it holds that building off (coveredNear); a square's outline
 * (`area`) gives a front to face, nothing to keep off
 */
/** An entrance OSM maps (`entrance`): where, and how much it says (ENTRANCE_RANKS, 0 the main one) */
interface Entrance {
  p: MapPoint;
  rank: number;
}

/** The entrances of the points by 16 m cells: each building's (on its outline) found quickly */
class EntranceIndex {
  private readonly cell = 16;
  private readonly cells = new Map<string, Entrance[]>();

  constructor(points: OsmFeatures['points']) {
    for (const pt of points) {
      const rank = ENTRANCE_RANKS[pt.tags['entrance'] ?? ''];
      if (rank === undefined) continue;
      const key = `${Math.floor(pt.x / this.cell)},${Math.floor(pt.y / this.cell)}`;
      const list = this.cells.get(key);
      const e = { p: { x: pt.x, y: pt.y }, rank };
      if (list) list.push(e);
      else this.cells.set(key, [e]);
    }
  }

  /** The entrance on an outline (within ENTRANCE_REACH), the main one first; null for none */
  on(ring: readonly MapPoint[]): MapPoint | null {
    if (!this.cells.size) return null;
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    let best: Entrance | null = null;
    for (let i = Math.floor((Math.min(...xs) - ENTRANCE_REACH) / this.cell); i <= Math.floor((Math.max(...xs) + ENTRANCE_REACH) / this.cell); i++) {
      for (let j = Math.floor((Math.min(...ys) - ENTRANCE_REACH) / this.cell); j <= Math.floor((Math.max(...ys) + ENTRANCE_REACH) / this.cell); j++) {
        for (const e of this.cells.get(`${i},${j}`) ?? []) {
          if (best && e.rank >= best.rank) continue;
          if (ringDistance(ring, e.p) <= ENTRANCE_REACH) best = e;
        }
      }
    }
    return best?.p ?? null;
  }
}

/** Distance from a point to a closed ring's edges */
function ringDistance(ring: readonly MapPoint[], p: MapPoint): number {
  let d = Infinity;
  for (let k = 0; k < ring.length; k++) d = Math.min(d, pointSegment(p, ring[k], ring[(k + 1) % ring.length]));
  return d;
}

/** How far a point lies outside a turned rectangle (0 inside) */
function rectReach(rect: Rect, p: MapPoint): number {
  const dx = p.x - rect.c.x;
  const dy = p.y - rect.c.y;
  const along = Math.abs(dx * rect.u.x + dy * rect.u.y) - rect.a / 2;
  const across = Math.abs(-dx * rect.u.y + dy * rect.u.x) - rect.b / 2;
  return Math.hypot(Math.max(0, along), Math.max(0, across));
}

/**
 * A footprint's door (BuildingDoor): its mapped entrance's, else the one
 * nearest the street, of its models (the catalogue's `doors`; the middle
 * of the front for a model without) or on the walls of its raised building,
 * whose MapMass.door it sets (the walls' middles that face out, DOOR_CORNER
 * off their corners). Null where nothing has one, or for a kind without a
 * door (NO_DOOR) where OSM maps none
 */
function footprintDoor(f: Footprint, catalog: ReadonlyMap<string, BuildingCatalogEntry> | null, roads: SegmentIndex): BuildingDoor | null {
  if (!f.entrance && NO_DOOR.has(f.kind)) return null;
  const doors: { door: BuildingDoor; pl: Placement }[] = [];
  for (const pl of f.placements) {
    const { f: front, x } = placementAxes(pl);
    if (pl.mass) {
      for (const door of wallDoors(f.ring, f.entrance)) doors.push({ door, pl });
      continue;
    }
    const o = origin(pl);
    const own = catalog?.get(pl.asset)?.doors;
    if (!own?.length) {
      doors.push({ door: { x: pl.p.x + front.x * pl.hd, y: pl.p.y + front.y * pl.hd, nx: front.x, ny: front.y }, pl });
      continue;
    }
    for (const [dx, dz, side] of own) {
      const n = side === 'front' ? front : side === 'back' ? { x: -front.x, y: -front.y } : side === 'east' ? x : { x: -x.x, y: -x.y };
      doors.push({ door: { x: o.x + (dx * x.x + dz * front.x) * pl.scale, y: o.y + (dx * x.y + dz * front.y) * pl.scale, nx: n.x, ny: n.y }, pl });
    }
  }
  if (!doors.length) return null;
  const e = f.entrance;
  // At the entrance; else where a few metres out lies nearest a road
  const cost = (d: BuildingDoor) => (e ? Math.hypot(d.x - e.x, d.y - e.y) : roads.distance({ x: d.x + d.nx * 3, y: d.y + d.ny * 3 }, FRONT_REACH));
  let best = doors[0];
  for (const d of doors) if (cost(d.door) < cost(best.door)) best = d;
  const { door, pl } = best;
  if (pl.mass) {
    const o = origin(pl);
    const m = toModel(door.x - o.x, door.y - o.y, Math.cos(pl.rotation), Math.sin(pl.rotation));
    pl.mass.door = [round2(m.x / pl.scale), round2(m.z / pl.scale)];
  }
  return { x: round2(door.x), y: round2(door.y), nx: round3(door.nx), ny: round3(door.ny) };
}

/**
 * Where a raised building's door may be: on each wall of its outline long
 * enough, its middle and points DOOR_CORNER off its corners, facing out;
 * with a mapped entrance, there (on its wall) only
 */
function wallDoors(ring: readonly MapPoint[], entrance: MapPoint | null): BuildingDoor[] {
  const turn = ringArea(ring) > 0 ? 1 : -1;
  const out: BuildingDoor[] = [];
  let nearest: { door: BuildingDoor; d: number } | null = null;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < DOOR_WALL) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    // Outward: to the right of a counter-clockwise ring
    const nx = uy * turn;
    const ny = -ux * turn;
    if (entrance) {
      const s = Math.max(DOOR_CORNER, Math.min(len - DOOR_CORNER, (entrance.x - a.x) * ux + (entrance.y - a.y) * uy));
      const door = { x: a.x + ux * s, y: a.y + uy * s, nx, ny };
      const d = Math.hypot(door.x - entrance.x, door.y - entrance.y);
      if (!nearest || d < nearest.d) nearest = { door, d };
      continue;
    }
    for (const s of [DOOR_CORNER, len / 2, len - DOOR_CORNER]) out.push({ x: a.x + ux * s, y: a.y + uy * s, nx, ny });
  }
  return nearest ? [nearest.door] : out;
}

class SegmentIndex {
  private readonly cell = 32;
  private readonly cells = new Map<number, Segment[]>();
  private readonly coveredCells = new Map<number, Segment[]>();

  constructor(doc: CustomMapDocument) {
    const nodes = new Map(doc.paths.nodes.map((nd) => [nd.id, nd]));
    const doors = doorNodes(doc.paths);
    for (const e of doc.paths.edges) {
      const a = nodes.get(e.a);
      const b = nodes.get(e.b);
      if (!a || !b) continue;
      const line = [a, ...(e.via ?? []), b];
      const half = (e.width / 2) * (e.kind === 'path' ? PATH_WALL_SHARE : 1);
      const cells = e.covered ? this.coveredCells : this.cells;
      for (let s = 0; s + 1 < line.length; s++) {
        // A way into a passage holds the building off only past its door (offDoors), as the editor's check sees it
        const piece = e.covered ? [line[s], line[s + 1]] : offDoors(line[s], line[s + 1], s === 0 && doors.has(e.a), s === line.length - 2 && doors.has(e.b), half);
        if (!piece) continue;
        const seg = { a: piece[0], b: piece[1], half, road: e.kind !== 'path', blocks: !e.area && !e.covered };
        const i0 = Math.floor(Math.min(seg.a.x, seg.b.x) / this.cell);
        const i1 = Math.floor(Math.max(seg.a.x, seg.b.x) / this.cell);
        const j0 = Math.floor(Math.min(seg.a.y, seg.b.y) / this.cell);
        const j1 = Math.floor(Math.max(seg.a.y, seg.b.y) / this.cell);
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const key = this.key(i, j);
            let list = cells.get(key);
            if (!list) cells.set(key, (list = []));
            list.push(seg);
          }
        }
      }
    }
  }

  /** Pieces of covered ways (passages) whose cells come within `reach` of `p` */
  coveredNear(p: MapPoint, reach: number): Segment[] {
    const out = new Set<Segment>();
    const i0 = Math.floor((p.x - reach) / this.cell);
    const i1 = Math.floor((p.x + reach) / this.cell);
    const j0 = Math.floor((p.y - reach) / this.cell);
    const j1 = Math.floor((p.y + reach) / this.cell);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) for (const s of this.coveredCells.get(this.key(i, j)) ?? []) out.add(s);
    return [...out];
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** Segments that hold buildings off whose cells come within `reach` of `p` */
  blocking(p: MapPoint, reach: number): Segment[] {
    return this.near(p, reach).filter((s) => s.blocks);
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

/** The footprints' middles and sizes in a grid of cells, for the median size of the buildings around a point */
class AroundIndex {
  private readonly cell = 100;
  private readonly cells = new Map<number, number[]>();

  constructor(areas: readonly OsmArea[]) {
    for (const area of areas) {
      const c = ringMiddle(area.outer[0]);
      const key = this.key(Math.floor(c.x / this.cell), Math.floor(c.y / this.cell));
      let list = this.cells.get(key);
      if (!list) this.cells.set(key, (list = []));
      list.push(c.x, c.y, area.area);
    }
  }

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  /** Median footprint (m²) of the buildings within `reach` of `p`, null with fewer than five */
  median(p: MapPoint, reach: number): number | null {
    const sizes: number[] = [];
    const r = Math.ceil(reach / this.cell);
    const ci = Math.floor(p.x / this.cell);
    const cj = Math.floor(p.y / this.cell);
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 3) if (Math.hypot(list[k] - p.x, list[k + 1] - p.y) <= reach) sizes.push(list[k + 2]);
      }
    }
    if (sizes.length < 5) return null;
    sizes.sort((a, b) => a - b);
    return sizes[sizes.length >> 1];
  }
}

/** Mean of a ring's points */
function ringMiddle(ring: readonly MapPoint[]): MapPoint {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(1, ring.length), y: y / Math.max(1, ring.length) };
}

/** A small hash of an OSM id (ids pass 2^32) */
function hashId(id: number): number {
  return Math.abs(Math.imul(id % 2147483647 | 0, 2654435761) >>> 0) % 1009;
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

  /** The smallest outer ring a point lies in, its courtyards counted in */
  outerAt(p: MapPoint): readonly MapPoint[] | null {
    let best: readonly MapPoint[] | null = null;
    let bestArea = Infinity;
    for (const area of this.cells.get((Math.floor(p.x / this.cell) + 4096) * 8192 + (Math.floor(p.y / this.cell) + 4096)) ?? []) {
      for (const r of area.outer) {
        if (!pointInRing(p, r)) continue;
        const a = Math.abs(ringArea(r));
        if (a < bestArea) {
          best = r;
          bestArea = a;
        }
      }
    }
    return best;
  }
}

/**
 * The drawn parts (`building:part`, isDrawnPart) of each footprint, by its
 * outer ring (docs/OSM_LANDMARKS_PLAN.md L3): a part belongs to the
 * smallest outer ring of a building on the ground its middle lies in,
 * courtyards counted in (a stair tower in the corner of the yard)
 */
export function partsByOutline(features: OsmFeatures): Map<readonly MapPoint[], OsmPart[]> {
  const out = new Map<readonly MapPoint[], OsmPart[]>();
  const parts = features.areas.filter((a) => footprintKindOf(a.tags) === 'part' && isDrawnPart(a.tags));
  if (!parts.length) return out;
  const outlines = new AreaIndex(features.areas.filter((a) => a.tags['building'] && isGroundBuilding(a.tags)));
  for (const part of parts) {
    for (const ring of part.outer) {
      const owner = outlines.outerAt(ringMiddle(ring));
      if (!owner) continue;
      let list = out.get(owner);
      if (!list) out.set(owner, (list = []));
      list.push({ outer: ring, holes: part.inner.filter((h) => pointInRing(h[0], ring)), tags: part.tags });
    }
  }
  return out;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round2 = (v: number): number => Math.round(v * 100) / 100;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

