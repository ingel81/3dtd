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
 * 3: a third splat map for ground layers 9 to 12 (older files have at most 8 layers and read unchanged).
 * When to raise it: docs/LEVEL_EDITOR.md, "Formatregeln" (a field an older game must not skip does; a new
 * value of a list or an optional look does not)
 */
export const MAP_VERSION = 4;

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
  /** Where the map came from, when it was imported or made from a real place */
  source?: MapSource;
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
  /**
   * Made from OpenStreetMap and not changed in the editor since: such a map
   * belongs to the world OpenStreetMap (its Recent worlds); the first save
   * with a change drops it, and the map is a Built World from then on
   * (docs/WORLDS_STATE_PLAN.md, 3.6). Not part of the content hash
   */
  generated?: boolean;
}

/** Where a map came from: a Warcraft 3 map, or a real place made from OpenStreetMap (world/osm) */
export type MapSource =
  | { kind: 'w3x'; file: string; mapName: string; tileset?: string }
  | {
      kind: 'osm';
      /** The place in the middle of the map */
      lat: number;
      lon: number;
      /** What the player searched for, or the coordinates */
      address: string;
      /** Side of the square map, metres */
      sideM: number;
      /** ISO time the OSM data was fetched */
      fetchedAt: string;
      /** Where the heights came from (dem-tiles.ts), null for flat ground */
      dem: string | null;
      /** Height above sea level of the map's zero, metres */
      zeroM: number;
      /** Lines to show wherever the map is played */
      attribution: string[];
    };

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

/**
 * A crater the editor's landscape brush dug: the ground holds its bowl.
 * Where it cuts a river, the editor and the game show what the water does
 * (map-ops/crater-water.ts: the lake, the fall over the lip, the dry bed,
 * the spill), as for a crater an impact digs; in the game full from the start
 */
export interface MapCrater {
  /** Middle, map metres */
  x: number;
  y: number;
  /** The bowl's radius to its rim, m */
  radius: number;
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
  /** Craters dug with the landscape brush, the map kit or a script (MapCrater), their lakes where they cut rivers */
  craters?: MapCrater[];
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
  /**
   * A length of row (catalogue `row`, a vine row) drawn this much longer
   * along its model x than its scale makes it, so its run ends where the
   * row ends (an OSM world's vineyards, convert/crop-rows.ts). Default 1;
   * only drawn, the game ignores it
   */
  stretch?: number;
  /** Overrides of the catalogue entry */
  blocksLos?: boolean;
  blocksBuild?: boolean;
  tint?: string;
  /**
   * What a sign shows on the model's sign panel (catalogue `signPanel`): a
   * word in the game's font and a pictogram (render/objects/sign-icons.ts),
   * drawn by render/objects/sign-text.ts. A model without a panel shows
   * nothing; only drawn, the game ignores it
   */
  sign?: MapSign;
  /** False: a building, wall or structure of a destructible map that never takes damage (a town hall that stands) */
  destructible?: boolean;
  /**
   * The stage a destructible map's structure starts the run at, damaged
   * beforehand (1 battered, 2 heavily damaged, 3 a ruin with its rubble,
   * destruction.config.ts); standing when missing
   */
  damage?: MapObjectDamage;
  /** Rolls how the damage beforehand looks (cracks, the bite, the ruin), a whole number; from the id when missing */
  damageSeed?: number;
  /** Objects with the same group are picked and moved together in the editor; the game ignores it */
  group?: string;
  /**
   * A building raised from its own footprint instead of a catalogue model
   * (asset MASS_ASSET, object-mass.ts): an OSM footprint no model fits
   */
  mass?: MapMass;
}

/** Asset of the objects that carry their own building (MapObject.mass): its catalogue entry gives only what all share */
export const MASS_ASSET = 'building-mass';

/** Wall looks of a raised building (`timber`: an old town's half-timbered storeys over a plastered ground floor) */
export const MAP_MASS_FACADES = ['plaster', 'concrete', 'metal', 'brick', 'stone', 'timber'] as const;
export type MapMassFacade = (typeof MAP_MASS_FACADES)[number];

