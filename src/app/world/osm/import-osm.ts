/**
 * A real place to a custom map document (docs/OSM_WORLD_PLAN.md, phase O1
 * "grey world"): the ground from elevation tiles, the roads from
 * OpenStreetMap as the map's street graph, levelled and painted, the HQ on
 * the place and spawns as on the real places, then land and water,
 * buildings, furniture and plants.
 *
 * `convertOsm` is pure and DOM-free (Node, specs, the worker); `loadOsmInput`
 * downloads what it reads (Overpass, elevation tiles) or takes it from the
 * frame store.
 */
import { placeLabel } from '../../services/location/place-label';
import { OSM_MAP_ATTRIBUTION } from '../../configs/attributions.config';
import { createMapDocument, slugMapId } from '../custom-map/map-create';
import type { CustomMapDocument } from '../custom-map/map-document';
import { DEM_SOURCES, downloadDem, type DemDecoder, type DemMosaic } from './dem-tiles';
import { OsmFrame, parseOsm, type OsmParseStats } from './osm-parse';
import type { OsmFrameStore } from './osm-frame-store';
import { downloadOsm, osmQueryBox } from './osm-query';
import type { OverpassResponse, OverpassRetry } from './overpass-client';
import type { OsmProgress } from './osm-progress';
import { buildRoads, levelRoads, paintRoads, roadPaintMaterials, type RoadStats } from './convert/roads';
import { sinkRamps } from './convert/underground';
import { placeDescents } from './convert/subway-descents';
import { placeRailWalls, type RailWallReport } from './convert/rail-walls';
import { buildTunnels, seatPortals, type TunnelReport } from './convert/tunnels';
import { layPavements, type PavementStats } from './convert/pavements';
import { layPlots, type PlotReport } from './convert/plots';
import { fillOsmTerrain } from './convert/terrain';
import { paintGround, placeMood, type GroundReport } from './convert/ground';
import { growVegetation, type VegetationReport } from './convert/vegetation';
import { objectCost } from '../custom-map/render/objects/scene-cost';
import { carveWater, layRunnels, paintWater, settleWater, WATER_MATERIALS, type WaterPaintRole, type WaterReport } from './convert/water';
import { layOut, OsmLayout, type LayoutReport } from './convert/layout';
import { mulberry32 } from '../../utils/game-rng';
import { findLandmarks, spawnAnchors, type Landmark } from './convert/anchors';
import { growLife, type LifeReport } from './convert/life';
import { placeFurniture, type FurnitureReport } from './convert/furniture';
import { levelRails, paintRails, planRails, railPaintMaterials, type RailGroundReport, type RailStats } from './convert/rails';
import { placePois, type PoiReport } from './convert/pois';
import { osmFootprints, placeBuildings, type BuildingCatalogEntry, type BuildingReport } from './convert/buildings';
import { layAreas, type AreaReport } from './convert/areas';
import { spawnRoutes } from '../../map-ops/path-graph';
import { linesOfGroups } from '../../map-ops/object-ops';
import { OsmError } from './osm-error';
import type { ImportNote } from '../import-notes';

/**
 * Side of an OSM world, metres: 2.4 km by default and at most (decision 2 of the plan, the size the format and the
 * budget are measured for); the frame's square may be smaller and off the HQ (osm-area.ts, E209)
 */
export const OSM_WORLD_SIDE = 2400;
/** Metres the query reaches past the map's edge, so a way leaving the map brings its next node */
export const OSM_QUERY_MARGIN = 100;
/** Splat texels per side of an OSM world (decision 10 of the plan) */
export const OSM_SPLAT_RESOLUTION = 2048;
/** Spawns an OSM world gets */
export const OSM_SPAWNS = 4;
/** Metres from the searched place within which the frame offers landmarks for the HQ */
export const OSM_LANDMARK_REACH = 800;

