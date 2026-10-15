/**
 * A real place to a custom map document (docs/OSM_WORLD_PLAN.md, phase O1
 * "grey world"): the ground from elevation tiles, the roads from
 * OpenStreetMap as the map's street graph, levelled and painted, the HQ on
 * the place and spawns as on the real places. Land, water, buildings and
 * furniture follow in later phases.
 *
 * `convertOsm` is pure and DOM-free (Node, specs, the worker); `fetchOsmInput`
 * downloads what it reads (Overpass, elevation tiles).
 */
import { OSM_MAP_ATTRIBUTION } from '../../configs/attributions.config';
import { createMapDocument, slugMapId } from '../custom-map/map-create';
import type { CustomMapDocument } from '../custom-map/map-document';
import { DEM_SOURCES, downloadDem, type DemDecoder, type DemMosaic } from './dem-tiles';
import { OsmFrame, parseOsm, type OsmParseStats } from './osm-parse';
import { downloadOsm, osmQueryBox } from './osm-query';
import type { OverpassResponse } from './overpass-client';
import { buildRoads, levelRoads, paintRoads, type RoadStats } from './convert/roads';
import { fillOsmTerrain } from './convert/terrain';
import { paintGround, type GroundReport } from './convert/ground';
import { carveWater, paintWater, settleWater, WATER_MATERIALS, type WaterPaintRole, type WaterReport } from './convert/water';
import { layOut, type LayoutReport } from './convert/layout';

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
  now?: Date;
}

export interface OsmImportReport {
  place: { lat: number; lon: number; address: string };
  sideM: number;
  grid: { columns: number; rows: number; cellSize: number; splat: number };
  parse: OsmParseStats;
  terrain: { dem: string | null; zeroM: number; minM: number; maxM: number; demFailed: string[] };
  roads: RoadStats;
  ground: GroundReport;
  water: WaterReport;
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

/** The map of `input`'s place */
export function convertOsm(input: OsmImportInput, options: OsmImportOptions = {}): OsmImportResult {
  const ms: Record<string, number> = {};
  let t = performance.now();
  const step = (name: string) => {
    const now = performance.now();
    ms[name] = Math.round(now - t);
    t = now;
  };
  const warnings: string[] = [];
  const side = options.sideM ?? OSM_WORLD_SIDE;
  const searched = input.address?.trim();
  const address = searched || `${input.lat.toFixed(5)}, ${input.lon.toFixed(5)}`;
  const name = options.name ?? (searched ? `Map of ${searched.split(',')[0]}` : `Map at ${address}`);
  const doc = createMapDocument({
    id: options.id ?? `osm-${slugMapId(address)}`.slice(0, 64),
    name,
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
  step('ground');
  paintWater(t0, water);
  step('shores');
  paintRoads(t0, doc.paths);
  step('paint');

  const layout = layOut(doc, roads.names, { spawns: options.spawns ?? OSM_SPAWNS });
  if (layout.spawns.length < layout.wanted) {
    warnings.push(`spawns: ${layout.spawns.length} of ${layout.wanted} found on streets 500 to 1000 m from the HQ with a route to it`);
  }
  step('layout');

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
      layers: t0.layers.map((l) => l.material),
      layout,
      ms,
      warnings,
    },
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** Downloads what convertOsm reads for a place: the Overpass answer and the elevation tiles, at once */
export async function fetchOsmInput(
  lat: number,
  lon: number,
  options: { address?: string; sideM?: number; decode?: DemDecoder; signal?: AbortSignal } = {},
): Promise<{ input: OsmImportInput; download: { osmMs: number; osmChars: number; osmRequests: number; demMs: number; demTiles: number; demBytes: number } }> {
  const side = options.sideM ?? OSM_WORLD_SIDE;
  const box = osmQueryBox(lat, lon, side, OSM_QUERY_MARGIN);
  const [osm, dem] = await Promise.all([
    downloadOsm(box, options.signal),
    downloadDem(box, { decode: options.decode, signal: options.signal }).catch((e: Error) => {
      if (options.signal?.aborted) throw e;
      return { error: e.message };
    }),
  ]);
  const got = 'error' in dem ? null : dem;
  return {
    input: {
      lat,
      lon,
      address: options.address,
      overpass: osm.data,
      dem: got?.mosaic ?? null,
      fetchedAt: new Date().toISOString(),
      demFailed: got ? got.failed.map((f) => `${f.source}: ${f.reason}`) : ['error' in dem ? dem.error : ''],
    },
    download: {
      osmMs: Math.round(osm.ms),
      osmChars: osm.chars,
      osmRequests: osm.requests,
      demMs: Math.round(got?.ms ?? 0),
      demTiles: got?.tiles ?? 0,
      demBytes: got?.bytes ?? 0,
    },
  };
}
