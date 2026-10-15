/**
 * The custom map document: everything a hand-built or imported map holds.
 *
 * Map space is metres with the origin in the middle of the map, `x` east and
 * `y` north; heights are metres above the map's zero. The game places the map
 * around the synthetic origin (0, 0) in lat/lon (see `mapToGeo`), so every
 * system that works in lat/lon sees an undistorted map.
 *
 * This is the in-memory form. The editor, the importers and the renderer all
 * work on it; `map-file.ts` packs it into a `.3dtdmap` file.
 */

import type { MapLanes } from './lane-choice';

export const MAP_FORMAT = '3dtd-map';
/**
 * 2: optional `gameplay` rules (version 1 files have none and read unchanged).
 * 3: a third splat map for ground layers 9 to 12 (older files have at most 8 layers and read unchanged)
 */
export const MAP_VERSION = 3;

/** Metres per degree in the synthetic frame, the factor `geoToLocalSimple` uses at latitude 0 */
export const MAP_METERS_PER_DEGREE = 111320;

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapMeta {
  /** Stable id, lowercase letters, digits and dashes */
  id: string;
  name: string;
  author: string;
  description: string;
  /** ISO times */
  createdAt: string;
  updatedAt: string;
  /** Where the map came from, when it was imported */
  source?: { kind: 'w3x'; file: string; mapName: string; tileset?: string };
  /**
   * The map's identity across files and renames, given when a map is first
   * stored as one's own; a copy gets a new one. A file read in again finds
   * its map by it (to replace it instead of adding a copy). Not part of the
   * content hash
   */
  uid?: string;
  /**
   * The shipped or coop map this one is the own copy of, with that map's
   * content hash when copied: "Edit" on it opens this copy again, and offers
   * a fresh one when the original changed since. Not part of the content hash
   */
  copyOf?: { id: string; hash: string };
}

/**
 * A regular height grid over the whole map. Sample (i, j) sits at
 * x = -width/2 + i * cellSize, y = -depth/2 + j * cellSize, row-major with j
 * as the row: index = j * columns + i.
 */
export interface MapHeightGrid {
  columns: number;
  rows: number;
  cellSize: number;
  heights: Float32Array;
}

/** One ground material painted onto the terrain, by id from the material catalogue */
export interface MapGroundLayer {
  material: string;
  /** Texture repeat in metres, overrides the catalogue's default */
  scale?: number;
}

/** Most ground layers a map can paint (three RGBA splat maps) */
export const MAX_GROUND_LAYERS = 12;

/**
 * Splat weights for up to 12 layers: RGBA maps of `resolution` x
 * `resolution` texels, layer k in map k >> 2, channel k & 3. Two maps, a
 * third only while the map has more than 8 layers (`splatMapCount`), so a
 * map with fewer pays neither its memory nor its upload. Weights of a texel
 * need not add up to 255; the renderer normalises them.
 */
export interface MapSplat {
  resolution: number;
  maps: Uint8Array[];
}

/** Splat maps a map with `layers` ground layers holds */
export function splatMapCount(layers: number): number {
  return layers > 8 ? 3 : 2;
}

/**
 * Adds the third splat map (empty) when the layer list grew past 8, drops it
 * when it shrank to 8 or fewer (it then holds no layer's weight)
 */
export function fitSplatMaps(t: MapTerrain): void {
  const maps = t.splat.maps;
  const want = splatMapCount(t.layers.length);
  const texels = t.splat.resolution * t.splat.resolution * 4;
  while (maps.length < want) maps.push(new Uint8Array(texels));
  if (maps.length > want) maps.length = want;
}

/**
 * What fills a body: water (lake, pond, river), sea (surf at the shore),
 * swamp (murky, algae), ice (frozen, still) or lava (glowing crust)
 */
export type MapWaterKind = 'water' | 'sea' | 'swamp' | 'ice' | 'lava';

export interface MapWater {
  /** Water surface height in metres */
  level: number;
  /** One byte per height sample (same grid as the terrain): 0 dry, 255 water */
  mask: Uint8Array;
  color: string;
  /** Default 'water' */
  kind?: MapWaterKind;
}

export interface MapRiverPoint extends MapPoint {
  /** Width of the surface in metres */
  width: number;
  /** Surface height in metres; the river flows from the first point to the last */
  height: number;
}

export interface MapRiver {
  id: string;
  kind: 'water' | 'lava';
  /** At least two points */
  points: MapRiverPoint[];
  color?: string;
}

export interface MapTerrain {
  /** Extent in metres */
  width: number;
  depth: number;
  grid: MapHeightGrid;
  layers: MapGroundLayer[];
  splat: MapSplat;
  water: MapWater | null;
  /**
   * Further bodies, each on its own level with its own mask: a lake up the
   * hill, a lava pool, a frozen pond. `water` stays the main body (river,
   * sea); wet banks and the river running on beyond the border follow it only.
   */
  waterBodies?: MapWater[];
  /** Rivers and lava flows along a line, each point with its own width and surface height */
  rivers?: MapRiver[];
  /** Slopes steeper than this (degrees) show the cliff material */
  cliffAngle: number;
  /** Material id for steep faces */
  cliffMaterial: string;
}

