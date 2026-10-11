import type { Group, Matrix4, Object3D, PerspectiveCamera, Raycaster, Scene, Vector3, WebGLRenderer } from 'three';
import type { LaneChoice } from './custom-map/lane-choice';
import type { TilesRenderer } from '3d-tiles-renderer';
import type { CameraRig } from '../three-engine/camera-rig';
import type { ColumnHit, ColumnSample } from '../three-engine/column-sample';
import type { EllipsoidSync } from '../three-engine/ellipsoid-sync';
import type { RouteCorridorTiles } from '../three-engine/route-corridor-tiles';
import type { RootLoadFailure, TileStats } from '../three-engine/tile-loading-tracker';
import type { StreetSurface } from '../utils/carried-height';
import type { StationProbe } from '../utils/route-corridor';
import type { ApproachPoint } from '../utils/route-cell';
import type { SegmentRoutes } from '../utils/route-start';
import type { FootprintColumn } from '../utils/tower-footprint';
import type { NearestStreetPoint, Street, StreetNetwork, StreetNode } from '../interfaces/street-network-provider.interface';
import type { RandomSpawnCandidate } from '../models/location.types';
import type { BuildingData } from '../services/location/osm-street.service';
import type { WorldRef } from './world-ref';
import type { RunRules } from '../sim/protocol/run-rules';
import type { WorldCoverage } from './world-coverage';
import type { WaveSourceId } from '../director/wave-source';
import type { WaveTable } from '../director/sources/table/wave-table';

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
   * Why a tower of `radius` metres may not stand at a geographic point
   * (BUILD_BLOCKED_OBJECT: a custom map's houses and trees, BUILD_BLOCKED_WATER:
   * its lakes and rivers); null where it may, and always where the ground
   * itself decides (tiles: towers stand on roofs)
   */
  buildBlocker(lat: number, lon: number, radius: number): string | null;
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
  /** Building footprints near the routes (tiles: Overpass); none where buildings are part of the world */
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
}

/** A sightseeing flight over a world, local coordinates, starting at the HQ */
export interface IntroTour {
  points: { x: number; z: number }[];
  /** Spawn portals along it, for the flight's clearance */
  portals: { x: number; z: number }[];
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
  /** Put the world into the engine's scene: ground, camera controls, load events */
  attach(ctx: WorldAttachContext): Promise<void>;
  /** The world draws frames (tiles: once the renderer stands) */
  ready(): boolean;
  /** A new origin (a change of place) */
  setOrigin(lat: number, lon: number, height: number): void;
  /** Each drawn frame after the camera moved, before the draw: stream the ground, keep the overlay on it */
  update(camera: PerspectiveCamera, overlay: Group): void;
  /** The drawing buffer changed size */
  resize(camera: PerspectiveCamera, renderer: WebGLRenderer): void;
  /** The menu globe covers the canvas or no longer does */
  setDrawSuppressed(suppressed: boolean): void;
  /** The group the tower line-of-sight cube renders as blockers, a direct child of the scene */
  losBlockers(): Object3D | null;
  /** The scene frame to ECEF, null without `capabilities.ecef` */
  sceneToEcef(target: Matrix4): Matrix4 | null;
  /**
   * The credits the map on screen asks for, in order, each one line part:
   * the map line under the map and the photos show them and nothing else
   * (tiles: Google's data and the OSM routes; a custom map: its name and
   * author and the assets' licence; DevWorld none)
   */
  attribution(): string[];
  /** `callback` once the first ground stands, right away when it does already */
  onFirstGround(callback: () => void): void;
  /** `callback` when the world could not load (refused credentials, server not reached), replayed */
  onLoadFailure(callback: (failure: RootLoadFailure) => void): void;
  /** Fixed HQ and spawns, null where the player picks them */
  startLayout(): WorldStartLayout | null;
  /**
   * The intro flight's path where the world has one of its own (a custom
   * map: from the HQ past every spawn), null for the longest route
   */
  introTour(): IntroTour | null;
  /** The map from straight above for the minimap, null for a world without one (tiles, DevWorld) or before it stands */
  minimap(): WorldMinimap | null;
  /**
   * The lanes of a world with its own spawns (a custom map), null where the
   * player places them (tiles, DevWorld). The player switches them before
   * wave 1 where the map has optional lanes (hasLaneChoice)
   */
  lanes(): WorldLanes | null;
  /** The world's own run rules (start credits, HQ health, tower types), null: the game's */
  runRules(): RunRules | null;
  /** The world's waves: the source it asks for and its own wave list, null: the game's choice */
  worldWaves(): WorldWaves | null;
  /** Roll a new world in place (`capabilities.regenerate`); the streets follow */
  regenerate(): Promise<void>;
  dispose(): void;
}

/** What the build hint says where an object of the world forbids building */
export const BUILD_BLOCKED_OBJECT = 'Something stands there';
/** What the build hint says over water */
export const BUILD_BLOCKED_WATER = 'Water there';
/** How far the ground lies under a body's level before a spot counts as water, m (shallow banks stay dry) */
export const WATER_DEPTH_M = 0.3;

/** A structure of a destructible world: a building, a wall, a tower of the map */
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
  hp: number;
}

/**
 * The hook of a destructible world (capabilities.destructible): which of its
 * structures can fall, and showing the ones that lie fallen, out of the
 * picture and the build blocking. The simulation keeps their HP
 * (StructureLedger, RunRules.structures) and says which lie fallen
 * (`structures.setFallen`, presentation/world-damage-presenter.ts); a
 * fallen one's `hp` reads 0, a standing one's its full HP.
 */
export interface WorldDestruction {
  /** Every structure that can take damage, standing or fallen */
  structures(): readonly WorldStructure[];
  /** These lie fallen now, all others stand; the ones that fell with this call */
  setFallen(ids: readonly string[]): WorldStructure[];
}
