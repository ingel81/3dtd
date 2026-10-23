import type { Signal } from '@angular/core';
import type { Camera, Group, Matrix4, Object3D, PerspectiveCamera, Raycaster, Scene, Texture, Vector2, Vector3, Vector4, WebGLRenderer } from 'three';
import type { LaneChoice } from './custom-map/lane-choice';
import type { StructureStage } from '../configs/destruction.config';
import type { RubbleMaterial } from './custom-map/rubble-material';
import type { TilesRenderer } from '3d-tiles-renderer';
import type { CameraRig } from '../three-engine/camera-rig';
import type { ColumnHit, ColumnSample } from '../three-engine/column-sample';
import type { EllipsoidSync } from '../three-engine/ellipsoid-sync';
import type { RouteCorridorTiles } from '../three-engine/route-corridor-tiles';
import type { RootLoadFailure, TileStats } from '../three-engine/tile-loading-tracker';
import type { ShotLights } from '../three-engine/shot-lights/shot-lights';
import type { StreetSurface } from '../utils/carried-height';
import type { StationProbe } from '../utils/route-corridor';
import type { ApproachPoint } from '../utils/route-cell';
import type { SegmentRoutes } from '../utils/route-start';
import type { OverpassRetry } from './osm/overpass-client';
import type { FootprintColumn } from '../utils/tower-footprint';
import type { NearestStreetPoint, Street, StreetNetwork, StreetNode } from '../interfaces/street-network-provider.interface';
import type { RandomSpawnCandidate } from '../models/location.types';
import type { BuildingData } from '../services/location/osm-street.service';
import type { WorldRef } from './world-ref';
import type { RunRules, RunStructure } from '../sim/protocol/run-rules';
import type { WorldCoverage } from './world-coverage';
import type { WaveSourceId } from '../director/wave-source';
import type { QualityKnobs } from '../three-engine/render-quality';
import type { WaveTable } from '../director/sources/table/wave-table';
import type { Messages } from '../i18n/messages/en';

/**
 * What a world can do, read by the services and the UI instead of asking
 * which world it is (docs/WORLD_PROVIDER_PLAN.md).
 */
export interface WorldCapabilities {
  /** A real place on the earth: place search, recents, best waves, `?l=`, moving the HQ, the menu globe */
  realPlace: boolean;
  /** The ground streams in (3D tiles): loading notice, LOD corridor, resampling after loads */
  streaming: boolean;
  /** The scene frame maps to ECEF (sceneToEcef): the dive from the globe */
  ecef: boolean;
  /** Needs a token or key before it can load */
  credentials: boolean;
  /** Can roll a new world in place (DevWorld) */
  regenerate: boolean;
  /** Structures of the world take damage and fall (WorldProvider.destruction) */
  destructible: boolean;
  /**
   * The world brings its own sky, lights and fog and installs them when it
   * attaches (a custom map): the engine adds none of its own
   */
  ownEnvironment: boolean;
  /**
   * Enemies get a rim light that lifts them off a detailed, lit ground (a
   * custom map); worlds without it keep the enemies' look as it is (tiles)
   */
  enemyRimLight: boolean;
  /**
   * Towers cast into the world's cached sun shadow map, enemies and the
   * hero get soft blob shadows (a custom map, whose trees and buildings
   * cast shadows); `invalidateShadows` renders the map again after a tower
   * came or went. Worlds without it keep towers and units unshadowed (tiles)
   */
  groundShadows: boolean;
  /** Camera controls: around a globe or over a flat environment */
  controls: 'globe' | 'environment';
}

/**
 * The ground of a world as the game queries it: heights, columns, line of
 * sight, the street corridor's clearance, screen picks. Reached as
 * `engine.terrain`. One object per world, so a query is a method call and
 * never a branch on the kind of world; the column and height reads are hot
 * paths and allocate no more than they did on the engine.
 */
