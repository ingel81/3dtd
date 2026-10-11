/**
 * Warcraft 3 map (.w3x/.w3m) to a custom map document.
 *
 * Reads the archive (`readW3xFiles`), finds the walking routes
 * (`extractRoutes`: script patterns, script evaluation, terrain), and builds
 * the document: terrain with cliffs, water and ground layers, the route
 * graph as roads, spawns and HQ, doodads as catalogue objects, and an
 * environment from the tileset. Pure and DOM-free, so it runs in a Web
 * Worker (`w3x.worker.ts`), in Node and in specs.
 *
 * Scale: one Warcraft tile (128 units) is `metresPerTile` metres, 4 by
 * default. Tower defense lanes are two to three tiles wide and routes 10k to
 * 21k units long; at 4 m a tile that is 8 to 12 m wide roads and 300 to 650 m
 * routes, the width of a street and the reach of our spawn portals on real
 * maps (200 to 1500 m).
 */

import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { slugMapId } from '../custom-map/map-create';
import {
  MAP_FORMAT,
  MAP_VERSION,
  type CustomMapDocument,
  type MapObject,
  type MapPathEdge,
  type MapPaths,
  type MapSpawn,
} from '../custom-map/map-document';
import { W3_TILE } from './formats/w3e';
import { plainText } from './formats/wts';
import { type CatalogEntryRef } from './convert/ground-materials';
import { AssetPicker, BLOCKER_IDS, type AssetCategory, doodadCategory, hashIndex } from './convert/doodad-assets';
import { mapEnvironment, tilesetMood, waterColor } from './convert/environment';
import { ImportFrame, convertTerrain } from './convert/terrain-convert';
import { type ImportStyle, enhanceGround, rimTrees } from './convert/enhance';
import { HeightField } from '../custom-map/render/height-field';
import { type W3xMapFiles, playableBounds, readW3xFiles } from './map-files';
import { type Bounds, type LaneMask, buildLaneMask, laneWidth } from './routes/lane-mask';
import { type RouteGraph, type RouteStrategy, routeLengths } from './routes/route-graph';
import { extractRoutes } from './routes/extract-routes';

export interface W3xImportOptions {
  /** File name for meta.source and the fallback map name */
  fileName?: string;
  /** Map id; default from the map name */
  id?: string;
  /** Metres per Warcraft tile (128 units), default 4 */
  metresPerTile?: number;
  /** Import only the playable area (default true) */
  cropToPlayable?: boolean;
  /** Height samples per tile edge, 1 to 8 (default 4: cliffs become steps a quarter tile wide) */
  samplesPerTile?: number;
  /** Slopes steeper than this show the cliff material (default 50 degrees) */
  cliffAngle?: number;
  /** Catalogue materials and objects (id and category) to map onto; default: the planned catalogue ids */
  catalog?: { materials: CatalogEntryRef[]; objects: CatalogEntryRef[] };
  /** Most objects to place; more are thinned evenly (default 6000) */
  maxObjects?: number;
  /** Force one route strategy (comparisons, tests) */
  routeStrategy?: RouteStrategy;
  /**
   * 'enhanced' (default): the ground painted by what it is in the game
   * (meadow on build ground, paved roads with gravel edges, forest on the
   * rims with extra trees, convert/enhance.ts); 'original': the Warcraft
   * tiles' textures mapped one to one
   */
  style?: ImportStyle;
  now?: Date;
}

export interface W3xImportStats {
  mapName: string;
  style: ImportStyle;
  tileset: string;
  /** Imported area in tiles and metres */
  tiles: { width: number; height: number };
  metres: { width: number; depth: number };
  heightSamples: number;
  splatResolution: number;
  layers: string[];
  /** Ground tile id -> material */
  groundMaterials: Record<string, string>;
  waterSamples: number;
  spawns: number;
  pathNodes: number;
  pathEdges: number;
  /** Per spawn: route length in metres along the first way to the HQ */
  routeLengths: Record<string, number>;
  /** Lane widths in metres: min, median, max over the edges */
  laneWidths: { min: number; median: number; max: number } | null;
  laneMask: LaneMask['source'] | null;
  objects: {
    doodads: number;
    placed: number;
    /** Trees the enhanced style planted on the rims */
    rimTrees: number;
    outside: number;
    helpers: number;
    onLanes: number;
    thinned: number;
    noAsset: number;
    special: number;
    byCategory: Record<string, number>;
    byAsset: Record<string, number>;
  };
}

