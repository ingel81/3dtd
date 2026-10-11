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

export const MAP_FORMAT = '3dtd-map';
/** 2: optional `gameplay` rules (version 1 files have none and read unchanged) */
export const MAP_VERSION = 2;

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

/**
 * Splat weights for up to 8 layers: two RGBA maps of `resolution` x
 * `resolution` texels, layer k in map k >> 2, channel k & 3. Weights of a
 * texel need not add up to 255; the renderer normalises them.
 */
export interface MapSplat {
  resolution: number;
  maps: [Uint8Array, Uint8Array];
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
  scale: number;
  /** Overrides of the catalogue entry */
  blocksLos?: boolean;
  blocksBuild?: boolean;
  tint?: string;
}

export type MapPathKind = 'road' | 'path' | 'bridge';

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
}

export interface MapPaths {
  nodes: MapPathNode[];
  edges: MapPathEdge[];
}

export interface MapSpawn extends MapPoint {
  id: string;
  name: string;
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
}

/** Synthetic lat/lon of a map point (origin (0, 0)) */
export function mapToGeo(p: MapPoint): { lat: number; lon: number } {
  return { lat: p.y / MAP_METERS_PER_DEGREE, lon: p.x / MAP_METERS_PER_DEGREE };
}

export function geoToMap(lat: number, lon: number): MapPoint {
  return { x: lon * MAP_METERS_PER_DEGREE, y: lat * MAP_METERS_PER_DEGREE };
}