export interface WorldSurface {
  /** Changes of the loaded ground so far; a cached column of an older version is checked again (tiles) */
  readonly lodVersion: number;
  /** Ground height at a geographic point, local Y; null where there is no ground (yet) */
  getTerrainHeightAtGeo(lat: number, lon: number): number | null;
  /** Height of a street at a path point, as the street overlay draws it (TerrainQueries.getStreetHeightEstimate) */
  getStreetHeightEstimate(
    lat: number, lon: number,
    prevLat: number, prevLon: number,
    nextLat: number, nextLon: number,
    surface: StreetSurface | null,
  ): number | null;
  /** Ground height at a path point with trees and roofs beside the path ruled out */
  getGroundHeightEstimate(
    lat: number, lon: number,
    prevLat: number, prevLon: number,
    nextLat: number, nextLon: number,
  ): number | null;
  /** The vertical probe at a local position: ground and highest surface */
  sampleColumn(localX: number, localZ: number): ColumnSample | null;
  /** sampleColumn's ground, its rays booked on `caller` */
  raycastTerrainHeight(localX: number, localZ: number, caller: string): number | null;
  /** sampleColumn, its rays booked on `caller` */
  raycastColumnSample(localX: number, localZ: number, caller: string): ColumnSample | null;
  /** Every hit of a fresh ray through a column, for `__corridor.pick()`; null where the world has no tile LOD */
  inspectColumn(localX: number, localZ: number): { hits: ColumnHit[]; fresh: ColumnSample | null; cached: ColumnSample | null } | null;
  /** Free space beside a street station (TerrainQueries.measureStreetClearance); null where streets keep their drawn width */
  measureStreetClearance(
    localX: number, localZ: number,
    acrossX: number, acrossZ: number,
    heightsAboveGround: readonly number[],
    maxDistance: number,
    onDeck?: boolean,
    onApproach?: ApproachPoint | null,
    walked?: number[],
  ): StationProbe | null;
  /** The finest ground detail at a local position without a ray; null where nothing is loaded there */
  peekBestTileLODAtLocal(localX: number, localZ: number): { depth: number; geometricError: number } | null;
  /** True when something blocks the straight line between two local points */
  raycastLineOfSight(
    originX: number, originY: number, originZ: number,
    targetX: number, targetY: number, targetZ: number,
  ): boolean;
  /** The nearest ground the ray hits (screen picks); a new vector, null for none */
  pickRay(raycaster: Raycaster): Vector3 | null;
  /**
   * The surface a tower stands on at a local point where the world knows it
   * better than the screen pick (DevWorld: a roof); null to keep the pick's height.
   */
  roofAt(localX: number, localZ: number): number | null;
  /**
   * The top of the highest object over a local point where the column leaves
   * it out (a custom map's houses: the map's column knows only its ground and
   * bridges); null where nothing stands, or where the column has it (tiles)
   */
  skylineAt?(localX: number, localZ: number): number | null;
  /**
   * The crown under a local point (a custom map's wall walk or gatehouse,
   * object-roof.ts): its centre line point across from it (scene x, z), axis,
   * half width and top; null off a crown and where the world has none
   */
  crownAt?(localX: number, localZ: number): { x: number; z: number; axisX: number; axisZ: number; halfWidth: number; top: number } | null;
  /** Whether the roofs carry `reach` metres both ways along a crown's axis from a local point (tower-footprint.ts CrownCarries) */
  crownCarries?(localX: number, localZ: number, axisX: number, axisZ: number, top: number, reach: number): boolean;
  /**
   * Why a tower of `radius` metres may not stand at a geographic point
   * (BUILD_BLOCKED_OBJECT: a custom map's houses and trees, BUILD_BLOCKED_WATER:
   * its lakes and rivers); null where it may, and always where the ground
   * itself decides (tiles: towers stand on roofs)
   */
  buildBlocker(lat: number, lon: number, radius: number): BuildBlock | null;
  /** Ground and highest surface under a tower's footprint probe */
  footprintColumn(localX: number, localZ: number): FootprintColumn | null;
  /** The loaded ground changed (a settled tile load) */
  markTileSetChanged(): void;
  /** Forget every cached column (origin change, a refresh) */
  clearHeightCache(): void;
}

/**
 * Streets of a world: the network, routes along it, random spawn points,
 * building footprints. Services reach it through `WorldContext.streets`.
 * The tiles world's is OsmStreetService, DevWorld's the DevStreetProvider.
 */