/** What the conversion reads: the place, the Overpass answer and the heights */
export interface OsmImportInput {
  /** The map's centre; the Overpass answer and the heights cover at least its square */
  lat: number;
  lon: number;
  /** Where the HQ goes (the place searched for), when the square was moved off it (osm-area.ts); else the centre */
  place?: { lat: number; lon: number };
  /** What the player searched for; the coordinates when empty */
  address?: string;
  overpass: OverpassResponse;
  /** Null: flat ground (no elevation source delivered) */
  dem: DemMosaic | null;
  /** ISO time the data was fetched */
  fetchedAt: string;
  /** Elevation sources that failed before the one used, for the report */
  demFailed?: string[];
}

export interface OsmImportOptions {
  id?: string;
  name?: string;
  sideM?: number;
  cellSize?: number;
  splatResolution?: number;
  spawns?: number;
  /** Where the spawns go (the frame's choice, real coordinates); drawn as on a real place when absent */
  spawnsAt?: { lat: number; lon: number }[];
  now?: Date;
  /** The asset catalogue's objects: the buildings take their models and scene cost from it (convert/buildings.ts) */
  catalog?: readonly BuildingCatalogEntry[];
  /** The ground materials of the catalogue: the surfaces of the areas take the first of each material's chain it has (area-tags.ts) */
  materials?: readonly string[];
  /**
   * Scene cost per plant and furniture asset on this map (vegetation.ts assetCosts, from
   * the catalogue): the plants and the furniture are held to their budgets
   * by it. An asset missing counts as an unknown object (dearer, so the
   * forests come out thinner)
   */
  costs?: Record<string, number>;
  /**
   * The assets that lay as lines (asset-catalog.ts linePiece: the catalogue's walls and structures): the pieces of
   * each way, area and garden the import groups become a line of that group (MapLine). None: no lines
   */
  lineAssets?: readonly string[];
  /** The buildings take damage and fall, craters with them (MapGameplay.destructible, decided 2026-10-18: on unless the frame says no) */
  destructible?: boolean;
}

/** One step of the conversion, for the progress list */
export type OsmConvertStep = 'parse' | 'terrain' | 'roads' | 'water' | 'level' | 'ground' | 'shores' | 'paint' | 'layout' | 'areas' | 'buildings' | 'furniture' | 'pois' | 'plants' | 'life';

export interface OsmImportReport {
  place: { lat: number; lon: number; address: string };
  sideM: number;
  grid: { columns: number; rows: number; cellSize: number; splat: number };
  parse: OsmParseStats;
  terrain: { dem: string | null; zeroM: number; minM: number; maxM: number; demFailed: string[] };
  roads: RoadStats;
  pavements: PavementStats;
  plots: PlotReport;
  tunnels: TunnelReport;
  /** The railway: lines, crossings, bridges, tunnels, and how its beds were levelled */
  rails: RailStats & RailGroundReport & { walls: RailWallReport };
  ground: GroundReport;
  water: WaterReport;
  plants: VegetationReport;
  areas: AreaReport;
  layers: string[];
  layout: LayoutReport;
  buildings: BuildingReport;
  furniture: FurnitureReport;
  pois: PoiReport;
  life: LifeReport;
  /** Milliseconds per step */
  ms: Record<string, number>;
  warnings: ImportNote[];
}

export interface OsmImportResult {
  doc: CustomMapDocument;
  report: OsmImportReport;
}