export interface W3xImportReport {
  /** The route strategy that produced the paths, or null when none did */
  strategy: RouteStrategy | null;
  attempts: { strategy: RouteStrategy; result: string }[];
  warnings: string[];
  stats: W3xImportStats;
}

export interface W3xImportResult {
  doc: CustomMapDocument;
  report: W3xImportReport;
}

export const DEFAULT_METRES_PER_TILE = 4;
export const DEFAULT_SAMPLES_PER_TILE = 4;
export const DEFAULT_CLIFF_ANGLE = 50;
/** Lane width when the pathing map cannot measure one, in tiles */
const DEFAULT_LANE_TILES = 2.5;
const MAX_LANE_TILES = 6;
const MIN_LANE_TILES = 1;

export async function importW3x(bytes: ArrayBuffer | Uint8Array, options: W3xImportOptions = {}): Promise<W3xImportResult> {
  return importW3xSync(bytes, options);
}

export function importW3xSync(bytes: ArrayBuffer | Uint8Array, options: W3xImportOptions = {}): W3xImportResult {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return convertW3x(readW3xFiles(data), options);
}

export function convertW3x(map: W3xMapFiles, options: W3xImportOptions = {}): W3xImportResult {
  const warnings = [...map.warnings];
  const metresPerTile = options.metresPerTile ?? DEFAULT_METRES_PER_TILE;
  if (!(metresPerTile > 0)) throw new Error('metresPerTile must be above 0');
  const scale = metresPerTile / W3_TILE;
  const samplesPerTile = Math.max(1, Math.min(8, Math.round(options.samplesPerTile ?? DEFAULT_SAMPLES_PER_TILE)));
  const t = map.terrain;
  const tileset = map.info?.tileset || t.tileset;
  const bounds: Bounds =
    options.cropToPlayable === false
      ? { minX: t.offsetX, minY: t.offsetY, maxX: t.offsetX + (t.width - 1) * W3_TILE, maxY: t.offsetY + (t.height - 1) * W3_TILE }
      : playableBounds(map);
  const frame = new ImportFrame(bounds, scale);

  const mapName = plainText(map.info?.name ?? '') || (options.fileName ?? 'Warcraft map').replace(/\.w3[xm]$/i, '');
  const terrainResult = convertTerrain(t, frame, {
    samplesPerTile,
    catalog: options.catalog?.materials,
    waterColor: waterColor(tileset, map.info),
    cliffAngle: options.cliffAngle ?? DEFAULT_CLIFF_ANGLE,
  });
  warnings.push(...terrainResult.warnings);

  // Routes, roads, spawns, HQ
  const routes = extractRoutes(map, bounds, { only: options.routeStrategy });
  warnings.push(...routes.warnings);
  const mask = buildLaneMask(map.pathing, t, bounds);
  const graph = routes.graph;
  const { paths, spawns, hq, widths } = convertRoutes(graph, frame, mask);
  if (!graph) warnings.push('routes: no way from a spawn to an end found; the map has no roads, add them in the editor');
  if (spawns.length > MAX_SPAWN_PORTALS) {
    warnings.push(`routes: ${spawns.length} spawns; the game shows portals for the first ${MAX_SPAWN_PORTALS}`);
  }

  const picker = new AssetPicker(tileset, options.catalog?.objects);
  const objects = convertDoodads(map, frame, picker, paths, options.maxObjects ?? 6000);
  if (objects.stats.thinned > 0) warnings.push(`objects: ${objects.stats.thinned} thinned out to stay under ${options.maxObjects ?? 6000}`);
  if (objects.stats.noAsset > 0) warnings.push(`objects: ${objects.stats.noAsset} without a matching catalogue asset`);

  const style = options.style ?? 'enhanced';
  let objectList = objects.list;
  let rimTreeCount = 0;
  if (style === 'enhanced') {
    const g0 = terrainResult.terrain.grid;
    const enhanceInput = {
      terrain: t,
      frame,
      pathing: map.pathing,
      paths,
      width: terrainResult.terrain.width,
      depth: terrainResult.terrain.depth,
      samples: Math.max(g0.columns, g0.rows),
      tileset,
      catalog: options.catalog?.materials,
    };
    const ground = enhanceGround(enhanceInput);
    terrainResult.terrain.layers = ground.layers;
    terrainResult.terrain.splat = ground.splat;
    const field = new HeightField(g0, terrainResult.terrain.width, terrainResult.terrain.depth);
    const water = terrainResult.terrain.water;
    const isWater = (x: number, y: number): boolean => {
      if (!water) return false;
      const i = Math.round((x + terrainResult.terrain.width / 2) / g0.cellSize);
      const j = Math.round((y + terrainResult.terrain.depth / 2) / g0.cellSize);
      return water.mask[j * g0.columns + i] > 0;
    };
    const trees = rimTrees(
      enhanceInput,
      objects.list,
      (x, y) => field.slopeAt(x, y),
      isWater,
      (options.maxObjects ?? 6000) - objects.list.length,
    );
    rimTreeCount = trees.length;
    objectList = [...objects.list, ...trees];
  }

  const now = (options.now ?? new Date()).toISOString();
  const doc: CustomMapDocument = {
    format: MAP_FORMAT,
    version: MAP_VERSION,
    meta: {
      id: options.id ?? slugMapId(mapName),
      name: mapName,
      author: plainText(map.info?.author ?? ''),
      description: plainText(map.info?.description ?? '').slice(0, 2000),
      createdAt: now,
      updatedAt: now,
      source: { kind: 'w3x', file: options.fileName ?? '', mapName, tileset: tilesetMood(tileset).name },
    },
    terrain: terrainResult.terrain,
    objects: objectList,
    paths,
    spawns,
    hq,
    environment: mapEnvironment(tileset, map.info, scale),
  };

  const lengths: Record<string, number> = {};
  if (graph) {
    for (const [id, len] of routeLengths(graph)) {
      lengths[graph.nodes.find((n) => n.id === id)?.name ?? id] = Math.round(len * scale);
    }
  }
  const sortedWidths = [...widths].sort((a, b) => a - b);
  const g = doc.terrain.grid;
  return {
    doc,
    report: {
      strategy: graph?.strategy ?? null,
      attempts: routes.attempts,
      warnings,
      stats: {
        mapName,
        tileset: tilesetMood(tileset).name,
        tiles: { width: Math.round((bounds.maxX - bounds.minX) / W3_TILE), height: Math.round((bounds.maxY - bounds.minY) / W3_TILE) },
        metres: { width: doc.terrain.width, depth: doc.terrain.depth },
        heightSamples: g.columns * g.rows,
        splatResolution: doc.terrain.splat.resolution,
        layers: doc.terrain.layers.map((l) => l.material),
        groundMaterials: Object.fromEntries(terrainResult.materials),
        waterSamples: terrainResult.waterSamples,
        spawns: spawns.length,
        pathNodes: paths.nodes.length,
        pathEdges: paths.edges.length,
        routeLengths: lengths,
        laneWidths: sortedWidths.length
          ? {
              min: round1(sortedWidths[0]),
              median: round1(sortedWidths[Math.floor(sortedWidths.length / 2)]),
              max: round1(sortedWidths[sortedWidths.length - 1]),
            }
          : null,
        laneMask: mask?.source ?? null,
        style,
        objects: { ...objects.stats, rimTrees: rimTreeCount },
      },
    },
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

function convertRoutes(
  graph: RouteGraph | null,
  frame: ImportFrame,
  mask: LaneMask | null,
): { paths: MapPaths; spawns: MapSpawn[]; hq: { x: number; y: number }; widths: number[] } {
  if (!graph) return { paths: { nodes: [], edges: [] }, spawns: [], hq: { x: 0, y: 0 }, widths: [] };
  const ids = new Map(graph.nodes.map((n, k) => [n.id, `n${k + 1}`]));
  const pos = new Map(graph.nodes.map((n) => [n.id, n]));
  const widths: number[] = [];
  const edges: MapPathEdge[] = graph.edges.map((e, k) => {
    const a = pos.get(e.from)!;
    const b = pos.get(e.to)!;
    const measured = mask ? laneWidth(mask, a, b, MAX_LANE_TILES * W3_TILE) : null;
    const units = Math.max(MIN_LANE_TILES * W3_TILE, Math.min(MAX_LANE_TILES * W3_TILE, measured ?? DEFAULT_LANE_TILES * W3_TILE));
    const width = round1(units * frame.scale);
    widths.push(width);
    return { id: `e${k + 1}`, a: ids.get(e.from)!, b: ids.get(e.to)!, width, kind: 'road' };
  });
  const end = pos.get(graph.end)!;
  return {
    paths: {
      nodes: graph.nodes.map((n) => ({ id: ids.get(n.id)!, x: frame.x(n.x), y: frame.y(n.y) })),
      edges,
    },
    spawns: graph.spawns.map((id, k) => {
      const n = pos.get(id)!;
      return { id: `s${k + 1}`, name: n.name, x: frame.x(n.x), y: frame.y(n.y) };
    }),
    hq: { x: frame.x(end.x), y: frame.y(end.y) },
    widths,
  };
}

const BLOCKING: ReadonlySet<AssetCategory> = new Set(['tree', 'rock', 'building', 'wall']);

function convertDoodads(
  map: W3xMapFiles,
  frame: ImportFrame,
  picker: AssetPicker,
  paths: MapPaths,
  maxObjects: number,
): { list: MapObject[]; stats: W3xImportStats['objects'] } {
  const doodads = map.doodads?.doodads ?? [];
  const stats: W3xImportStats['objects'] = {
    doodads: doodads.length,
    placed: 0,
    rimTrees: 0,
    outside: 0,
    helpers: 0,
    onLanes: 0,
    thinned: 0,
    noAsset: 0,
    special: map.doodads?.special.length ?? 0,
    byCategory: {},
    byAsset: {},
  };
  const nodes = new Map(paths.nodes.map((n) => [n.id, n]));
  const segments = paths.edges.map((e) => ({ a: nodes.get(e.a)!, b: nodes.get(e.b)!, half: e.width / 2 }));
  const onLane = (x: number, y: number, margin: number): boolean =>
    segments.some(({ a, b, half }) => segmentDistance(x, y, a.x, a.y, b.x, b.y) < half + margin);

  const candidates: MapObject[] = [];
  doodads.forEach((d, index) => {
    if (!frame.contains(d.x, d.y)) {
      stats.outside++;
      return;
    }
    if (BLOCKER_IDS.test(d.id) || (d.flags & 3) === 0) {
      stats.helpers++;
      return;
    }
    const category = doodadCategory(d.id);
    const x = frame.x(d.x);
    const y = frame.y(d.y);
    // Blocking scenery on a road would stand in the creeps' way
    if (BLOCKING.has(category) && onLane(x, y, 0.5)) {
      stats.onLanes++;
      return;
    }
    const asset = picker.pick(category, index);
    if (!asset) {
      stats.noAsset++;
      return;
    }
    const size = (Math.abs(d.scaleX) + Math.abs(d.scaleY) + Math.abs(d.scaleZ)) / 3;
    candidates.push({
      id: `o${index + 1}`,
      asset,
      x,
      y,
      z: 0,
      // Warcraft faces counter-clockwise from east, catalogue models face north at 0
      rotation: normaliseAngle(d.angle - Math.PI / 2),
      scale: round2(Math.max(0.3, Math.min(3, size || 1))),
    });
    stats.byCategory[category] = (stats.byCategory[category] ?? 0) + 1;
  });

  // Even thinning by a hash, so the same map always keeps the same objects
  let list = candidates;
  if (candidates.length > maxObjects) {
    const keep = maxObjects / candidates.length;
    list = candidates.filter((_, k) => hashIndex(k, 0x7417) / 0x100000000 < keep).slice(0, maxObjects);
    stats.thinned = candidates.length - list.length;
  }
  for (const o of list) stats.byAsset[o.asset] = (stats.byAsset[o.asset] ?? 0) + 1;
  stats.placed = list.length;
  return { list, stats };
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

function normaliseAngle(a: number): number {
  if (!Number.isFinite(a)) return 0;
  const full = Math.PI * 2;
  return round2(((a % full) + full) % full);
}

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
