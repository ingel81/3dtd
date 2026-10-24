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
 *    (floorLevel); towards the valley it stands over its cellar, open down to the
 *    ground (MapObject.cellar, cellarForDrop; its z the drop), up the hill the ground is cut
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
import { objectCost, SCENE_BUDGET } from '../../custom-map/render/objects/scene-cost';
import { waterLevelAt } from '../../custom-map/water-level';
import { seatHeight, type ObjectFooting } from '../../custom-map/render/objects/object-seat';
import { CoveredWays, garageFloors, massOpenings } from './building-openings';
import { EdgeIndex, pointSegmentDistance } from '../../../map-ops/path-graph';
import { objectsOnPaths } from '../../../map-ops/validation/map-validation';
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
} from '../building-tags';
import type { OsmArea, OsmFeatures } from '../osm-parse';
import { ringArea } from '../square-clip';
import { MASS_ASSET, type MapFootprints, type MapMass } from '../../custom-map/map-document';
import { packFootprints, type FootprintDrop, type FootprintRing } from '../../custom-map/map-footprints';
import { massArea, massBodies, massBox, massDistance, massRadius, massTop, massTriangles, ringsContain } from '../../custom-map/object-mass';
import { cellarForDrop } from '../../custom-map/object-cellar';
import { toModel } from '../../custom-map/object-ground';
import { CLIP_KEEP, CLIP_LEAST, clipOffRoads, isDrawnPart, raiseMass, sharedWalls, shareWalls, type OsmPart } from './building-mass';
import { findOldTown } from './old-town';
import type { ImportNote } from '../../import-notes';
import { insideRing, minAreaRect, type TurnedRect } from '../../custom-map/map-surfaces';
import { round1, round2, round3 } from './geom';
import { AROUND_FROM, AROUND_REACH, BASEMENT_FROM, BUILDING_BUDGET_SHARE, BUILDING_TINTS, COVER_FROM, FILL_SPLIT, HQ_CLEAR, MAX_PARTS, MIN_AREA, MIN_PART_AREA, MIN_PART_SHARE, MODEL_COVER, MODEL_OVERHANG, RETAINING_ASSET, ROAD_GUARD, TINTED_KINDS, WINGED_FILL } from './building-config';
import type { BuildingCatalogEntry, BuildingDoor, BuildingReport, CoverageReport, Footprint, Placement } from './building-types';
import { boxCorners, boxDistance, origin, placementAxes, rightOf, toBox } from './building-placement';
import { AreaIndex, AroundIndex, BoxIndex, EntranceIndex, footprintDoor, hashId, rectReach, ringMiddle, SegmentIndex } from './building-indexes';
import { buildingFooting, clearOfRoads, type DoorSide, layPart, sizeClass } from './building-models';
import { cutSlope, floorLevel, onRampAt, roadGuard } from './building-ground';

/** The catalogue entries the buildings read (their models and the retaining wall), slim for the worker's message */
export function buildingCatalog(objects: readonly (BuildingCatalogEntry & { id: string })[]): BuildingCatalogEntry[] {
  return objects
    .filter((o) => BUILDING_MODELS[o.id] || o.id === RETAINING_ASSET || o.id === MASS_ASSET)
    .map(({ id, category, height, file, triangles, lod, far, effects, footprint, box, doors }) => ({ id, category, height, file, triangles, lod, far, effects, footprint, box, doors }));
}

interface BuildingOptions {
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

interface BuildingResult {
  objects: MapObject[];
  /** Each standing building's door, by its area's id (OsmArea.id): its footpath starts there (plots.ts) */
  doors: Map<number, BuildingDoor>;
  report: BuildingReport;
  warnings: ImportNote[];
  /** The outer rings (of `features.areas`) left out and why, as `report.dropped` counts them: for osmFootprints */
  droppedRings: Map<readonly MapPoint[], FootprintDrop>;
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
      const holes = area.inner.filter((r) => insideRing(r[0], points));
      rings.push({ points, holes, levels, minLevel, kind, dropped: dropped.get(points) ?? null });
    }
  }
  return packFootprints(rings);
}