export interface WorldStreetSource {
  /** Begin the load loadStreets() with the same place will take (TODO H13) */
  prefetchStreets(centerLat: number, centerLon: number, radiusMeters: number): void;
  loadStreets(centerLat: number, centerLon: number, radiusMeters?: number): Promise<StreetNetwork>;
  /**
   * End the loads under way (tiles: the Overpass requests and their
   * retries): they reject as cancelled and write nothing. For a world that
   * goes and a place chosen instead; a world whose streets come with it has
   * nothing to end
   */
  cancelLoads(): void;
  /**
   * The street load under way asks its servers again (tiles: Overpass,
   * overpass-client.ts), for the loading plate and the hint over the map;
   * absent where streets do not load from a server
   */
  readonly retrying?: Signal<OverpassRetry | null>;
  findNearestStreetPoint(
    network: StreetNetwork, lat: number, lon: number,
    accept?: (node: StreetNode, street: Street) => boolean,
  ): NearestStreetPoint | null;
  /** The route along the streets from start to end */
  findPath(network: StreetNetwork, startLat: number, startLon: number, endLat: number, endLon: number): StreetNode[];
  /** The routes from a street segment to the end, per segment (the spawn preview) */
  segmentRoutes(network: StreetNetwork, start: { street: Street; nodeIndex: number }, endLat: number, endLon: number): SegmentRoutes | null;
  /** A random spawn candidate in the distance range, inside `coverage` where the world has one (world-coverage.ts) */
  findRandomStreetPoint(
    network: StreetNetwork, centerLat: number, centerLon: number, minDistance?: number, maxDistance?: number,
    coverage?: WorldCoverage | null,
  ): RandomSpawnCandidate | null;
  /** The streets near the routes, for the overlay; a world that draws all of them gives the network back */
  filterStreetsNearRoutes(network: StreetNetwork, routes: { lat: number; lon: number }[][], corridorWidth?: number): StreetNetwork;
  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number;
  /**
   * Where loadBuildingsNearRoutes takes the footprints from, and so where
   * their layer is offered: `fetched` for the place from a server (tiles:
   * Overpass; loaded ahead once the routes settle, a layer of the quick
   * actions), `kept` with the world (an OSM world's import; loaded only
   * when shown, a developer tool to hold against the buildings made of
   * them, TODO E290), `none` (buildings of the world's own making)
   */
  readonly footprints: 'fetched' | 'kept' | 'none';
  /**
   * Building footprints near the routes: the tiles' from Overpass; a world
   * that keeps its own gives all of them, whatever the routes (an OSM
   * world's, the whole map); none where there are none
   */
  loadBuildingsNearRoutes(routes: readonly (readonly { lat: number; lon: number }[])[], radiusMeters: number): Promise<BuildingData>;
  /** The label of a spawn at a point: its street's name, or `name` where streets have none to tell */
  spawnLabel(network: StreetNetwork, lat: number, lon: number, name: string): string;
}

/** How a world's streets and routes are drawn and sampled: data, not a branch on the world */
export interface StreetStyle {
  /** The yellow street overlay above the ground, m */
  overlayLift: number;
  /** The red route line above its cells, m */
  routeLineLift: number;
  /** Routes and the overlay are cut into pieces of at most this length to follow steep ground, m; 0 keeps them */
  subdivideM: number;
  /**
   * Street heights are the plain terrain: no bridges, approaches, underpasses
   * or lateral samples (the ground has no buildings or trees on it)
   */
  plainGround: boolean;
  /** A route's leg off the streets to the HQ carries the street's height on (route cells) */
  carryOffStreet: boolean;
}

/** HQ and spawns a world brings along; a world without them lets the player choose (tiles) */
export interface WorldStartLayout {
  hq: { lat: number; lon: number };
  /**
   * Empty until the world is attached where they come from its ground.
   * `slot`: the spawn's place in the world's own list, which picks its
   * colour, so a lane keeps it when others are closed (TODO E130)
   */
  spawns: { id: string; name: string; lat: number; lon: number; slot?: number }[];
}

/**
 * The lanes a world lets the player open before wave 1 (TODO E130): which
 * there are and the bounds, the ones open now, and a change of them. The
 * start layout gives the open ones only.
 */
export interface WorldLanes {
  readonly choice: LaneChoice;
  open(): readonly string[];
  /**
   * Open these lanes in place of the ones open; false when the world does
   * not allow it (laneChoiceProblem). `vacancy`: a coop room closes the lanes
   * nobody holds, always-open ones and the fewest included; one stays
   */
  setOpen(ids: readonly string[], vacancy?: boolean): boolean;
}