/** A placed object from the asset catalogue */
export interface MapObject {
  id: string;
  asset: string;
  x: number;
  y: number;
  /** Height offset over the terrain in metres */
  z: number;
  /** Rotation around the up axis, radians */
  rotation: number;
  /**
   * Tilts after the turn, radians: `pitch` around the model's own x axis,
   * `roll` around its own z axis (a gondola on a sloping cable, a boat
   * stranded on a slope). Default 0
   */
  pitch?: number;
  roll?: number;
  scale: number;
  /** Overrides of the catalogue entry */
  blocksLos?: boolean;
  blocksBuild?: boolean;
  tint?: string;
  /** Objects with the same group are picked and moved together in the editor; the game ignores it */
  group?: string;
}

export type MapPathKind = 'road' | 'path' | 'bridge';

/** What a bridge is built of (default wood) */
export type MapBridgeStyle = 'wood' | 'stone' | 'lava';

export interface MapPathNode extends MapPoint {
  id: string;
}

export interface MapPathEdge {
  id: string;
  a: string;
  b: string;
  /** Width in metres, the corridor width of the route grid */
  width: number;
  kind: MapPathKind;
  /** Optional curve points between a and b */
  via?: MapPoint[];
  /** Bridges only: the deck's material, default wood */
  style?: MapBridgeStyle;
  /**
   * What the road brush built along this edge, so it can be laid anew when
   * the road moves (the editor's; the game ignores it): the ground levelled
   * into an embankment or cutting, the surface painted, the lamps and fences
   * and their ids
   */
  dress?: MapRoadDress;
}

export interface MapRoadDress {
  adapt: boolean;
  /** Ground material painted under the road */
  surface?: string;
  lamps: boolean;
  fences: boolean;
  /** Ids of the lamps and fences it set */
  objects: string[];
  /** The ground of the band before it was levelled, so taking the road back restores it (road-ground.ts) */
  ground?: MapRoadGround;
}

/** Heights of a road's band before and after levelling, packed (editor/ops/landscape/road-ground.ts) */
export interface MapRoadGround {
  /** The grid it was taken on: on another (resized, refined) it is not used */
  columns: number;
  rows: number;
  cell: number;
  /** Metres the values count from, and metres per unit of a value (a millimetre, coarser on a band over 65 m high) */
  base: number;
  step: number;
  /** base64 of runs: row, first column, count, then (before, built) per sample, u16 little endian */
  data: string;
}

export interface MapPaths {
  nodes: MapPathNode[];
  edges: MapPathEdge[];
}

export interface MapSpawn extends MapPoint {
  id: string;
  name: string;
  /** The player may close this lane before wave 1 (TODO E130); always open when missing */
  optional?: boolean;
}

export interface MapEnvironment {
  sky: 'day' | 'dusk' | 'night' | 'overcast';
  /** Sun direction: azimuth from north clockwise and elevation, degrees */
  sunAzimuth: number;
  sunElevation: number;
  fogDensity: number;
  /** Colour grading tint for the map's mood */
  tint: string;
  /** Weather over the whole map; default 'clear' */
  weather?: MapWeather;
  /** 0..1, default 0.6 */
  weatherStrength?: number;
  /** Look of sky, light and air (default temperate) */
  biome?: MapBiome;
  /** 0..1 snow lying on everything that faces up (default: from biome and weather) */
  snowCover?: number;
  /**
   * 0..1 night maps only: a cool moonlight on the land ("day for night"), the
   * sky and stars stay dark and lanterns still stand out. Default 0
   */
  moonlight?: number;
  /** Wind for plants, grass, clouds, smoke and weather; default: the biome's (render/environment/wind.ts) */
  wind?: MapWind;
  /**
   * A photographed sky instead of the procedural one (render/environment/sky-images.ts): its id. The
   * picture also gives light, haze and the water's reflection their colours. Default: procedural; an
   * id this game does not ship renders procedural as well
   */
  skyImage?: string;
}

export interface MapWind {
  /** 0 calm .. 1 a strong wind */
  strength: number;
  /** Where the wind comes from: degrees from north, clockwise */
  direction: number;
  /** 0 steady .. 1 strong gust fronts running over the land */
  gusts: number;
}

export type MapBiome =
  | 'temperate'
  | 'hell'
  | 'moon'
  | 'mars'
  | 'arctic'
  | 'apocalypse'
  | 'swamp'
  | 'desert'
  | 'mountain'
  | 'city';

export type MapWeather = 'clear' | 'rain' | 'snow' | 'fog';

/**
 * One wave of a map's own wave list, the shape of the table wave source
 * (`director/sources/table/wave-table.ts`): enemy type to count, absolute.
 */
export interface MapWaveRow {
  wave: number;
  name: string;
  enemies: Record<string, number>;
  hpMult: number;
  /** Milliseconds between two enemies */
  spawnDelay: number;
  spawnDelayVariation?: number;
  note?: string;
}

export interface MapWaveTable {
  /** After the last row the waves from `fromWave` repeat, their HP times `hpGrowth` per round */
  cycle: { fromWave: number; hpGrowth: number };
  waves: MapWaveRow[];
}