/**
 * Roofs of a raised building: flat with a parapet; pitched over a rectangle
 * (a ridge along its longer side, the rectangle turned any way); `mansard`
 * over any outline without a courtyard: slopes all round up to a flat top
 * drawn in from the walls (object-mass.ts massInset), the roof an old town's
 * crooked houses take; `pyramid` over an outline without a courtyard that
 * its middle sees whole: a slope from every wall up to one point over the
 * middle (a tower's helm, a stair tower's cap; object-mass.ts massApex)
 */
export const MAP_MASS_ROOFS = ['flat', 'gable', 'hip', 'mansard', 'pyramid'] as const;
export type MapMassRoof = (typeof MAP_MASS_ROOFS)[number];

/** What a pitched roof is covered with: clay tiles, slate, sheet metal (copper, zinc); by the facade and the building's salt when missing */
export const MAP_MASS_COVERS = ['tiles', 'slate', 'metal'] as const;
export type MapMassCover = (typeof MAP_MASS_COVERS)[number];

/**
 * One part of a raised building (OSM `building:part`, Simple 3D Buildings):
 * its own outline in the building's frame, from its own floor up to its own
 * eaves, its own roof, walls and colours. A building with parts is drawn as
 * its parts; its own rings stay its ground (the seat, the build bans, the
 * roads, the ruin), and a part that fills what the parts leave of it is a
 * part like the others (the import adds it, convert/building-mass.ts)
 */
export interface MapMassPart {
  /** Its outline, then its courtyards, as MapMass.rings */
  rings: number[][];
  /** Where its walls start over the seat, m (`min_height`): 0 or missing on the ground, a spire's on the tower under it */
  base?: number;
  /** Its walls' top over the seat, m, as MapMass.height */
  height: number;
  /** Storeys from the seat to its top (`building:levels`): its windows line up with its neighbours' */
  floors: number;
  roof: MapMassRoof;
  ridge?: number;
  /** Its walls; the building's when missing */
  facade?: MapMassFacade;
  /** Its walls' colour (#rrggbb); the building's (MapObject.tint) when missing */
  tint?: string;
  /** Its roof's colour (#rrggbb) and covering; the building's when missing */
  roofTint?: string;
  roofCover?: MapMassCover;
}

/**
 * A building raised from its footprint (MapObject.mass): walls up the
 * outline and round each courtyard, a roof over it. In the object's own x
 * and z at scale 1 like a catalogue model's box (object-ground.ts), seated
 * like a building (object-seat.ts); the scale and turn of the object apply.
 */
export interface MapMass {
  /** The outline, then its courtyards: x, z pairs, metres, either way round, not closed (the last point is not the first) */
  rings: number[][];
  /** Height of the walls over the seat, m: the eaves of a pitched roof, the top of a flat roof's parapet */
  height: number;
  /** Storeys, one row of windows each (a hall has one) */
  floors: number;
  roof: MapMassRoof;
  /** A pitched roof's ridge (a mansard's top) over the eaves, m */
  ridge?: number;
  facade: MapMassFacade;
  /**
   * Walls of the outline with a shop on the ground floor (display windows
   * instead of the storey's windows), by index: wall k runs from the
   * outline's point k to point k + 1
   */
  shop?: number[];
  /** The roof's colour (#rrggbb, OSM `roof:colour`) and covering (`roof:material`); by the facade when missing */
  roofTint?: string;
  roofCover?: MapMassCover;
  /**
   * The building as its parts (MapMassPart): drawn are the parts only, the
   * rings above stay its ground; at most MASS_MAX_PARTS (object-mass.ts)
   */
  parts?: MapMassPart[];
}

/**
 * What a surface's lines draw (render/surfaces/): the court or pitch of a
 * sport, a running track, the stalls of a car park, the edge of a platform,
 * the concrete half shells of a runnel (a drain in a vineyard) with the
 * water at its bottom
 */
export type MapSurfaceMarkingKind = 'soccer' | 'handball' | 'basketball' | 'tennis' | 'volleyball' | 'multi' | 'track' | 'parking' | 'platform' | 'runnel';