/** The waves a world brings (a custom map's gameplay): the source to play, its own list for the table source */
export interface WorldWaves {
  /** The source the world plays; null: the player's choice */
  source: WaveSourceId | null;
  table?: WaveTable;
  /** Factor on the budget source's wave budget (a custom map's difficulty); 1 when missing */
  difficulty?: number;
}

/** A sightseeing flight over a world, local coordinates, starting at the HQ */
export interface IntroTour {
  points: { x: number; z: number }[];
  /** Spawn portals along it, for the flight's clearance */
  portals: { x: number; z: number }[];
}

/**
 * A world's own scripted intro (a custom map's `intro`, map-intro.ts): the
 * camera's pose over `seconds`, played instead of the tour
 */
export interface IntroShot {
  seconds: number;
  /** Camera position and the point it looks at `t` seconds in, scene space, written to the two vectors */
  poseAt(t: number, position: Vector3, look: Vector3): void;
}

/** What a world gets from the engine when it is attached */
export interface WorldAttachContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  cameraRig: CameraRig;
  /** The menu globe covers the canvas (setDrawSuppressed) */
  drawSuppressed: boolean;
  /** The loaded ground changed (a settled tile load), after the world's own caches */
  groundChanged(): void;
  /**
   * Frames draw into the post-processing target (bloom or colour grading on)
   * rather than the screen: linear colour out, so other shader programs
   */
  drawsToTarget(): boolean;
  /**
   * Where a world's own ambient sound goes (custom maps' soundscape): the
   * game's audio context and master bus, and the player's sound volume now
   */
  audio?: { context: BaseAudioContext; destination: AudioNode; volume(): number };
  /**
   * The scene's light buffer (three-engine/shot-lights): the shots' light and
   * the steady lights a world adds (a custom map's lamps nearest the view)
   */
  lights?: ShotLights;
}

/**
 * A world's map from straight above, north up: the picture and the scene
 * area it covers. West is +x in the scene, so `left` is the larger x.
 */
export interface WorldMinimap {
  picture: HTMLCanvasElement | ImageBitmap;
  /** Scene x at the picture's left (west) and right (east) edge */
  left: number;
  right: number;
  /** Scene z at the picture's top (north) and bottom (south) edge */
  top: number;
  bottom: number;
}

/** The 3D tiles of a world that streams them: the renderer, the route corridor, the stats */
export interface WorldTiles {
  renderer(): TilesRenderer | null;
  readonly corridor: RouteCorridorTiles;
  /** Renderer counters, cached for 500 ms */
  tileStats(): TileStats;
  /** Traversals the renderer has run (the shake benchmark) */
  traversalCount(): number;
  /** Debug: tiles in the scene or not */
  setVisible(visible: boolean): void;
  visible(): boolean;
}

/** A logo the screen and the photos show beside the map, as the data's terms ask */
export interface WorldLogo {
  src: string;
  alt: string;
  /** Its class on screen (size and place in the corner) */
  cssClass: string;
}

/** Tile stats of a world without tiles */
export const NO_TILE_STATS: TileStats = { parsing: 0, downloading: 0, total: 0, visible: 0, cacheMB: 0 };

/**
 * One world on the main thread: its picture, ground queries, streets and
 * start layout. The engine gets a ready provider and never asks what kind it
 * is (docs/WORLD_PROVIDER_PLAN.md). Made by the WorldProviderRegistry from
 * a WorldRef, disposed with the engine.
 */