/** Where a map's waves come from: the game's budget source, or the map's own list */
export type MapWaveSource = { kind: 'budget' } | { kind: 'table'; table: MapWaveTable };

/** Rules a map sets for its games; every field is optional, the game's defaults fill the rest */
export interface MapGameplay {
  startCredits?: number;
  /** HQ hit points */
  hqHealth?: number;
  /** Tower type ids the player may build (configs/tower-types.config.ts); all when missing */
  towers?: string[];
  waves?: MapWaveSource;
  /** How many lanes may be open, and what a coop room does with lanes nobody holds (lane-choice.ts) */
  lanes?: MapLanes;
  /** Buildings, walls and structures take damage from shots and fall (TODO E131); off when missing */
  destructible?: boolean;
  /**
   * Percent on the wave budget of the game's waves (budget source), MAP_DIFFICULTY.min to max; 100 when
   * missing. The pressure loop still works on top. A list of the map's own keeps its HP
   */
  difficulty?: number;
}

/** The difficulty a map may set, percent on the wave budget (MapGameplay.difficulty) */
export const MAP_DIFFICULTY = { min: 50, max: 200, normal: 100 } as const;

/** The map's difficulty as a factor on the wave budget, held in MAP_DIFFICULTY; 1 without one */
export function difficultyFactor(gameplay: Pick<MapGameplay, 'difficulty'> | undefined): number {
  const d = gameplay?.difficulty;
  if (typeof d !== 'number' || !Number.isFinite(d)) return 1;
  return Math.min(MAP_DIFFICULTY.max, Math.max(MAP_DIFFICULTY.min, d)) / 100;
}

/**
 * What lives in a life area (map-life.ts): bird flocks, fireflies at night,
 * banks of ground fog, falling leaves, embers, sparks, boats drifting on the
 * water, or an ambient sound
 */
export type MapLifeKind = 'birds' | 'fireflies' | 'fog' | 'leaves' | 'embers' | 'sparks' | 'boats' | 'sound';

/**
 * A stretch of the map with life in it, drawn in the editor's Life tool:
 * an outline (`area`) the life fills, or a line (`route`) it follows (a
 * flock flying along a valley, boats along a river, the sound of a stream).
 * Drawn only; the game's rules never see it
 */
export interface MapLifeArea {
  id: string;
  kind: MapLifeKind;
  shape: 'area' | 'route';
  /** The outline (closed by itself, at least three points) or the line (at least two) */
  points: MapPoint[];
  /** 0.1..3, how much of it (birds, particles, boats); default 1 */
  density?: number;
  /** Birds: how high they fly over the ground, metres (default 40); particles: how high over the ground they start */
  height?: number;
  /** #rrggbb tint of the particles */
  color?: string;
  /** Sound: the ambient sound's id (ambience/ambient-sounds.ts) and its volume 0..1 (default 0.7) */
  sound?: string;
  volume?: number;
  /** Boats: the floating asset that drifts (default a rowboat) */
  asset?: string;
  /** The lowest quality level that shows it (default medium; Low shows no life areas) */
  quality?: 'medium' | 'high';
}

/**
 * Life on the map beyond its objects (TODO E190): the switches of what the
 * map's content brings by itself, a density knob, waving banners, the
 * ambient sound and the life areas. Every field is optional; a map without
 * it looks and sounds as before
 */
export interface MapLife {
  /**
   * Life from the map's content: chimney smoke, fireflies over shores and in
   * woods, birds over open land (each on when missing), sparks over lava
   * (off when missing)
   */
  auto?: { smoke?: boolean; fireflies?: boolean; birds?: boolean; sparks?: boolean };
  /** 0..2, a factor on all of it (the automatic life and the areas); default 1 */
  density?: number;
  /** Banners' cloth waves in the wind, not only the pole swaying */
  flags?: boolean;
  /** The ambient sound over the whole map: a sound id, or 'biome' for the biome's by day and by night; volume 0..1. None when missing */
  ambience?: { sound: string; volume: number };
  areas?: MapLifeArea[];
}

export interface CustomMapDocument {
  format: typeof MAP_FORMAT;
  version: number;
  meta: MapMeta;
  terrain: MapTerrain;
  objects: MapObject[];
  paths: MapPaths;
  spawns: MapSpawn[];
  hq: MapPoint;
  environment: MapEnvironment;
  /** The map's own game rules (version 2); none means the game's defaults */
  gameplay?: MapGameplay;
  /** Life areas, ambient sound and the switches of the map's own life (map-life.ts); optional, no new version */
  life?: MapLife;
}

/** Synthetic lat/lon of a map point (origin (0, 0)) */
export function mapToGeo(p: MapPoint): { lat: number; lon: number } {
  return { lat: p.y / MAP_METERS_PER_DEGREE, lon: p.x / MAP_METERS_PER_DEGREE };
}

export function geoToMap(lat: number, lon: number): MapPoint {
  return { x: lon * MAP_METERS_PER_DEGREE, y: lat * MAP_METERS_PER_DEGREE };
}