/**
 * Lines on a surface, in the frame of a turned rectangle: its middle, the
 * direction of its long side (`angle`, radians counter-clockwise from east)
 * and its sides, metres. A court is drawn in its real measures in the middle
 * of the rectangle, smaller when the rectangle is (map-surfaces.ts)
 */
export interface MapSurfaceMarking {
  kind: MapSurfaceMarkingKind;
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  /**
   * A runnel's water across its bottom, metres (at most its width): a
   * trickle when missing (map-surfaces.ts RUNNEL_TRICKLE). A runnel follows
   * its outline, not the rectangle: `width` is the runnel's from lip to lip
   */
  water?: number;
}

/**
 * A surface laid over the ground with a material of its own (TODO E237): a
 * square of setts, a playground's rubber, a pitch with its lines, a car park
 * with its stalls. Drawn only, like the ground's paint: routes, building and
 * the simulation never see it
 */
export interface MapSurface {
  id: string;
  /** Ground material from the catalogue (a map draws at most MAX_SURFACE_MATERIALS, map-surfaces.ts) */
  material: string;
  /** The outline (closed by itself, at least three points) */
  outer: MapPoint[];
  /** Holes in it, each at least three points */
  holes?: MapPoint[][];
  /** Lines drawn on it; none when missing */
  marking?: MapSurfaceMarking;
  /** The group of the objects that belong to it (an OSM world's `osm-a<id>`: the goals of a pitch, the cars of a car park) */
  group?: string;
}

/** The writing of a sign: either or both */
export interface MapSign {
  /** At most MAX_SIGN_TEXT characters */
  text?: string;
  /** A pictogram's id (SIGN_ICONS) */
  icon?: string;
}

/** Characters a sign shows at most */
export const MAX_SIGN_TEXT = 24;

export type MapPathKind = 'road' | 'path' | 'bridge';

/** What a bridge is built of (default wood) */
export type MapBridgeStyle = 'wood' | 'stone' | 'concrete' | 'lava';

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
   * The street type of the real way it was made from (OSM `highway`, an OSM
   * world's): routes weigh it and spawns choose it as on the real places.
   * Without it the kind decides (custom-map-streets.ts)
   */
  street?: string;
  /**
   * The road's ground material (an OSM world's asphalt, pavers, gravel): the
   * road mask leaves the edge out. A paved one (asphalt, concrete, pavers,
   * setts, slabs: road-style.ts PAVED_SURFACES) is laid as a road surface
   * over the ground (render/paths/road-surface.ts), gravel and earth show as
   * the ground painted under the road
   */
  surface?: string;
  /**
   * Metres of pavement either side beyond `width`, behind a kerb (an OSM
   * world's `sidewalk`): drawn by the road surface over the ground, not part
   * of the route corridor. A paved road only
   */
  sidewalk?: number;
  /**
   * The outline of a square (an OSM world's pedestrian area, `area=yes`):
   * routes walk it as any road, but it is neither drawn nor painted, the
   * square's surface (MapSurface) shows the ground
   */
  area?: boolean;
  /**
   * Runs in a tunnel (an OSM world's `tunnel=*`): not drawn, levelled or
   * painted, a portal model stands at each mouth; routes run through it as
   * through a tunnel on a real place, their height between the mouths
   */
  tunnel?: boolean;
  /**
   * Runs through a building (an OSM world's `tunnel=building_passage`,
   * `covered=yes`): drawn, levelled and walked as any road, but holds no
   * building off; routes run under cover there as through a tunnel
   */
  covered?: boolean;
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
  /**
   * The planet in the procedural sky (the moon's Earth): where it stands and how big. Default: the look's
   * (`DEFAULT_PLANET` on the moon, none elsewhere); size 0 shows none
   */
  planet?: MapPlanet;
}

export interface MapPlanet {
  /** Degrees from north, clockwise, as the sun's */
  azimuth: number;
  /** Degrees over the horizon */
  elevation: number;
  /** Apparent diameter, degrees (the Earth from the Moon: 2) */
  size: number;
}

/** The Earth over the moon where a map does not set it: north-east, a third up, twice its true size */
export const DEFAULT_PLANET: MapPlanet = { azimuth: 33, elevation: 33, size: 4 };