export interface WorldProvider {
  /** Which world this is; for DevWorld it follows a regeneration */
  readonly ref: WorldRef;
  readonly capabilities: WorldCapabilities;
  /** Geo to scene and back around the world's origin */
  readonly sync: EllipsoidSync;
  readonly surface: WorldSurface;
  readonly streets: WorldStreetSource;
  readonly streetStyle: StreetStyle;
  /** The streamed 3D tiles, null for a world without them */
  readonly tiles: WorldTiles | null;
  /** Its structures that take damage and fall; null unless capabilities.destructible */
  readonly destruction: WorldDestruction | null;
  /**
   * The nearest point of its placed objects as drawn (a wall, a roof, a tree) a screen pick's ray meets, scene
   * space; a new vector, null for none or a world without them (ScreenPicker.raycastStrike)
   */
  pickObjects?(raycaster: Raycaster): Vector3 | null;
  /** Put the world into the engine's scene: ground, camera controls, load events */
  attach(ctx: WorldAttachContext): Promise<void>;
  /** The world draws frames (tiles: once the renderer stands) */
  ready(): boolean;
  /** Its scene's programs compile ahead of its first frame (a custom map, after its assets); missing: never */
  compiling?(): boolean;
  /**
   * Runs `run` with everything the world hides until it is needed shown (a
   * custom map: a cell of every asset, the weather, what shows by night), and
   * hides it again: a warm-up frame inside draws each once. Missing: the
   * world shows what it has
   */
  withAllShown?<T>(run: () => T): T;
  /**
   * Runs `run` with what the world keeps out of the scene until it is needed
   * and the line-of-sight cube draws then (a destructible map's ruins) among
   * the sight blockers, inside withAllShown: the cube's warm-up
   * (TowerShadowMapper.warmUp) draws each once. Missing: nothing kept out
   */
  withLosStandIns?<T>(run: () => T): T;
  /** A new origin (a change of place) */
  setOrigin(lat: number, lon: number, height: number): void;
  /**
   * Each drawn frame after the camera moved, before the draw: stream the ground, keep the overlay on it.
   * `gameSeconds`: the game time since the last call (paused 0, faster at 2x and 4x), for what runs on the
   * game's clock (a crater filling with water)
   */
  update(camera: PerspectiveCamera, overlay: Group, gameSeconds?: number): void;
  /** The drawing buffer changed size */
  resize(camera: PerspectiveCamera, renderer: WebGLRenderer): void;
  /** The menu globe covers the canvas or no longer does */
  setDrawSuppressed(suppressed: boolean): void;
  /** Something that casts into the world's cached shadows changed (a tower built or gone); worlds with groundShadows */
  invalidateShadows?(): void;
  /** A tower stands at (lat, lon) with its plinth `radius` m round: what lies low under it (a hedge, a fence) leaves the picture */
  towerStands?(id: string, lat: number, lon: number, radius: number): void;
  /** Tower `id` is gone: what it covered shows again */
  towerGone?(id: string): void;
  /**
   * Builds, off the main thread, the programs the world's shadow pass draws
   * the casters among `objects` with (the engine's stand-ins: a tower built
   * and one under its scaffold), for `scene`'s lights as its frames draw
   * it. Resolves with what it compiled (whose programs are the built ones)
   * once they are built. Worlds with groundShadows
   */
  compileCasters?(renderer: WebGLRenderer, scene: Scene, camera: Camera, objects: readonly Object3D[]): Promise<Object3D[]>;
  /** The ground's heights for shaders that lie on it (the units' blob shadows); worlds with groundShadows, null before it stands */
  groundHeights?(): GroundHeights | null;
  /** The group the tower line-of-sight cube renders as blockers, a direct child of the scene */
  losBlockers(): Object3D | null;
  /**
   * Draw at a quality level (render-quality.ts): each world takes its own
   * group of the table (custom maps `customMaps`, tiles `tiles`) and leaves
   * the others; the engine applies `general`
   */
  applyQuality?(knobs: QualityKnobs): void;
  /**
   * Runs `run` with what a quality level changes in the programs of the
   * world's materials set as `knobs` say (a custom map: its point lights,
   * its water effects), and puts the level drawn now back before returning:
   * the engine makes a frame at that level ready ahead (applyQuality).
   * Missing: the world's materials stay the same at every level
   */
  withQuality?(knobs: QualityKnobs, run: () => void): void;
  /**
   * What the world left out of its first warm-up for the background, once
   * the game stands (a destructible map's ruins, needed at the first hit):
   * stand-ins whose programs the engine compiles in quiet moments, the
   * shadow pass's twins of them, and `done` once both are built. What
   * the world needs before that (a building hit first) it builds with
   * `compileNow`: those objects' programs by frames, with their shadow
   * twins (`shadows`), ready to draw when it resolves. Null for nothing
   */
  warmLater?(
    compileNow: (objects: Object3D[], shadows: () => Promise<unknown>) => Promise<void>,
  ): { objects: Object3D[]; shadows: () => Promise<unknown>; done: () => void } | null;
  /** The scene frame to ECEF, null without `capabilities.ecef` */
  sceneToEcef(target: Matrix4): Matrix4 | null;
  /**
   * The credits the map on screen asks for, in order, each one line part:
   * the map line under the map and the photos show them and nothing else
   * (tiles: Google's data and the OSM routes; a custom map: its name and
   * author and the assets' licence; DevWorld none); `t` words what is the
   * game's own (a custom map's line), the licensors' lines stay as they write them
   */
  attribution(t: Messages): string[];
  /** `callback` once the first ground stands, right away when it does already */
  onFirstGround(callback: () => void): void;
  /**
   * `callback` when the world could not load (refused credentials, a busy
   * server, one not reached), replayed; with null when it loaded after all
   * (the world tries a busy or unreached server again by itself)
   */
  onLoadFailure(callback: (failure: RootLoadFailure | null) => void): void;
  /** Try a load that failed again now (the player's Retry) */
  retryLoad(): void;
  /** Fixed HQ and spawns, null where the player picks them */
  startLayout(): WorldStartLayout | null;
  /**
   * The intro flight's path where the world has one of its own (a custom
   * map: from the HQ past every spawn), null for the longest route
   */
  introTour(): IntroTour | null;
  /** The world's own camera flight, played instead of the tour; missing or null for none (only a custom map has one) */
  introShot?(): IntroShot | null;
  /** The map from straight above for the minimap, null for a world without one (tiles, DevWorld) or before it stands */
  minimap(): WorldMinimap | null;
  /**
   * The lanes of a world with its own spawns (a custom map), null where the
   * player places them (tiles, DevWorld). The player switches them before
   * wave 1 where the map has optional lanes (hasLaneChoice)
   */
  lanes(): WorldLanes | null;
  /**
   * A wave started (the main bus's `wave:started`, not while a replay fast
   * forwards): a world's own sound for it (a custom map's `life.waveSound`).
   * Presentation only, the simulation never hears it
   */
  waveStarted?(wave: number): void;
  /**
   * A world whose look follows the waves (a custom map's wave events, TODO
   * E170): the events up to `wave` happened (op `waveEvents.setReached`, the
   * simulation's WaveEvents); sky, weather and the objects they show or hide
   * stand as then, out of the picture, the sight blockers and the build blocking
   */
  showWaveEvents?(wave: number): void;
  /** The messages a world shows before `wave` (a custom map's wave events); the banner reads wave 1's as the HUD comes up */
  waveMessages?(wave: number): string[];
  /** The world's own run rules (start credits, HQ health, tower types), null: the game's */
  runRules(): RunRules | null;
  /** The world's waves: the source it asks for and its own wave list, null: the game's choice */
  worldWaves(): WorldWaves | null;
  /** Roll a new world in place (`capabilities.regenerate`); the streets follow */
  regenerate(): Promise<void>;
  dispose(): void;
}