/** The buildings of `features` placed on `doc` (after the roads and the HQ): objects to add, the ground levelled under them */
export function placeBuildings(doc: CustomMapDocument, features: OsmFeatures, options: BuildingOptions = {}): BuildingResult {
  const report = emptyReport();
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
  const ctx: PlaceContext = { doc, report, catalog, known, roads, onRoad, droppedRings, missing, measure, footprints, lands, compounds, waters, around, oldTown, partsOf, coveredWays, entrances, doorSide };
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
    for (const outer of area.outer) layFootprint(ctx, area, outer);
  }

  capToBudget(ctx, options.budget ?? BUILDING_BUDGET_SHARE * SCENE_BUDGET, warnings);
  // Pads, retaining walls and the objects
  const boxes = new BoxIndex(footprints.flatMap((f) => f.placements));
  openRowEnds(ctx, boxes);
  const { objects, standing, doors } = standObjects(ctx, boxes);
  seatOnCellars(doc, standing, footingOf, report);
  report.objects = objects.length;
  report.cost = Math.round(objects.reduce((s, o) => s + costOf(o.asset, catalog, doc) + (o.mass ? massTriangles(o.mass) : 0), 0));
  report.costShare = Math.round((report.cost / SCENE_BUDGET) * 1000) / 1000;
  report.missing = [...missing.entries()].sort((p, q) => q[1] - p[1]).map(([kind, count]) => ({ kind, count }));
  report.coverage = coverageReport(covered, outside);
  return { objects, doors, report, warnings, droppedRings };
}

function emptyReport(): BuildingReport {
  return {
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
}

/** What the steps of placeBuildings share: the map, the report, the lookups, the footprints laid so far */
interface PlaceContext {
  doc: CustomMapDocument;
  report: BuildingReport;
  catalog: ReadonlyMap<string, BuildingCatalogEntry> | null;
  known: (asset: string) => boolean;
  roads: SegmentIndex;
  onRoad: (o: Pick<MapObject, 'asset' | 'x' | 'y' | 'rotation' | 'scale' | 'mass'>) => boolean;
  droppedRings: Map<readonly MapPoint[], FootprintDrop>;
  missing: Map<string, number>;
  measure: (ringA: number, cover: number, over: number) => void;
  footprints: Footprint[];
  lands: AreaIndex;
  compounds: AreaIndex;
  waters: AreaIndex;
  around: AroundIndex;
  oldTown: ReturnType<typeof findOldTown>;
  partsOf: Map<readonly MapPoint[], OsmPart[]>;
  coveredWays: CoveredWays;
  entrances: EntranceIndex;
  doorSide: (asset: string) => DoorSide;
}

/** One outer ring of a building area: its kind, its models or its raised outline, kept clear of water, roads and the HQ; a footprint, or why it is dropped */
function layFootprint(ctx: PlaceContext, area: OsmArea, outer: readonly MapPoint[]): void {
  const { doc, report, catalog, known, roads, onRoad, droppedRings, missing, measure, footprints, lands, compounds, waters, around, oldTown, partsOf, coveredWays, entrances, doorSide } = ctx;
  const holes = area.inner.filter((r) => insideRing(r[0], outer));
  const ringA = Math.abs(ringArea(outer)) - holes.reduce((s, r) => s + Math.abs(ringArea(r)), 0);
  if (ringA < MIN_AREA) {
    report.dropped.tiny++;
    droppedRings.set(outer, 'tiny');
    return;
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
      return;
    }
    why ??= blocked;
  }
  if (!placements.length) {
    report.dropped[why ?? 'noModel']++;
    droppedRings.set(outer, why ?? 'noModel');
    measure(ringA, 0, 0);
    return;
  }
  if (!kept.length) {
    report.dropped[why ?? 'roads']++;
    droppedRings.set(outer, why ?? 'roads');
    measure(ringA, 0, 0);
    return;
  }
  // The models that are left where the raised building cannot stand (water), however they fit
  measure(ringA, cover, over);
  const cost = kept.reduce((s, pl) => s + costOf(pl.asset, catalog, doc), 0);
  footprints.push({ id: area.id, ring: outer, kind, area: ringA, centre, placements: kept, cost, tint: TINTED_KINDS.has(kind) ? BUILDING_TINTS[hashId(area.id) % BUILDING_TINTS.length] : null, ruin: false, entrance });
}