/** The planet a map shows: its own setting, else its look's (the moon sees `DEFAULT_PLANET`); size 0 none */
export function planetOf(env: Pick<MapEnvironment, 'planet' | 'biome'>): MapPlanet {
  return env.planet ?? (env.biome === 'moon' ? DEFAULT_PLANET : { ...DEFAULT_PLANET, size: 0 });
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

/** `storm`: heavy rain, a strong wind, lightning and thunder (render/environment/lightning.ts), drawn only */
export type MapWeather = 'clear' | 'rain' | 'snow' | 'fog' | 'storm';

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
  /** Impacts dig craters the enemies walk through (docs/DESTRUCTION_PLAN.md); as `destructible` when missing */
  craters?: boolean;
  /** The enemies passing by wear the structures down; off when missing */
  wear?: boolean;
  /** Percent on every structure's HP, STRUCTURE_HP_SCALE.min to max; 100 when missing */
  structureHp?: number;
  /**
   * Percent on the wave budget of the game's waves (budget source), MAP_DIFFICULTY.min to max; 100 when
   * missing. The pressure loop still works on top. A list of the map's own keeps its HP
   */
  difficulty?: number;
  /** What happens before a wave (TODO E170, wave-events.ts), at most MAX_WAVE_EVENTS */
  events?: MapWaveEvent[];
}

/**
 * Something a map lets happen before wave `wave`: when the build phase
 * before it begins (wave 1: at the start). A message on the screen, the
 * weather or the time of day changing, a spawn portal that opens (its lane
 * runs from that wave on, before it the spawn brings no enemies), objects
 * that appear or go (a gate, a bridge, a wall). The game runs them in its
 * simulation, so every coop client and every replay sees the same
 * (world/custom-map/wave-events.ts).
 */
export type MapWaveEvent =
  | { wave: number; kind: 'message'; text: string }
  | { wave: number; kind: 'weather'; weather: MapWeather; strength?: number }
  | { wave: number; kind: 'time'; hour: number }
  | { wave: number; kind: 'portal'; spawn: string }
  | { wave: number; kind: 'objects'; ids: string[]; show: boolean };

export type MapWaveEventKind = MapWaveEvent['kind'];

/** Wave events a map may have, the last wave one may name, and a message's length */
export const WAVE_EVENT_LIMITS = { events: 64, wave: 200, text: 200, objects: 500 } as const;

/** The percent on the structures' HP a map may set (MapGameplay.structureHp) */
export const STRUCTURE_HP_SCALE = { min: 50, max: 300, normal: 100 } as const;

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
 * banks of ground fog, falling leaves, embers, sparks, snow flurries, dust
 * devils, heat shimmering over hot ground, boats drifting on the water,
 * things moving over the ground (a rover, a herd), or an ambient sound
 */
export type MapLifeKind = 'birds' | 'fireflies' | 'fog' | 'leaves' | 'embers' | 'sparks' | 'snow' | 'dust' | 'surf' | 'haze' | 'boats' | 'movers' | 'sound';

/** What flies in a birds area: small songbirds, gulls, crows and ravens, big birds of prey (eagles, vultures) by day; bats by night */
export type MapBirdSpecies = 'songbirds' | 'gulls' | 'crows' | 'raptors' | 'bats';

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
  /** Sound: metres over which it fades out beyond the outline or the line (LIFE_SOUND_REACH, default 70) */
  reach?: number;
  /** Boats: the floating asset that drifts (default a rowboat); movers: the asset that moves (required) */
  asset?: string;
  /** Birds: what flies (default songbirds) */
  species?: MapBirdSpecies;
  /** Movers: metres per second (default 1.5) */
  speed?: number;
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
  /**
   * A sound once at the start of every wave (a bell, a distant siren, a
   * ship's horn; ambience/ambient-sounds.ts WAVE_SOUNDS), volume 0..1; from
   * the life area `area` names (heard from its place, quieter far off) or
   * everywhere alike. Heard only, the simulation never knows it
   */
  waveSound?: { sound: string; volume: number; area?: string };
  areas?: MapLifeArea[];
}