/** Why a world forbids a tower at a point: an object stands there, or water (a code; the UI words it) */
export type BuildBlock = 'object' | 'water';

/** What the build hint says where an object of the world forbids building */
export const BUILD_BLOCKED_OBJECT: BuildBlock = 'object';
/** What the build hint says over water */
export const BUILD_BLOCKED_WATER: BuildBlock = 'water';
/** How far the ground lies under a body's level before a spot counts as water, m (shallow banks stay dry) */
export const WATER_DEPTH_M = 0.3;

/** A structure of a destructible world: a building, a wall, a tower of the map */
/**
 * Where and when a falling structure hits the ground (collapse variants
 * that break on it, ruin-damage.ts fallImpact): map metres of the middle
 * of where it lies, the ground's height, the length it lies along (`dx`,
 * `dy`, map space), the seconds after its fall began
 */
export interface FallImpactAt {
  x: number;
  y: number;
  height: number;
  length: number;
  dx: number;
  dy: number;
  delay: number;
}

export interface WorldStructure {
  readonly id: string;
  /** Where it stands (its middle) */
  readonly lat: number;
  readonly lon: number;
  /** Ground radius, m */
  readonly radius: number;
  /** Height above its ground, m */
  readonly height: number;
  readonly maxHp: number;
  /** As the simulation has it: 0 standing, 1 battered, 2 heavily damaged, 3 fallen (destruction.config.ts) */
  stage: StructureStage;
  /** What it is built of: its rubble, dust and pieces (custom-map/rubble-material.ts); plaster when missing */
  readonly material?: RubbleMaterial;
}

