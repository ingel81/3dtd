/**
 * A real place to a custom map document (docs/OSM_WORLD_PLAN.md, phase O1
 * "grey world"): the ground from elevation tiles, the roads from
 * OpenStreetMap as the map's street graph, levelled and painted, the HQ on
 * the place and spawns as on the real places. Land, water, buildings and
 * furniture follow in later phases.
 *
 * `convertOsm` is pure and DOM-free (Node, specs, the worker); `loadOsmInput`
 * downloads what it reads (Overpass, elevation tiles) or takes it from the
 * frame store.
 */
import { OSM_MAP_ATTRIBUTION } from '../../configs/attributions.config';
import { createMapDocument, slugMapId } from '../custom-map/map-create';
import type { CustomMapDocument } from '../custom-map/map-document';
import { DEM_SOURCES, downloadDem, type DemDecoder, type DemMosaic } from './dem-tiles';
import { OsmFrame, parseOsm, type OsmParseStats } from './osm-parse';
import type { OsmFrameStore } from './osm-frame-store';
import { downloadOsm, osmQueryBox } from './osm-query';
import type { OverpassResponse } from './overpass-client';
import { buildRoads, levelRoads, paintRoads, type RoadStats } from './convert/roads';
import { fillOsmTerrain } from './convert/terrain';
import { paintGround, placeMood, type GroundReport } from './convert/ground';
import { growVegetation, type VegetationReport } from './convert/vegetation';
import { objectCost } from '../custom-map/render/objects/scene-cost';
import { carveWater, paintWater, settleWater, WATER_MATERIALS, type WaterPaintRole, type WaterReport } from './convert/water';
import { layOut, OsmLayout, type LayoutReport } from './convert/layout';

/** Side of an OSM world, metres: always 2.4 km (decision 2 of the plan), spawns up to 1000 m from the HQ in the middle */
export const OSM_WORLD_SIDE = 2400;
/** Metres the query reaches past the map's edge, so a way leaving the map brings its next node */
export const OSM_QUERY_MARGIN = 100;
/** Splat texels per side of an OSM world (decision 10 of the plan) */
export const OSM_SPLAT_RESOLUTION = 2048;
/** Spawns an OSM world gets */
export const OSM_SPAWNS = 4;

/** What the conversion reads: the place, the Overpass answer and the heights */
export interface OsmImportInput {
  lat: number;
  lon: number;
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
  /**
   * Scene cost per plant asset on this map (vegetation.ts plantCosts, from
   * the catalogue): the plants are held to their budget by it. An asset
   * missing counts as an unknown object (dearer, so the forests come out
   * thinner)
   */
  plantCosts?: Record<string, number>;
}

/** One step of the conversion, for the progress list */
export type OsmConvertStep = 'parse' | 'terrain' | 'roads' | 'water' | 'level' | 'ground' | 'shores' | 'paint' | 'layout' | 'plants';

export interface OsmImportReport {
  place: { lat: number; lon: number; address: string };
  sideM: number;
  grid: { columns: number; rows: number; cellSize: number; splat: number };
  parse: OsmParseStats;
  terrain: { dem: string | null; zeroM: number; minM: number; maxM: number; demFailed: string[] };
  roads: RoadStats;
  ground: GroundReport;
  water: WaterReport;
  plants: VegetationReport;
  layers: string[];
  layout: LayoutReport;
  /** Milliseconds per step */
  ms: Record<string, number>;
  warnings: string[];
}

export interface OsmImportResult {
  doc: CustomMapDocument;
  report: OsmImportReport;
}