/** The map of `input`'s place; `onStep` hears each step as it begins, `onShare` how far the long ones are */
export function convertOsm(
  input: OsmImportInput,
  options: OsmImportOptions = {},
  onStep?: (step: OsmConvertStep) => void,
  onShare?: (step: OsmConvertStep, share: number) => void,
): OsmImportResult {
  const ms: Record<string, number> = {};
  let t = performance.now();
  const order: OsmConvertStep[] = ['parse', 'terrain', 'roads', 'water', 'level', 'ground', 'shores', 'paint', 'layout', 'areas', 'buildings', 'furniture', 'pois', 'plants', 'life'];
  const step = (name: string) => {
    const now = performance.now();
    ms[name] = Math.round(now - t);
    t = now;
    // The step after the one just ended ('setup' comes before the first)
    const next = order[order.indexOf(name as OsmConvertStep) + 1];
    if (next) onStep?.(next);
  };
  const warnings: ImportNote[] = [];
  const side = options.sideM ?? OSM_WORLD_SIDE;
  const { address, id, name } = osmMapNames({ ...input, ...input.place });
  const doc = createMapDocument({
    id: options.id ?? id,
    name: options.name ?? name,
    description: `Made from OpenStreetMap at ${address}.`,
    width: side,
    depth: side,
    cellSize: options.cellSize ?? 2,
    baseMaterial: 'grass',
    splatResolution: options.splatResolution ?? OSM_SPLAT_RESOLUTION,
    starter: false,
    now: options.now,
  });
  const t0 = doc.terrain;
  const frame = new OsmFrame(input.lat, input.lon);
  step('setup');

  const features = parseOsm(input.overpass, frame, t0.width / 2);
  step('parse');

  const terrain = fillOsmTerrain(t0.grid, frame, input.dem);
  if (!input.dem) warnings.push({ key: 'noHeights' });
  step('terrain');

  const roads = buildRoads(features);
  doc.paths = roads.paths;
  // The streets' pavements, narrowed where buildings stand close
  const pavements = layPavements(doc.paths, roads.pavements, features);
  if (!roads.paths.edges.length) warnings.push({ key: 'noRoads' });
  const rails = planRails(features, doc.paths);
  // Before the water: a river over a tunnel still cuts its bed through the raised ground. The railway's tunnels get portals too
  const tunnels = buildTunnels(t0, [...roads.tunnels, ...rails.tunnels], [...roads.mouths, ...rails.mouths.map((m) => ({ ...m, tunnel: m.tunnel + roads.tunnels.length }))]);
  doc.objects.push(...tunnels.objects);
  step('roads');

  // Water before the roads level the ground, settled after: a road through water stands on a dam
  const water = carveWater(t0, features, doc.paths, terrain.zeroM);
  const zeroM = water.report.coast ? 0 : terrain.zeroM;
  warnings.push(...water.warnings);
  step('water');

  levelRoads(t0, doc.paths);
  // The car parks' entrances down into the ground, on the levelled street
  sinkRamps(t0, roads.ramps);
  // After the roads: a level crossing takes the road's height; the beds keep off the road bands and the water
  const beforeRails = Float32Array.from(t0.grid.heights);
  const railGround = levelRails(t0, rails, doc.paths, (k) => water.roads[k] === 1 || water.wet[k] === 1 || water.sea[k] === 1);
  settleWater(t0, water);
  seatPortals(t0, tunnels.objects);
  // The underpasses' stairs and ramps on the levelled ground, levelling it round them
  doc.objects.push(...placeDescents(t0, roads.descents));
  // Walls where a road and a bed beside it lie on other levels: the step a wall, not rock
  const railWalls = placeRailWalls(t0, rails, doc.paths, (k) => Math.abs(beforeRails[k] - t0.grid.heights[k]) > 0.05, features);
  doc.objects.push(...railWalls.objects);
  step('level');
  // The land takes the layers the roads' surfaces and the water's shores leave
  const wetMaterials = (Object.keys(WATER_MATERIALS) as WaterPaintRole[]).filter((r) => water.paint[r].some((v) => v > 0)).map((r) => WATER_MATERIALS[r]);
  const ground = paintGround(t0, features, new Set([...roadPaintMaterials(doc.paths), ...railPaintMaterials(rails), ...wetMaterials]));
  Object.assign(doc.environment, placeMood(features));
  step('ground');
  paintWater(t0, water);
  step('shores');
  // The beds' gravel before the roads: a road over a crossing keeps its surface
  paintRails(t0, rails);
  paintRoads(t0, doc.paths);
  step('paint');

  const at = options.spawnsAt?.map((p) => frame.point(p));
  // Drawn spawns roll seeded dice: the same data makes the same map (the plants and furniture keep clear of their routes)
  const random = mulberry32(Math.round(input.lat * 1e4) ^ Math.round(input.lon * 1e4));
  const layout = layOut(doc, roads.names, { spawns: options.spawns ?? OSM_SPAWNS, at, place: input.place && frame.point(input.place), anchors: spawnAnchors(features), random });
  if (layout.spawns.length < layout.wanted) {
    warnings.push(at
      ? { key: 'spawnsLeftOut', v: { missing: layout.wanted - layout.spawns.length, wanted: layout.wanted } }
      : { key: 'spawnsFound', v: { found: layout.spawns.length, wanted: layout.wanted } });
  }
  // The routes from the spawns, once for the areas and the plants (devices and plants grow fuller near them)
  const routes = [...spawnRoutes(doc).values()].filter((r) => !!r).map((r) => r!.points);
  step('layout');

  // Squares, pitches, playgrounds, car parks: surfaces with their lines, level ground, their objects in their own share
  const unknownCost = objectCost(undefined, side * side);
  const costOf = (asset: string) => options.costs?.[asset] ?? unknownCost;
  const materials = options.materials && new Set(options.materials);
  // The costs know every asset of the catalogue the areas may place: one missing is left out
  const costs = options.costs;
  const areas = layAreas(doc, features, water, { costOf, routes, hasMaterial: materials ? (m) => materials.has(m) : null, hasAsset: costs ? (a) => a in costs : null, rails });
  // The drains' concrete shells, surfaces after the areas' (their materials settled)
  layRunnels(doc, water, materials ? (m) => materials.has(m) : null);
  step('areas');

  // After the HQ (they keep clear of it) and the water; their pads cut the ground the roads levelled, never the roads
  const buildings = placeBuildings(doc, features, { catalog: options.catalog, onShare: onShare && ((share) => onShare('buildings', share)) });
  doc.objects.push(...buildings.objects);
  warnings.push(...buildings.warnings);
  // The footprints as OSM has them and which of them the buildings left out, for the developer layer over them (TODO E290)
  doc.footprints = osmFootprints(features, buildings.droppedRings);
  step('buildings');

  // Fences, walls, tracks, lamps and the points of the street, in their own share of the scene budget
  const furniture = placeFurniture(doc, features, water, { costOf, rails });
  step('furniture');

  // Shops, inns and practices on their buildings' fronts: signs, shopfronts, awnings, tables; in their own share
  const pois = placePois(doc, features, { costOf });
  step('pois');

  // The plants keep off the footprints and hold their own share of the scene budget (the buildings have no cap for now)
  const plants = growVegetation(doc, features, ground.land, water, { costOf, routes, keepOff: areas.keepOff, onShare: onShare && ((share) => onShare('plants', share)) });
  // The houses' plots after the plants: the trees OSM maps in the gardens stand, hedges and driveways keep off them.
  // Front gardens and gardens painted, driveways, hedges and fences in their own share
  const plots = layPlots(doc, features, { costOf, hasMaterial: materials ? (m) => materials.has(m) : null, rails });
  // The walls, fences, hedges and tracks of each way, area and garden as one line (they draw as long as it does)
  const lineAssets = new Set(options.lineAssets ?? []);
  const lines = linesOfGroups(doc.objects, (asset) => lineAssets.has(asset));
  if (lines.length) doc.lines = lines;
  step('plants');

  // Boats, birds, the bell and the intro flight from the place's data, as life areas and an intro of any map
  const life = growLife(doc, features, water, findLandmarks(features, doc.hq, side));
  step('life');

  const dem = input.dem ? input.dem.source : null;
  doc.meta.source = {
    kind: 'osm',
    lat: input.lat,
    lon: input.lon,
    address,
    sideM: side,
    fetchedAt: input.fetchedAt,
    dem,
    zeroM,
    attribution: [OSM_MAP_ATTRIBUTION.replace(/^Routes /, 'Map data '), ...(input.dem ? [DEM_SOURCES[input.dem.source].attribution] : [])],
  };
  // OpenStreetMap's own until the editor changes it (docs/WORLDS_STATE_PLAN.md, 3.6)
  doc.meta.generated = true;
  if (options.destructible !== false) doc.gameplay = { ...doc.gameplay, destructible: true };

  const g = t0.grid;
  return {
    doc,
    report: {
      place: { lat: input.lat, lon: input.lon, address },
      sideM: side,
      grid: { columns: g.columns, rows: g.rows, cellSize: g.cellSize, splat: t0.splat.resolution },
      parse: features.stats,
      terrain: { dem, zeroM, minM: round1(terrain.min), maxM: round1(terrain.max), demFailed: input.demFailed ?? [] },
      roads: roads.stats,
      pavements,
      tunnels: tunnels.report,
      rails: { ...rails.stats, ...railGround, walls: railWalls.report },
      ground: ground.report,
      water: water.report,
      plants,
      areas: areas.report,
      layers: t0.layers.map((l) => l.material),
      layout,
      buildings: buildings.report,
      plots,
      furniture,
      pois,
      life,
      ms,
      warnings,
    },
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * The address line, name and id of a place's map: the place's name as the
 * search list showed it when given ("Am Thorwengert 6, Miltenberg"), else
 * the label of the search line (placeLabel: never a bare house number),
 * `osm-am-thorwengert-6-miltenberg` (a taken id gets a number in the store);
 * the coordinates without a search
 */
export function osmMapNames(place: { lat: number; lon: number; address?: string; name?: string }): { address: string; id: string; name: string } {
  const searched = place.address?.trim();
  const address = searched || `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;
  const name = place.name?.trim() || (searched ? placeLabel(searched) : address);
  return { address, name, id: `osm-${slugMapId(name)}`.slice(0, 64) };
}

/** A place's streets before its map is made: the frame draws and drops the spawns on them (OsmLayout) */
export interface OsmStreets {
  frame: OsmFrame;
  layout: OsmLayout;
  roads: RoadStats;
  parse: OsmParseStats;
  /** The landmarks near the HQ's place, the best first (the frame offers to put the HQ there) */
  landmarks: Landmark[];
}

/** The street graph of `input`'s place as the map will have it, with its HQ, without ground or paint */
/** `landmarksAround`: where the landmarks are looked for (the place searched for, when the HQ went to one); the HQ's place when absent */
export function osmStreets(input: Pick<OsmImportInput, 'lat' | 'lon' | 'place' | 'overpass'>, sideM = OSM_WORLD_SIDE, landmarksAround?: { lat: number; lon: number }): OsmStreets {
  const frame = new OsmFrame(input.lat, input.lon);
  const features = parseOsm(input.overpass, frame, sideM / 2);
  const roads = buildRoads(features);
  const place = input.place && frame.point(input.place);
  const layout = new OsmLayout({ paths: roads.paths, terrain: { width: sideM, depth: sideM } }, roads.names, place, spawnAnchors(features));
  const around = landmarksAround ? frame.point(landmarksAround) : (place ?? { x: 0, y: 0 });
  const landmarks = findLandmarks(features, around, OSM_LANDMARK_REACH);
  return { frame, layout, roads: roads.stats, parse: features.stats, landmarks };
}

/** What loading a place's data took, for the report */
export interface OsmDownloadStats {
  /** Both came from the frame store: nothing was fetched */
  stored: boolean;
  osmMs: number;
  /** JSON characters of the Overpass answers */
  osmChars: number;
  osmRequests: number;
  demMs: number;
  demTiles: number;
  demBytes: number;
}


/**
 * What convertOsm reads for a place: from the frame store when it holds the
 * place, else downloaded (the Overpass answer and the elevation tiles at
 * once) and kept there. Heights the store lacks (no source delivered last
 * time) are asked again. Rejects with a sentence for the player when the
 * OSM servers do not answer.
 */
export async function loadOsmInput(
  place: { lat: number; lon: number; address?: string },
  options: {
    sideM?: number;
    store?: OsmFrameStore;
    decode?: DemDecoder;
    signal?: AbortSignal;
    /** Hears the steps: the store, the Overpass answer and the heights side by side (osm-progress.ts) */
    onProgress?: (progress: OsmProgress) => void;
    /** Hears each round of the Overpass servers about to be asked again */
    onRetry?: (retry: OverpassRetry) => void;
  } = {},
): Promise<{ input: OsmImportInput; download: OsmDownloadStats }> {
  const { lat, lon } = place;
  const side = options.sideM ?? OSM_WORLD_SIDE;
  const box = osmQueryBox(lat, lon, side, OSM_QUERY_MARGIN);
  const report = options.onProgress ?? (() => undefined);
  report({ step: 'stored' });
  const stored = await options.store?.load(lat, lon, side);
  report({ step: 'stored', state: 'done', detail: { key: stored ? 'found' : 'nothingKept' } });
  const askDem = () => {
    report({ step: 'heights' });
    return downloadDem(box, { decode: options.decode, signal: options.signal, onTile: (done, of) => report({ step: 'heights', share: done / of, detail: { key: 'tiles', v: { done, of } } }) }).then(
      (got) => {
        report({ step: 'heights', state: 'done', detail: { key: 'tileCount', v: { n: got.tiles } } });
        return got;
      },
      (e: Error) => {
        if (options.signal?.aborted) throw e;
        report({ step: 'heights', state: 'failed', detail: { key: 'noHeights' } });
        return { error: e.message };
      },
    );
  };
  const askOsm = () => {
    report({ step: 'overpass' });
    return downloadOsm(
      box,
      options.signal,
      options.onRetry,
      (bytes) => report({ step: 'overpass', detail: { key: 'received', v: { chars: bytes } } }),
      // A sign of life for the session's watch while a round waits on slow servers, one after the other
      (host) => report({ step: 'overpass', detail: { key: 'asking', v: { host } } }),
    ).then(
      (got) => {
        report({ step: 'overpass', state: 'done', detail: { key: 'size', v: { chars: got.chars } } });
        return got;
      },
      (e: Error) => {
        if (options.signal?.aborted) throw e;
        report({ step: 'overpass', state: 'failed' });
        throw overpassFailure(e.message);
      },
    );
  };
  const [osm, dem] = await Promise.all([stored ? null : askOsm(), stored?.dem ? null : askDem()]);
  const got = dem && !('error' in dem) ? dem : null;
  const mosaic = stored?.dem ?? got?.mosaic ?? null;
  const demFailed = stored?.dem ? stored.demFailed : got ? got.failed.map((f) => `${f.source}: ${f.reason}`) : [dem && 'error' in dem ? dem.error : ''];
  const fetchedAt = stored?.fetchedAt ?? new Date().toISOString();
  const overpass = stored?.overpass ?? osm!.data;
  if (!stored || (!stored.dem && mosaic)) await options.store?.save({ lat, lon, sideM: side, fetchedAt, overpass, dem: mosaic, demFailed });
  return {
    input: { lat, lon, address: place.address, overpass, dem: mosaic, fetchedAt, demFailed },
    download: {
      stored: !osm && !dem,
      osmMs: Math.round(osm?.ms ?? 0),
      osmChars: osm?.chars ?? 0,
      osmRequests: osm?.requests ?? 0,
      demMs: Math.round(got?.ms ?? 0),
      demTiles: got?.tiles ?? 0,
      demBytes: got?.bytes ?? 0,
    },
  };
}

/** What the player reads when no OSM server gave the place's data */
export function overpassFailure(reason: string): OsmError {
  return new OsmError(/\b429\b/.test(reason) ? { key: 'busy' } : { key: 'down', v: { reason } });
}