/** A camera view of a map's intro flight in map space: where the camera stands and the point it looks at */
export interface MapIntroView {
  x: number;
  y: number;
  h: number;
  lookX: number;
  lookY: number;
  lookH: number;
}

/**
 * The map's own intro camera flight (map-intro.ts): through its views in
 * turn (one holds still), or an orbit around the HQ (`angle` the start bearing in
 * radians, 0 east, counter-clockwise; `height` above the HQ's ground;
 * `sweep` degrees, default 360). None plays the game's default tour
 */
export type MapIntro =
  | { kind: 'path'; seconds: number; views: MapIntroView[] }
  | { kind: 'orbit'; seconds: number; radius: number; height: number; angle: number; sweep?: number };

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
  /** Life areas, ambient sound and the switches of the map's own life (map-life.ts); optional, a game without it loses only the look */
  life?: MapLife;
  /** The map's own intro camera flight (map-intro.ts); optional, a game without it flies its default tour */
  intro?: MapIntro;
  /** Surfaces over the ground (squares, pitches, car parks; map-surfaces.ts); optional, a game without them loses only the look */
  surfaces?: MapSurface[];
  /**
   * Prefabs and stamps kept with this map (the editor's; the game ignores
   * them): they travel with its file. Not part of the content hash
   */
  prefabs?: MapPrefab[];
  /**
   * The building footprints OSM has in an OSM world's frame, of any kind
   * (map-footprints.ts), for the developer layer that lays them over the buildings made of them
   * (TODO E290); the game's rules never see them. Not part of the content hash
   */
  footprints?: MapFootprints;
}

/**
 * Building footprints as OpenStreetMap has them, in one array: per ring its
 * point count n, its storeys (building:levels or height, 0 when OSM says
 * neither), a word of info (kind, why the import left it out, lowest
 * storey), then n points as x, y in decimetres; a courtyard follows its
 * ring (map-footprints.ts reads and writes it, `format` its version).
 * Int16: up to 3.2 km off the middle, past every map's edge
 */
export interface MapFootprints {
  format: number;
  rings: Int16Array;
}

/** What a piece of a map holds, or what a paste takes of it */
export interface MapPieceParts {
  heights: boolean;
  paint: boolean;
  water: boolean;
  objects: boolean;
  roads: boolean;
  /** Life areas (missing in pieces kept before they travelled: none) */
  life?: boolean;
}

/**
 * A piece of a map, centred on its own middle (the editor's Copy and stamps,
 * editor/ops/stamp.ts): heights relative to its rim, paint per material,
 * water, objects, the roads and the life areas inside.
 */
export interface MapPiece {
  width: number;
  depth: number;
  /** Height samples: `columns` x `rows` every `cell` metres, relative to the rim */
  cell: number;
  columns: number;
  rows: number;
  heights: Float32Array;
  /** Paint: `paintColumns` x `paintRows` cells of `materials.length` weights (0..255) */
  paintCell: number;
  paintColumns: number;
  paintRows: number;
  materials: string[];
  paint: Uint8Array;
  /**
   * Water mask on the height samples and the water level relative to the rim; null without water. `kind`: the
   * body it came from, when that was not the main water (missing: the main water, as pieces kept before)
   */
  water: { mask: Uint8Array; level: number; color: string; kind?: MapWaterKind } | null;
  objects: Omit<MapObject, 'id'>[];
  roads: { nodes: MapPathNode[]; edges: MapPathEdge[] };
  /** Life areas and routes with all their points inside, relative to the middle; missing in pieces kept before */
  life?: Omit<MapLifeArea, 'id'>[];
  /** What the piece holds; all of it when missing (a rectangle copied whole) */
  parts?: MapPieceParts;
  /**
   * Taken from a selection of objects (a prefab): a paste puts its objects
   * down as one group of their own
   */
  prefab?: boolean;
}

/** A saved piece with its name and picture: the editor's stamp library, or a map's own (CustomMapDocument.prefabs) */
export interface MapPrefab {
  id: string;
  name: string;
  /** ISO time */
  createdAt: string;
  /** PNG data URL, the piece from above */
  preview: string | null;
  stamp: MapPiece;
}