/** Scene cost: past the budget, the smallest footprints far from the HQ go first */
function capToBudget(ctx: PlaceContext, budget: number, warnings: ImportNote[]): void {
  const { doc, report, catalog, droppedRings, footprints } = ctx;
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
}

/** The end of a row: a module whose blank gable no house abuts takes the model with windows on that side */
function openRowEnds(ctx: PlaceContext, boxes: BoxIndex): void {
  const { report, known, onRoad, footprints } = ctx;
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
}

/** The footprints' objects: each with its door, openings and floor, the slope cut to it with its retaining walls */
function standObjects(ctx: PlaceContext, boxes: BoxIndex): { objects: MapObject[]; standing: { object: MapObject; floor: number }[]; doors: Map<number, BuildingDoor> } {
  const { doc, report, catalog, known, roads, onRoad, coveredWays, footprints } = ctx;
  const guard = roadGuard(doc);
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
      // On a slope: its floor at the ground before its entrance, the hill behind it cut to that, its cellar under
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
  return { objects, standing, doors };
}

/**
 * Each building over its seat on the ground as all the cuts left it, as the renderer seats it: lifted to its floor
 * over its cellar where the hill falls away under it
 */
function seatOnCellars(doc: CustomMapDocument, standing: readonly { object: MapObject; floor: number }[], footingOf: (asset: string) => ObjectFooting, report: BuildingReport): void {
  const ground = (x: number, y: number) => heightAt(doc.terrain, x, y);
  for (const { object, floor } of standing) {
    const mass = object.mass;
    const seat = seatHeight(mass ? { category: 'building', footprint: 1, height: mass.height } : footingOf(object.asset), object, ground, () => null);
    const drop = Math.max(0, round2(floor - seat));
    if (drop >= BASEMENT_FROM) {
      object.z = drop;
      report.basements++;
      report.deepestBasementM = Math.max(report.deepestBasementM, round1(drop));
    }
    // Its cellar: open to the slope with as many storeys as reach the ground, else buried (object-cellar.ts)
    object.cellar = cellarForDrop(drop);
    // Its car park entrances' floors under the seat, where the ramps meet the wall
    if (mass?.openings?.some((o) => o.kind === 'garage')) garageFloors(mass.openings, object, doc.terrain, seat);
  }
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
      if (insideRing(p, f.ring)) return true;
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
function coverage(outer: readonly MapPoint[], holes: readonly MapPoint[][], rect: TurnedRect, covers: (q: MapPoint) => boolean): number {
  const cell = Math.max(0.4, Math.sqrt((rect.a * rect.b) / 300));
  const v = { x: -rect.u.y, y: rect.u.x };
  let inside = 0;
  let covered = 0;
  for (let sv = -rect.b / 2 + cell / 2; sv < rect.b / 2; sv += cell) {
    for (let su = -rect.a / 2 + cell / 2; su < rect.a / 2; su += cell) {
      const q = { x: rect.c.x + su * rect.u.x + sv * v.x, y: rect.c.y + su * rect.u.y + sv * v.y };
      if (!insideRing(q, outer) || holes.some((h) => insideRing(q, h))) continue;
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
        if (insideRing(q, outer) && !holes.some((h) => insideRing(q, h))) continue;
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
    if (pointSegmentDistance({ x: 0, y: 0 }, { x: piece.ax, y: piece.az }, { x: piece.bx, y: piece.bz }) > radius + piece.half) continue;
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

/**
 * A footprint that fills its rectangle badly cut into rectangles: the
 * footprint rasterised in the rectangle's own axes, then the biggest
 * rectangle of filled cells taken again and again (the largest rectangle
 * under each row's histogram) until the parts left are small
 */
export function splitFootprint(outer: readonly MapPoint[], holes: readonly MapPoint[][], rect: TurnedRect, area: number): TurnedRect[] {
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
      if (insideRing(p, outer) && !holes.some((h) => insideRing(p, h))) filled[j * nu + i] = 1;
    }
  }
  const du = rect.a / nu;
  const dv = rect.b / nv;
  const minCells = Math.max(MIN_PART_AREA, MIN_PART_SHARE * area) / (du * dv);
  const parts: TurnedRect[] = [];
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
      list.push({ outer: ring, holes: part.inner.filter((h) => insideRing(h[0], ring)), tags: part.tags });
    }
  }
  return out;
}