/**
 * The hook of a destructible world (capabilities.destructible): which of its
 * structures can fall, and showing each as the simulation has it, a fallen
 * one out of the picture and the build blocking. The simulation keeps their
 * HP (StructureLedger, RunRules.structures, in the order of `structures()`)
 * and says their stages (`structures.setStages`, `structures.stage`,
 * presentation/world-damage-presenter.ts).
 */
export interface WorldDestruction {
  /** Every structure that can take damage, standing or fallen, in the run rules' order */
  structures(): readonly WorldStructure[];
  /**
   * Every structure's stage, one byte each in that order (after a load, a
   * new run, a restore, a seek), with the heading of the hit that brought
   * each (STRUCTURE_HEADING_STEPS, -1 none)
   */
  setStages(stages: Uint8Array, headings?: Int16Array): void;
  /** Structure `index` reached `stage` by damage just now, pushed the way of `heading` (-1 none) */
  setStage(index: number, stage: StructureStage, heading?: number): void;
  /** Where and when structure `index`, falling just now, comes down; null where the world does not draw it */
  impactOf?(index: number): FallImpactAt | null;
  /** Every structure's holes (HOLE_SLOTS of HOLE_STRIDE whole numbers each, StructureLedger), with the stages */
  setHoles?(holes: Int32Array): void;
  /** The holes a hit made or grew just now: per hole the structure, its slot and its HOLE_STRIDE numbers */
  changeHoles?(changes: Int32Array): void;
  /** Hears each falling structure come down, on the clock its fall is drawn by (its dust); the unsubscribe */
  onImpact?(listener: (index: number, hit: FallImpactAt) => void): () => void;
  /** The ground that takes the craters and the rubble, drawn; null where the world's ground stays as built */
  readonly ground: WorldGroundDamage | null;
}

/**
 * The drawn ground of a world that takes damage (docs/DESTRUCTION_PLAN.md,
 * Z4): the presenter hands it every stamp as the simulation has it (map dm
 * and cm for a crater as CraterLedger keeps it, the run rules' structure for
 * a heap of rubble), each added (1) or taken away (-1), and the towers that
 * hold the ground under them. The world writes it over frames.
 */
export interface WorldGroundDamage {
  crater(xDm: number, yDm: number, rDm: number, depthCm: number, sign: 1 | -1): void;
  /**
   * The crater just stamped was dug or deepened now, in the run (op `craters.dig`), not brought back with
   * the rest (a restore, a replay's jump): what water it cuts comes in over the next seconds
   */
  dug?(xDm: number, yDm: number): void;
  /** What stands at map dm (`xDm`, `yDm`) before a hit there: water, lava or nothing (a hit's splash) */
  waterAt?(xDm: number, yDm: number): 'water' | 'lava' | null;
  /** Structure `structure` fell (1: its rubble comes, it holds its ground no more) or stands again (-1) */
  rubble(structure: RunStructure, sign: 1 | -1): void;
  /**
   * The world's structures, each holding the ground of its ground plan while it stands: a crater at its wall
   * leaves the ground under it as built (CustomMapGroundDamage.holdStructures)
   */
  holdStructures?(structures: readonly RunStructure[]): void;
  /** Every stamp off, every hold let go */
  clear(): void;
  /** A structure of `material` at map metres (`x`, `y`) falls: its pieces thrown out, rolled from `seed` */
  debris(x: number, y: number, radius: number, height: number, material: RubbleMaterial, seed: number): void;
  /** Map metres; `foot` the height the tower's plinth stands on (its position's height less the plinth) */
  holdTower(id: string, x: number, y: number, foot: number): void;
  releaseTower(id: string): void;
  /** Pieces of the ground still to be written: a line of sight rendered before they are would miss their stamps */
  readonly pending?: number;
}

/**
 * The ground's height grid as a texture for shaders (blob-shadow.ts): the
 * grid in map metres (x, y of its first sample, cell size), its size in
 * samples, and the scene position of the map's origin (scene x is map -x,
 * scene z map y)
 */
export interface GroundHeights {
  heights: Texture;
  grid: Vector4;
  gridSize: Vector2;
  origin: Vector3;
}