/** Prefabs a map keeps (CustomMapDocument.prefabs) */
export const MAX_MAP_PREFABS = 32;

/** The values of a union, from a record that must name each: a value added to the type fails to compile until it is here */
function valuesOf<T extends string>(all: Record<T, true>): readonly T[] {
  return Object.keys(all) as T[];
}

/**
 * The values of the format's lists this game knows. Reading a file sets an
 * unknown one to its default and says so (map-repair.ts, docs/CUSTOM_MAPS.md
 * "Format rules"), so a new value needs no new MAP_VERSION
 */
export const MAP_SKIES = valuesOf<MapEnvironment['sky']>({ day: true, dusk: true, night: true, overcast: true });
export const MAP_BIOMES = valuesOf<MapBiome>({
  temperate: true,
  hell: true,
  moon: true,
  mars: true,
  arctic: true,
  apocalypse: true,
  swamp: true,
  desert: true,
  mountain: true,
  city: true,
});
/** The stages a map may damage an object to beforehand (MapObject.damage, destruction.config.ts) */
export type MapObjectDamage = 1 | 2 | 3;
export const MAP_OBJECT_DAMAGE: readonly MapObjectDamage[] = [1, 2, 3];
export const MAP_WEATHERS = valuesOf<MapWeather>({ clear: true, rain: true, snow: true, fog: true, storm: true });
export const MAP_WATER_KINDS = valuesOf<MapWaterKind>({ water: true, sea: true, swamp: true, ice: true, lava: true });
export const MAP_RIVER_KINDS = valuesOf<MapRiver['kind']>({ water: true, lava: true });
export const MAP_PATH_KINDS = valuesOf<MapPathKind>({ road: true, path: true, bridge: true });
export const MAP_BRIDGE_STYLES = valuesOf<MapBridgeStyle>({ wood: true, stone: true, concrete: true, lava: true });
export const MAP_SURFACE_MARKINGS = valuesOf<MapSurfaceMarkingKind>({
  soccer: true,
  handball: true,
  basketball: true,
  tennis: true,
  volleyball: true,
  multi: true,
  track: true,
  parking: true,
  platform: true,
  runnel: true,
});
export const MAP_WAVE_EVENT_KINDS = valuesOf<MapWaveEventKind>({ message: true, weather: true, time: true, portal: true, objects: true });

/** Typed array check that holds across realms (structuredClone in a test DOM, workers) */
export function isTypedArray(v: unknown, kind: 'Float32Array' | 'Uint8Array' | 'Int16Array'): boolean {
  return Object.prototype.toString.call(v) === `[object ${kind}]`;
}

/** The document's array buffers, handed over instead of copied when it leaves a worker (prefabs included) */
export function documentTransferables(doc: CustomMapDocument): ArrayBuffer[] {
  const t = doc.terrain;
  const arrays: ArrayBufferView[] = [t.grid.heights, ...t.splat.maps];
  if (t.water) arrays.push(t.water.mask);
  for (const body of t.waterBodies ?? []) arrays.push(body.mask);
  for (const { stamp } of doc.prefabs ?? []) {
    arrays.push(stamp.heights, stamp.paint);
    if (stamp.water) arrays.push(stamp.water.mask);
  }
  if (doc.footprints) arrays.push(doc.footprints.rings);
  const buffers = new Set<ArrayBuffer>();
  // A shared buffer cannot be handed over; checked across realms like isTypedArray
  for (const a of arrays) if (isArrayBuffer(a.buffer)) buffers.add(a.buffer);
  return [...buffers];
}

function isArrayBuffer(b: ArrayBufferLike): b is ArrayBuffer {
  return Object.prototype.toString.call(b) === '[object ArrayBuffer]';
}

/** Synthetic lat/lon of a map point (origin (0, 0)) */
export function mapToGeo(p: MapPoint): { lat: number; lon: number } {
  return { lat: p.y / MAP_METERS_PER_DEGREE, lon: p.x / MAP_METERS_PER_DEGREE };
}

export function geoToMap(lat: number, lon: number): MapPoint {
  return { x: lon * MAP_METERS_PER_DEGREE, y: lat * MAP_METERS_PER_DEGREE };
}