/** The map of `input`'s place; `onStep` hears each step as it begins */
export function convertOsm(input: OsmImportInput, options: OsmImportOptions = {}, onStep?: (step: OsmConvertStep) => void): OsmImportResult {
  const ms: Record<string, number> = {};
  let t = performance.now();
  const order: OsmConvertStep[] = ['parse', 'terrain', 'roads', 'water', 'level', 'ground', 'shores', 'paint', 'layout', 'plants'];
  const step = (name: string) => {
    const now = performance.now();
    ms[name] = Math.round(now - t);
    t = now;
    // The step after the one just ended ('setup' comes before the first)
    const next = order[order.indexOf(name as OsmConvertStep) + 1];
    if (next) onStep?.(next);
  };
  const warnings: string[] = [];
  const side = options.sideM ?? OSM_WORLD_SIDE;
  const { address, id, name } = osmMapNames(input);
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
  if (!input.dem) warnings.push('heights: no elevation tiles came, the ground is flat');
  step('terrain');

  const roads = buildRoads(features);
  doc.paths = roads.paths;
  if (!roads.paths.edges.length) warnings.push('roads: no roads in this place; the map has nowhere for enemies to walk');
  if (roads.stats.tunnels) warnings.push(`roads: ${roads.stats.tunnels} tunnels left out (${roads.stats.tunnelM} m), they come with their portals later`);
  step('roads');

  // Water before the roads level the ground, settled after: a road through water stands on a dam
  const water = carveWater(t0, features, doc.paths, terrain.zeroM);
  const zeroM = water.report.coast ? 0 : terrain.zeroM;
  warnings.push(...water.warnings);
  step('water');

  levelRoads(t0, doc.paths);
  settleWater(t0, water);
  step('level');
  // The land takes the layers the roads' surfaces and the water's shores leave
  const wetMaterials = (Object.keys(WATER_MATERIALS) as WaterPaintRole[]).filter((r) => water.paint[r].some((v) => v > 0)).map((r) => WATER_MATERIALS[r]);
  const ground = paintGround(t0, features, new Set([...doc.paths.edges.flatMap((e) => (e.surface ? [e.surface] : [])), ...wetMaterials]));
  Object.assign(doc.environment, placeMood(features));
  step('ground');
  paintWater(t0, water);
  step('shores');
  paintRoads(t0, doc.paths);
  step('paint');

  const at = options.spawnsAt?.map((p) => frame.point(p));
  const layout = layOut(doc, roads.names, { spawns: options.spawns ?? OSM_SPAWNS, at });
  if (layout.spawns.length < layout.wanted) {
    warnings.push(at
      ? `spawns: ${layout.wanted - layout.spawns.length} of ${layout.wanted} chosen have no street with a route to the HQ and were left out`
      : `spawns: ${layout.spawns.length} of ${layout.wanted} found on streets 500 to 1000 m from the HQ with a route to it`);
  }
  step('layout');

  const unknownCost = objectCost(undefined, side * side);
  const plants = growVegetation(doc, features, ground.land, water, { costOf: (asset) => options.plantCosts?.[asset] ?? unknownCost });
  step('plants');

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
      ground: ground.report,
      water: water.report,
      plants,
      layers: t0.layers.map((l) => l.material),
      layout,
      ms,
      warnings,
    },
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * The address line, name and id of a place's map: the first part of the
 * search ("Miltenberg" of "Miltenberg, Bayern, Deutschland"), `osm-miltenberg`
 * (a taken id gets a number in the store); the coordinates without a search
 */
export function osmMapNames(place: { lat: number; lon: number; address?: string }): { address: string; id: string; name: string } {
  const searched = place.address?.trim();
  const address = searched || `${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`;
  const name = searched ? searched.split(',')[0].trim() || searched : address;
  return { address, name, id: `osm-${slugMapId(name)}`.slice(0, 64) };
}

/** A place's streets before its map is made: the frame draws and drops the spawns on them (OsmLayout) */
export interface OsmStreets {
  frame: OsmFrame;
  layout: OsmLayout;
  roads: RoadStats;
  parse: OsmParseStats;
}

/** The street graph of `input`'s place as the map will have it, with its HQ, without ground or paint */
export function osmStreets(input: Pick<OsmImportInput, 'lat' | 'lon' | 'overpass'>, sideM = OSM_WORLD_SIDE): OsmStreets {
  const frame = new OsmFrame(input.lat, input.lon);
  const features = parseOsm(input.overpass, frame, sideM / 2);
  const roads = buildRoads(features);
  const layout = new OsmLayout({ paths: roads.paths, terrain: { width: sideM, depth: sideM } }, roads.names);
  return { frame, layout, roads: roads.stats, parse: features.stats };
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

/** Which download is under way, for the progress line */
export type OsmLoadStep = 'stored' | 'download';

/**
 * What convertOsm reads for a place: from the frame store when it holds the
 * place, else downloaded (the Overpass answer and the elevation tiles at
 * once) and kept there. Heights the store lacks (no source delivered last
 * time) are asked again. Rejects with a sentence for the player when the
 * OSM servers do not answer.
 */
export async function loadOsmInput(
  place: { lat: number; lon: number; address?: string },
  options: { sideM?: number; store?: OsmFrameStore; decode?: DemDecoder; signal?: AbortSignal; onStep?: (step: OsmLoadStep) => void } = {},
): Promise<{ input: OsmImportInput; download: OsmDownloadStats }> {
  const { lat, lon } = place;
  const side = options.sideM ?? OSM_WORLD_SIDE;
  const box = osmQueryBox(lat, lon, side, OSM_QUERY_MARGIN);
  const stored = await options.store?.load(lat, lon, side);
  options.onStep?.(stored ? 'stored' : 'download');
  const askDem = () =>
    downloadDem(box, { decode: options.decode, signal: options.signal }).catch((e: Error) => {
      if (options.signal?.aborted) throw e;
      return { error: e.message };
    });
  const askOsm = () =>
    downloadOsm(box, options.signal).catch((e: Error) => {
      if (options.signal?.aborted) throw e;
      throw new Error(overpassFailure(e.message));
    });
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
export function overpassFailure(reason: string): string {
  if (/\b429\b/.test(reason)) return 'The OpenStreetMap servers are busy with too many requests from your address. Wait a minute and try again.';
  return `The OpenStreetMap servers did not answer (${reason}). They are sometimes down for a while; try again in a few minutes.`;
}
