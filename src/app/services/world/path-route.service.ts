import { Injectable, WritableSignal, inject, signal } from '@angular/core';
import { Vector3 } from 'three';
import type { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { ThreeTilesEngine } from '../../three-engine';
import { GeoPosition, RouteWaypoint } from '../../models/game.types';
import { StreetNetwork, StreetNode } from '../location/osm-street.service';
import { StreetEdgeIndex } from '../../utils/route-ways';
import {
  CorridorPiece,
  CorridorStations,
  SegmentClearance,
  StationProbe,
  closeShortNarrowings,
  corridorConfig,
  estimateStreetWidth,
  fitCorridorPieces,
  fitCorridorStations,
  probeFreeSpace,
  probeLowWall,
  routeHalfWidths,
  runsUnderCover,
  segmentLeft,
  segmentRight,
} from '../../utils/route-corridor';
import {
  BandColumns,
  BandRoute,
  BandStation,
  CorridorBand,
  bandPath,
  buildBand,
  stationNear,
} from '../../utils/corridor-band';
import { SegmentApproach, deckApproaches, deckEndAt, nearestDeckApproach, segmentApproaches } from '../../utils/deck-approach';
import { UnderpassIndex, splitAtSpans } from '../../utils/underpass';
import type { DeckEnd } from '../../utils/route-cell';
import { haversineDistance } from '../../utils/geo-utils';
import { SpawnPoint } from './marker-visualization.service';
import { DevWorldService } from '../../devworld/devworld.service';
import { extendPathToOptimalTurnoff, leavePathForBase, subdivideGeoPath } from '../../utils/route-geometry';
import { UIStore } from '../../store/ui.store';
import { PathfindingWorkerService } from '../location/pathfinding-worker.service';
import { GlobalRouteGridService } from './global-route-grid.service';
import type { CorridorMeasurement } from './corridor-build';
import { RouteWayRun, describeRouteWays, describeStreetTags } from './route-way-report';
import { RouteLineLayer } from './route-line-layer';
import { corridorTrace, countLod, emptyLod, formatLod } from '../../utils/corridor-trace';

/**
 * Interface for pathfinding services (OsmStreetService or DevStreetProvider)
 */
export interface PathfindingService {
  findPath(network: StreetNetwork, startLat: number, startLon: number, endLat: number, endLon: number): StreetNode[];
  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number;
}

/**
 * Told about each spawn's route when it is built: the route with its
 * heights, and the route cell height at the start (scene Y), null while
 * the cells are not built and the heights are a stand-in.
 */
export type SpawnRouteListener = (
  spawnId: string,
  route: readonly RouteWaypoint[],
  startGroundY: number | null,
) => void;

interface LatLon {
  lat: number;
  lon: number;
}

/** A spawn's route as the street network gives it, see PathAndRouteService.streetRoutes. */
interface StreetRoute {
  points: LatLon[];
  /** Street half width per segment, for stations the tiles cannot measure. */
  halfWidths: number[];
  onBridge: boolean[];
  /** The segment runs over a street; the leg to the HQ does not. */
  onStreet: boolean[];
  /** The segment runs through a tunnel or a covered passage: not measured, its cells between the portals. */
  inTunnel: boolean[];
  /**
   * The way the segment runs under (a bridge over the street, underpass.ts),
   * null elsewhere. Such a segment is `inTunnel` as well.
   */
  underWay: (number | null)[];
}

/** Key of a street route (streetRoutes, bands): its points. */
const routeKey = (route: StreetRoute) => route.points.map((p) => `${p.lat},${p.lon}`).join('|');

/** The walkable band of one route and the input it was built from, see buildBands. */
interface RouteBand {
  input: BandRoute;
  band: CorridorBand;
}

/** The same values in the same places, NaN equal to NaN; `a` missing counts as all NaN. For the corridor trace. */
function sameNumbers(a: readonly number[] | undefined, b: readonly number[]): boolean {
  if (!a) return b.every(Number.isNaN);
  return a.length === b.length && a.every((value, k) => Object.is(value, b[k]));
}

/** Key of a directed route segment, for the clearance cache. */
const segmentKey = (a: LatLon, b: LatLon) => `${a.lat},${a.lon}|${b.lat},${b.lon}`;

const round1 = (v: number): number | null => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/**
 * The stretch off a bridge end that station `t` (0 to 1 along a segment)
 * lies on, from the stretches of each route over the segment: the one with
 * the nearest bridge end where every route has the station on such a
 * stretch, else null. A cell two segments reach along their length takes
 * the lower surface, the ground over the stretch off a bridge end
 * (claimSegmentCells), and the station measures from where its cells
 * stand; so the order of the routes does not decide it.
 */
function stationApproach(byRoute: readonly (readonly SegmentApproach[])[], t: number): SegmentApproach | null {
  let nearest: SegmentApproach | null = null;
  let nearestM = Infinity;
  for (const approaches of byRoute) {
    const approach = nearestDeckApproach(approaches, t);
    if (approach === null) return null;
    const m = approach.from + (approach.to - approach.from) * t;
    if (m < nearestM) {
      nearest = approach;
      nearestM = m;
    }
  }
  return nearest;
}

/** The piece among a segment's `pieces` that covers `t` (0 to 1 along the segment). */
function pieceCovering(pieces: readonly CorridorPiece[], t: number): CorridorPiece {
  let found = pieces[0];
  for (const piece of pieces) if (piece.t <= t) found = piece;
  return found;
}

/** One side of the station `__corridor.pick()` explains, see explainCorridorAt(). */
export interface CorridorSideRow {
  side: 'left' | 'right';
  /** Half width from the OSM street: the fallback, and the cap on the leg to the HQ. */
  streetHalfWidthM: number;
  /** First fine hit of the low and the high ray; the ray length where nothing was hit. */
  lowHitM: number | null;
  highHitM: number | null;
  /**
   * Where the low ray alone stopped: how far the column 1 m behind its hit
   * (LOW_WALL_BEHIND_M) comes down above the station's ground; null
   * elsewhere. At least `lowWallRise`: the low hit is a wall.
   */
  lowRiseM: number | null;
  /** The rays found a wall: both hit something within their length, or the low one a low wall (lowRiseM). */
  wall: boolean | null;
  /**
   * Free space the fitting starts from (the farther hit, the low one at a
   * low wall, the outer face of an overhang), after smoothing along the route.
   */
  freeM: number | null;
  smoothedM: number | null;
  /** Half width that gives now. */
  halfWidthM: number;
  /** Half width the route in use has there: the band's edge less the enemies' line, until the next build. */
  inUseM: number | null;
  /** What set the half width the rays allow. */
  rule: string;
}

/** A station near the explained one, along the same route. */
export interface CorridorStationRow {
  /** Segment index, station number / stations on the segment. */
  station: string;
  /** Distance from the start of the route. */
  alongM: number | null;
  leftFreeM: number | null;
  leftM: number;
  rightFreeM: number | null;
  rightM: number;
  unmeasured: string | null;
  here: boolean;
}

/** What `__corridor.pick()` prints about the route station nearest to a click. */
export interface CorridorExplanation {
  route: string;
  /** Segment index, station number / stations on the segment. */
  station: string;
  /** Distance from the click to the station. */
  distanceM: number | null;
  way: number | null;
  type: string;
  name: string;
  /**
   * The way's width, lanes, bridge, tunnel, covered and layer tags, as
   * `__routes.describe()` shows them: a road under a bridge or in an
   * underpass is often mapped with `layer=-1` only, no tunnel tag.
   */
  tags: string;
  /** Street width from OSM and where it came from. */
  streetWidthM: number | null;
  widthSource: string;
  /** False on the leg to the HQ, where the street width is the cap. */
  onStreet: boolean;
  /** In a tunnel or covered passage, or under another way: not measured, the street width stays. */
  inTunnel: boolean;
  /** The way the station lies under (a bridge over the street, underpass.ts), null elsewhere. */
  underWay: number | null;
  /**
   * The backbone of the band at the station (corridor-band.ts): how far it
   * stands off the OSM line, right of travel positive, and its height.
   * Null on a stretch the band does not decide and before it is built.
   */
  backboneM: number | null;
  backboneY: number | null;
  /**
   * The street under the station, whatever stands over it (streetLevel in
   * corridor-band.ts): what the backbone is judged against, and what a
   * tunnel portal takes instead of a hit on a roof. Null before a band is
   * built and where no station of the route found a backbone.
   */
  streetY: number | null;
  /** Edges of the band at the station, metres off the OSM line, left at most right; null without a band. */
  bandLeftM: number | null;
  bandRightM: number | null;
  /** What the band made of the station: `band`, `climb`, `passage`, `fixed`; null before a band is built. */
  bandKind: string | null;
  /**
   * How far the enemies' line runs off the OSM line at the station, right
   * of travel positive; null where it runs on it. The middle of the band or
   * the line moved into it, smoothed (`centreMode`).
   */
  detourM: number | null;
  /** In a passage: something fills the lane, the stretch runs as a tunnel and is not measured. */
  passage: boolean;
  /** Why the station has no measurement, null if it has one. */
  unmeasured: string | null;
  /** Geometric error of the tile under the station at the last probe. */
  tileError: number | null;
  sides: CorridorSideRow[];
  nearby: CorridorStationRow[];
  /**
   * How far along the route the station was measured from, because the
   * column under it found no tile (a seam); null when it was not moved.
   */
  shiftM: number | null;
}

/**
 * PathAndRouteService
 *
 * Manages path caching, route visualization, and path optimization for the Tower Defense game.
 * Handles route computation, height smoothing, and 3D line rendering.
 */
@Injectable({ providedIn: 'root' })
export class PathAndRouteService {
  private readonly devWorld = inject(DevWorldService);
  private readonly uiStore = inject(UIStore);
  private readonly pathfindingWorker = inject(PathfindingWorkerService);
  private readonly globalRouteGrid = inject(GlobalRouteGridService);

  // ========================================
  // STATE
  // ========================================

  /** Cached paths from spawn to base (key: spawnId) */
  private cachedPaths = new Map<string, RouteWaypoint[]>();
  /** At least one spawn has a route to the HQ, i.e. `cachedPaths` is not empty */
  readonly hasRoutes = signal(false);

  /** Street lookup for route segments, built on first use per street network. */
  private edgeIndex: StreetEdgeIndex | null = null;

  /** The ways a route can pass under, built on first use per street network. */
  private underpassIndex: UnderpassIndex | null = null;

  /**
   * Each spawn's route as the street network gives it: the line the
   * clearance is measured along and the band is built on
   * (beginClearanceMeasurement, buildBands). The waypoints in use run in
   * its band.
   */
  private streetRoutes = new Map<string, StreetRoute>();

  /**
   * The walkable band of each street route (routeKey), built once per
   * corridor build from the frozen columns (buildBands). Every route build
   * until the next one lays its waypoints in the same band, so they change
   * only with a build. Forgotten with the measurements.
   */
  private bands = new Map<string, RouteBand>();

  /**
   * What the tiles showed per street segment (segmentKey): the free space
   * left and right of the direction of travel at each station, NaN where no
   * fine tile was loaded, and what each station's rays found (`probes`, for
   * explainCorridorAt). Measured once per location, a later
   * beginClearanceMeasurement measures the NaN stations again. Every route
   * build fits its corridor from these (fitRoute), so the corridor settings
   * apply without new rays.
   */
  private clearanceBySegment = new Map<string, { left: number[]; right: number[]; probes: (StationProbe | null)[] }>();

  /** The latest clearance measurement, see beginClearanceMeasurement; under way while it is open. */
  private clearanceRun: ClearanceRun | null = null;

  /** Bumped whenever the routes are replaced, see routesEpoch. */
  private epoch = 0;

  /** 3D route lines for visualization */
  private readonly routeLines = new RouteLineLayer();

  /** Reference to the 3D engine */
  private engine: ThreeTilesEngine | null = null;

  /** Street network for pathfinding */
  private streetNetwork: StreetNetwork | null = null;

  /** Base coordinates (destination for all paths) */
  private baseCoords: GeoPosition | null = null;

  /** Routes visibility state (from UIStore) */
  private routesVisible: WritableSignal<boolean> | null = null;

  /** Pathfinding service (OsmStreetService or DevStreetProvider) */
  private pathfindingService: PathfindingService | null = null;

  /** Told about every built route; the spawn portal stands on its start. */
  private onRouteBuilt: SpawnRouteListener | null = null;

  // ========================================
  // INITIALIZATION
  // ========================================

  /**
   * Initialize path and route service
   * @param engine ThreeTilesEngine instance
   * @param streetNetwork Street network for pathfinding
   * @param baseCoords Base/HQ coordinates
   * @param routesVisible Signal for routes visibility state
   * @param pathfindingService Service for pathfinding (OsmStreetService or DevStreetProvider)
   * @param onRouteBuilt Told about every built route, see SpawnRouteListener
   */
  initialize(
    engine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
    baseCoords: GeoPosition,
    routesVisible: WritableSignal<boolean>,
    pathfindingService: PathfindingService,
    onRouteBuilt: SpawnRouteListener | null
  ): void {
    this.engine = engine;
    this.streetNetwork = streetNetwork;
    this.edgeIndex = null;
    this.underpassIndex = null;
    this.streetRoutes.clear();
    this.epoch++;
    this.cancelClearanceRun('location changed');
    this.clearanceBySegment.clear();
    this.forgetBands();
    this.baseCoords = baseCoords;
    this.routesVisible = routesVisible;
    this.pathfindingService = pathfindingService;
    this.onRouteBuilt = onRouteBuilt;

    // Diagnose-API für Playtests, analog zu `__rg`: in DevTools
    // `__routes.describe()` aufrufen, siehe describeRoutes().
    (globalThis as Record<string, unknown>)['__routes'] = {
      describe: () => console.table(this.describeRoutes()),
    };
  }

  /**
   * Initialize the Web Worker for pathfinding.
   * Call after initialize() when the street network is available.
   * Falls back to main-thread pathfinding if workers are unsupported.
   */
  async initializeWorker(): Promise<void> {
    if (!this.streetNetwork || !this.pathfindingService) return;

    const service = this.pathfindingService;
    await this.pathfindingWorker.initialize(
      this.streetNetwork,
      (network, startLat, startLon, endLat, endLon) =>
        service.findPath(network, startLat, startLon, endLat, endLon)
    );
  }

  // ========================================
  // PATH CACHING
  // ========================================

  /**
   * Get cached path for spawn point
   * @param spawnId Spawn point ID
   * @returns Cached path or undefined
   */
  getCachedPath(spawnId: string): RouteWaypoint[] | undefined {
    return this.cachedPaths.get(spawnId);
  }

  /**
   * Cache path for spawn point
   * @param spawnId Spawn point ID
   * @param path Path to cache
   */
  cachePath(spawnId: string, path: RouteWaypoint[]): void {
    this.cachedPaths.set(spawnId, path);
    this.hasRoutes.set(true);
  }

  /**
   * Clear all cached paths and the street routes behind them. The routes
   * are about to be replaced, so a clearance measurement of the old ones is
   * cancelled. What was measured stays, by segment: a segment the new
   * routes share keeps its measurement.
   */
  clearCache(): void {
    this.cachedPaths.clear();
    this.hasRoutes.set(false);
    this.streetRoutes.clear();
    this.forgetBands();
    this.epoch++;
    this.cancelClearanceRun('routes replaced');
  }

  /**
   * Bumped whenever the routes are replaced: a location change, a move of HQ
   * or spawn, DevWorld regenerating (clearCache, initialize, dispose). A
   * corridor build of the routes before stops at its next frame
   * (CorridorBuild). Building the routes again does not bump it.
   */
  routesEpoch(): number {
    return this.epoch;
  }

  /**
   * Clear all cached paths (alias for clearCache)
   */
  clearCachedPaths(): void {
    this.clearCache();
  }

  /**
   * Get all cached paths as a Map
   * @returns Map of spawn ID to path
   */
  getCachedPaths(): Map<string, RouteWaypoint[]> {
    return this.cachedPaths;
  }

  /** The street lookup for the current network, see {@link StreetEdgeIndex}. */
  private getEdgeIndex(network: StreetNetwork): StreetEdgeIndex {
    return (this.edgeIndex ??= new StreetEdgeIndex(network.streets));
  }

  /** The ways of the current network a route can pass under, see {@link UnderpassIndex}. */
  private getUnderpassIndex(network: StreetNetwork): UnderpassIndex {
    return (this.underpassIndex ??= new UnderpassIndex(network.streets));
  }


  /**
   * Get detail string for route loading status
   * @returns Route detail string or undefined
   */
  getRouteDetail(): string | undefined {
    if (this.cachedPaths.size === 0) return undefined;

    const totalPoints = Array.from(this.cachedPaths.values()).reduce(
      (sum, path) => sum + path.length,
      0
    );
    return `${this.cachedPaths.size} routes (${totalPoints} waypoints)`;
  }

  // ========================================
  // ROUTE VISUALIZATION
  // ========================================

  /**
   * Refresh all route lines using async worker pathfinding.
   * Falls back to synchronous if worker is unavailable.
   * @param spawnPoints Current spawn points
   */
  async refreshRouteLinesAsync(spawnPoints: SpawnPoint[]): Promise<void> {
    if (!this.engine) return;
    // For the corridor trace, which loses its chain across the await.
    const trigger = corridorTrace.capture();
    const t0 = corridorTrace.enabled ? performance.now() : 0;

    const overlayGroup = this.engine.getOverlayGroup();
    const wasVisible = this.routesVisible?.() ?? false;

    // Remove existing route lines
    this.routeLines.clear(overlayGroup);

    // Re-create route lines for all spawns (in parallel via worker)
    await Promise.all(spawnPoints.map((spawn) => this.showPathFromSpawnAsync(spawn)));

    // Restore visibility state
    this.routeLines.setVisible(wasVisible);
    if (corridorTrace.enabled) {
      corridorTrace.log('routes.refresh', { spawns: spawnPoints.length, waypoints: this.waypointCount(), async: true, ms: performance.now() - t0 }, trigger);
    }
  }

  /**
   * Refresh all route lines (re-create from cached paths)
   * @param spawnPoints Current spawn points
   */
  refreshRouteLines(spawnPoints: SpawnPoint[]): void {
    if (!this.engine) return;
    const t0 = corridorTrace.enabled ? performance.now() : 0;

    const overlayGroup = this.engine.getOverlayGroup();
    const wasVisible = this.routesVisible?.() ?? false;

    // Remove existing route lines
    this.routeLines.clear(overlayGroup);

    // Re-create route lines for all spawns
    for (const spawn of spawnPoints) {
      this.showPathFromSpawn(spawn);
    }

    // Restore visibility state
    this.routeLines.setVisible(wasVisible);
    // Each rebuild of the route lines with who asked for it: a rebuild of the corridor asks two to four times.
    if (corridorTrace.enabled) {
      const ms = performance.now() - t0;
      corridorTrace.log('routes.refresh', { spawns: spawnPoints.length, waypoints: this.waypointCount(), ms });
      corridorTrace.cost('routes.refresh', ms);
    }
  }

  /** Waypoints of all cached routes, for the corridor trace. */
  private waypointCount(): number {
    let count = 0;
    for (const path of this.cachedPaths.values()) count += path.length;
    return count;
  }

  /**
   * Show path from spawn point to base (async version using Web Worker).
   * Falls back to synchronous pathfinding if worker is unavailable.
   * Creates 3D line visualization and caches path with heights.
   * @param spawn Spawn point
   */
  async showPathFromSpawnAsync(spawn: SpawnPoint): Promise<void> {
    if (!this.engine || !this.streetNetwork || !this.pathfindingService || !this.baseCoords) {
      return;
    }

    let path: StreetNode[];
    if (this.pathfindingWorker.isWorkerAvailable) {
      path = await this.pathfindingWorker.findPath(
        spawn.lat,
        spawn.lon,
        this.baseCoords.lat,
        this.baseCoords.lon
      );
    } else {
      path = this.pathfindingService.findPath(
        this.streetNetwork,
        spawn.lat,
        spawn.lon,
        this.baseCoords.lat,
        this.baseCoords.lon
      );
    }

    if (path.length < 2) {
      return;
    }

    this.buildRouteFromPath(spawn, path);
  }

  /**
   * Show path from spawn point to base
   * Creates 3D line visualization and caches path with heights
   * @param spawn Spawn point
   */
  showPathFromSpawn(spawn: SpawnPoint): void {
    if (!this.engine || !this.streetNetwork || !this.pathfindingService || !this.baseCoords) {
      return;
    }

    const path = this.pathfindingService.findPath(
      this.streetNetwork,
      spawn.lat,
      spawn.lon,
      this.baseCoords.lat,
      this.baseCoords.lon
    );

    if (path.length < 2) {
      return;
    }

    this.buildRouteFromPath(spawn, path);
  }

  /**
   * How far above its cells the red route line runs, m: 1, in DevWorld 3
   * for its steep procedural terrain. `__corridor.pick()` looks at the cells
   * from the camera at this height (CorridorConsole.coverAt).
   */
  routeLineLift(): number {
    return this.devWorld.isActive ? 3 : 1;
  }

  /**
   * Build route visualization and cache from a computed path.
   * Shared by both sync (showPathFromSpawn) and async (showPathFromSpawnAsync) flows.
   * @param spawn Spawn point
   * @param path Computed A* path nodes
   */
  private buildRouteFromPath(spawn: SpawnPoint, path: StreetNode[]): void {
    if (!this.engine || !this.streetNetwork || !this.pathfindingService || !this.baseCoords) {
      return;
    }

    // Convert path to geoPath
    let geoPath = path.map((n) => ({ lat: n.lat, lon: n.lon }));

    // Extend the path along the street to find the optimal turn-off point
    geoPath = extendPathToOptimalTurnoff(geoPath, this.baseCoords, this.streetNetwork.streets, this.pathfindingService);

    // Cut it where it passes closest to the HQ and end it at the HQ
    geoPath = leavePathForBase(geoPath, this.baseCoords, this.pathfindingService);

    // DevWorld: Subdivide long segments for smooth terrain following on steep hills
    // Real World: Use original path directly (Google Maps terrain is smoother)
    if (this.devWorld.isActive) {
      geoPath = subdivideGeoPath(geoPath, 2);
    }

    // Corridor half width per segment and side, from the free space the
    // tiles showed (beginClearanceMeasurement), the street's width where they
    // could not tell. Cells and enemy spread read it off the cached
    // waypoints, the cells also whether the segment is on a bridge or in a
    // tunnel. Where the route passes under another way (a bridge over the
    // street), it is cut, and the piece under it runs under cover like a
    // tunnel (underpass.ts).
    const matched = this.getEdgeIndex(this.streetNetwork).match(geoPath);
    const open = matched.map((way) => way === null || (way.bridge === undefined && !runsUnderCover(way)));
    const spans = this.getUnderpassIndex(this.streetNetwork).spans(geoPath, matched, open);
    const split = splitAtSpans(geoPath, spans, open, (a, b, f) => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f }));
    geoPath = split.points;
    const ways = split.segment.map((i) => matched[i]);
    const base: StreetRoute = {
      points: geoPath,
      halfWidths: routeHalfWidths(ways),
      onBridge: ways.map((way) => way?.bridge !== undefined),
      onStreet: ways.map((way) => way !== null),
      inTunnel: ways.map((way, i) => split.under[i] !== null || (way !== null && runsUnderCover(way))),
      underWay: split.under,
    };
    this.streetRoutes.set(spawn.id, base);
    // The waypoints run where the walkable band puts them (buildBands);
    // before a band is built, on the street's line with the widths the rays
    // gave (applyClearance).
    const band = this.bands.get(routeKey(base));
    const laid = band ? this.laidInBand(base, band) : this.applyClearance(base);
    geoPath = laid.points;
    const { left: leftWidths, right: rightWidths, onBridge, inTunnel, passage, detour } = laid;

    // Create route line in Three.js - on terrain with RELATIVE heights
    const HEIGHT_ABOVE_GROUND = this.routeLineLift();
    const overlayGroup = this.engine.getOverlayGroup();
    const points: Vector3[] = [];

    // Get origin terrain height as reference (fallback to 0 if terrain not loaded yet)
    const origin = this.engine.sync.getOrigin();
    // Bootstrap fallback only: before any cell exists the line is drawn flat
    // at HQ level and snapped to real heights by the first refresh.
    const fallbackTerrainY = this.engine.getTerrainHeightAtGeo(this.baseCoords.lat, this.baseCoords.lon) ?? 0;

    // Resolve per-waypoint heights from the route-grid cell at each position.
    // Single source of truth — same cells drive enemy movement and tower-LOS,
    // so the red line, the enemy feet and the LOS rays now share one ground
    // model. No more parallel raycast/smoothing pipeline.
    //
    // Bootstrap fallback: on the very first build, cells aren't generated
    // yet (initializeGlobalRouteGrid runs AFTER the first showPathFromSpawn).
    // We draw a flat line at HQ level; refreshRouteLines in the corridor
    // build (CorridorBuild) and in the DevWorld regeneration snaps the line
    // up to the heights of the cells. A tile batch no longer does.
    const cellsReady = this.globalRouteGrid.isInitialized();
    const pathWithHeights: RouteWaypoint[] = new Array(geoPath.length);
    let startCellY: number | null = null;

    for (let i = 0; i < geoPath.length; i++) {
      const pos = geoPath[i];
      const local = this.engine.sync.geoToLocalSimple(pos.lat, pos.lon, 0);

      let cellY: number | null = null;
      if (cellsReady) {
        cellY = this.globalRouteGrid.getGroundLocalYAt(local.x, local.z);
      }
      if (i === 0) startCellY = cellY;
      const terrainY = cellY ?? fallbackTerrainY;

      // Line geometry: local frame, relative to origin's terrain Y, plus the
      // small lift so the line stays visible above ground.
      local.y = terrainY + HEIGHT_ABOVE_GROUND;
      points.push(local);

      // Cached path keeps an absolute geo height for any legacy reader.
      // Enemy movement/spawn no longer use this field — they read cells
      // directly — but route-animation and external consumers may rely on it.
      const waypoint: RouteWaypoint = { ...pos, height: terrainY + origin.height };
      if (i < leftWidths.length) {
        waypoint.corridorLeft = leftWidths[i];
        waypoint.corridorRight = rightWidths[i];
        if (onBridge[i]) waypoint.onBridge = true;
        if (inTunnel[i]) waypoint.inTunnel = true;
        if (passage[i]) waypoint.passage = true;
        if (detour[i]) waypoint.detour = true;
      }
      pathWithHeights[i] = waypoint;
    }

    this.cachedPaths.set(spawn.id, pathWithHeights);
    this.hasRoutes.set(true);

    // The spawn portal stands on the route's first cell, facing along it
    this.onRouteBuilt?.(spawn.id, pathWithHeights, startCellY);

    this.routeLines.add(overlayGroup, points, spawn.color, this.routesVisible?.() ?? false);
  }

  /**
   * The route on the street's own line, split into the pieces the tiles
   * gave it (fitRoute), with the half width left and right of the direction
   * of travel per piece. What a route looks like before its band is built:
   * on the first build of a location, and in the loading screen while the
   * corridor is being measured.
   */
  private applyClearance(route: StreetRoute): {
    points: LatLon[]; left: number[]; right: number[]; onBridge: boolean[]; inTunnel: boolean[]; passage: boolean[]; detour: boolean[];
  } {
    const { points, onBridge, inTunnel } = route;
    const fitted = this.fitRoute(route);
    const fittedPoints: LatLon[] = [];
    const left: number[] = [];
    const right: number[] = [];
    const flags = { onBridge: [] as boolean[], inTunnel: [] as boolean[], passage: [] as boolean[], detour: [] as boolean[] };
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      for (const piece of fitted[i]) {
        fittedPoints.push(piece.t === 0 ? a : { lat: a.lat + (b.lat - a.lat) * piece.t, lon: a.lon + (b.lon - a.lon) * piece.t });
        left.push(piece.left);
        right.push(piece.right);
        flags.onBridge.push(onBridge[i]);
        flags.inTunnel.push(inTunnel[i]);
        // Without a band nothing is a passage and nothing is moved sideways.
        flags.passage.push(false);
        flags.detour.push(false);
      }
    }
    fittedPoints.push(points[points.length - 1]);
    return { points: fittedPoints, left, right, ...flags };
  }

  /**
   * Build the walkable band of every route in use and hand the grid the
   * band its cells are judged against (corridor-band.ts): per station the
   * backbone, the band to each side and the enemies' line in it. The
   * corridor build calls it once, after the measurement and before routes
   * and cells (CorridorBuild); the columns are frozen by then, so one pass
   * decides band, line and cells. Nothing happens without a grid: DevWorld
   * and the first build of a location keep the street's line.
   *
   * @returns what was built, for the log and the trace
   */
  buildBands(): { routes: number; stations: number; passages: number; maxSlopeM: number; maxCurvature: number } {
    const summary = { routes: 0, stations: 0, passages: 0, maxSlopeM: 0, maxCurvature: 0 };
    this.bands.clear();
    if (!this.engine || !this.globalRouteGrid.isInitialized()) return summary;
    const grid = this.globalRouteGrid.getGrid();
    // The frozen columns of the build; one from a tile coarser than
    // `maxTileError` counts as no column, as it does for the walk check.
    const columns: BandColumns = (x, z) => {
      const column = grid.columnNear(x, z);
      return column !== null && column.tileGeometricError <= corridorConfig.maxTileError
        ? { ground: column.groundY, top: column.topY }
        : null;
    };
    for (const route of this.streetRoutes.values()) {
      const key = routeKey(route);
      if (this.bands.has(key)) continue;
      const input = this.bandRouteOf(route);
      const band = buildBand(input, columns, grid.getCellSize());
      this.bands.set(key, { input, band });
      summary.routes++;
      summary.stations += band.stations.length;
      summary.passages += band.passages.length;
      summary.maxSlopeM = Math.max(summary.maxSlopeM, band.maxSlope);
      summary.maxCurvature = Math.max(summary.maxCurvature, band.maxCurvature);
    }
    grid.setBand((x, z) => this.bandStationAt(x, z));
    if (corridorTrace.enabled) {
      corridorTrace.noteChange(['band']);
      corridorTrace.log('band.build', summary);
    }
    return summary;
  }

  /**
   * A street route as buildBand reads it: its points in the local frame,
   * the segments the band decides (a street on the ground, not a bridge, a
   * tunnel, the stretch off a bridge end or the leg to the HQ), the OSM half
   * width per segment, and per station how far the clearance rays leave
   * room either side (fitCorridorStations), the wall the band is looked for
   * within.
   */
  private bandRouteOf(route: StreetRoute): BandRoute {
    const sync = this.engine!.sync;
    const points = route.points.map((p) => {
      const local = sync.geoToLocalSimple(p.lat, p.lon, 0);
      return { x: local.x, z: local.z };
    });
    const approaches = deckApproaches(points, route.onBridge, route.inTunnel);
    const open = route.onStreet.map((onStreet, i) => onStreet && !route.onBridge[i] && !route.inTunnel[i] && approaches[i].length === 0);
    const fit = fitCorridorStations(this.corridorStationsOf(route));
    const wall = (side: 'left' | 'right') => fit[side].map((stations) => stations.map((station) => station.halfWidth));
    return { points, open, streetHalfWidth: route.halfWidths, wallLeft: wall('left'), wallRight: wall('right') };
  }

  /**
   * The waypoints of `route` in its band: the enemies' line as bandPath
   * lays it, with the half width left and right of it per piece. Local
   * metres become latitude and longitude around the route's first point,
   * the way geoToLocalSimple maps a small step of each there. A piece of a
   * passage runs as a tunnel, one off the street's line is a detour (for
   * `__corridor.pick()` and the worm's arcs).
   */
  private laidInBand(route: StreetRoute, band: RouteBand): {
    points: LatLon[]; left: number[]; right: number[]; onBridge: boolean[]; inTunnel: boolean[]; passage: boolean[]; detour: boolean[];
  } {
    const sync = this.engine!.sync;
    const step = 1e-5;
    const origin = route.points[0];
    const o = sync.geoToLocalSimple(origin.lat, origin.lon, 0);
    const north = sync.geoToLocalSimple(origin.lat + step, origin.lon, 0);
    const east = sync.geoToLocalSimple(origin.lat, origin.lon + step, 0);
    const [xLat, zLat, xLon, zLon] = [(north.x - o.x) / step, (north.z - o.z) / step, (east.x - o.x) / step, (east.z - o.z) / step];
    const det = xLat * zLon - xLon * zLat;
    const geoOf = (x: number, z: number): LatLon => ({
      lat: origin.lat + ((x - o.x) * zLon - (z - o.z) * xLon) / det,
      lon: origin.lon + ((z - o.z) * xLat - (x - o.x) * zLat) / det,
    });
    const points: LatLon[] = [];
    const left: number[] = [];
    const right: number[] = [];
    const flags = { onBridge: [] as boolean[], inTunnel: [] as boolean[], passage: [] as boolean[], detour: [] as boolean[] };
    const nodes = bandPath(band.input, band.band);
    nodes.forEach((node, k) => {
      points.push(geoOf(node.x, node.z));
      if (k === nodes.length - 1) return;
      left.push(node.left);
      right.push(node.right);
      flags.onBridge.push(route.onBridge[node.segment]);
      flags.inTunnel.push(route.inTunnel[node.segment] || node.passage);
      flags.passage.push(node.passage);
      flags.detour.push(Math.abs(node.offset) > 1e-9);
    });
    return { points, left, right, ...flags };
  }

  /**
   * The band station nearest to local (x, z) over the routes in use, null
   * before a band is built: what the grid judges a cell against
   * (`__corridor.pick()`) and what a tunnel portal takes its ground from
   * (corridor-walk.ts).
   */
  bandStationAt(x: number, z: number): BandStation | null {
    let best: BandStation | null = null;
    let bestD = Infinity;
    for (const { band } of this.bands.values()) {
      const station = stationNear(band, x, z);
      if (station === null) continue;
      const d = (station.x - x) ** 2 + (station.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = station;
      }
    }
    return best;
  }

  /** Forget the bands and take them off the grid: the routes or the measurements are gone. */
  private forgetBands(): void {
    this.bands.clear();
    if (this.globalRouteGrid.isInitialized()) this.globalRouteGrid.getGrid().setBand(null);
  }

  /**
   * The corridor pieces of each segment of `route`: from what the tiles
   * showed (fitCorridorPieces), before anything was measured at the
   * street's half width on both sides, then with short narrowings closed
   * along the whole route (closeShortNarrowings).
   */
  private fitRoute(route: StreetRoute): CorridorPiece[][] {
    const pieces = this.clearanceBySegment.size === 0
      ? route.halfWidths.map((h) => [{ t: 0, left: h, right: h }])
      : fitCorridorPieces(this.corridorStationsOf(route));
    const { points } = route;
    const lengths = points.slice(1).map((b, i) => haversineDistance(points[i].lat, points[i].lon, b.lat, b.lon));
    return closeShortNarrowings(pieces, lengths, route.inTunnel);
  }

  /** The segments of `route` as the corridor fitting sees them: what the rays measured, the street width where they could not. */
  private corridorStationsOf(route: StreetRoute): CorridorStations[] {
    const segments: CorridorStations[] = [];
    for (let i = 0; i < route.points.length - 1; i++) {
      const measured = this.measuredOf(route, i);
      segments.push({
        left: measured?.left ?? [],
        right: measured?.right ?? [],
        fallback: route.halfWidths[i],
        onStreet: route.onStreet[i],
        lowWallLeft: measured?.probes.map((probe) => probeLowWall(probe, 'left')),
        lowWallRight: measured?.probes.map((probe) => probeLowWall(probe, 'right')),
      });
    }
    return segments;
  }

  /** What the tiles showed along segment `i` of `route`; undefined for a segment not measured (a tunnel, a covered passage). */
  private measuredOf(route: StreetRoute, i: number): SegmentClearance | undefined {
    return this.clearanceBySegment.get(segmentKey(route.points[i], route.points[i + 1]));
  }

  /** The pieces every route gets from what is measured now, to tell whether a measurement changed any. */
  private fittedCorridors(): string {
    return JSON.stringify([...this.streetRoutes.values()].map((route) => this.fitRoute(route)));
  }

  /**
   * What the corridor in use is made of, for `__corridor.fingerprint()` and
   * `__corridor.snapshot()`: stored state only, nothing is measured or
   * judged anew, so the camera does not change it. Per route in use the band
   * of its stations (buildBands) and what each station of its line
   * measured. Measurements of routes no longer in use (a spawn moved) are
   * left out.
   */
  corridorState(): CorridorState {
    const routes = new Map<string, CorridorState['routes'][number]>();
    const stations = new Map<string, CorridorState['stations'][number]>();
    for (const route of this.streetRoutes.values()) {
      const key = routeKey(route);
      routes.set(key, { key, band: this.bands.get(key)?.band.stations ?? [] });
      const { points } = route;
      for (let i = 0; i < points.length - 1; i++) {
        const segment = segmentKey(points[i], points[i + 1]);
        const measured = this.clearanceBySegment.get(segment);
        if (!measured) continue;
        stations.set(segment, {
          key: segment,
          left: measured.left,
          right: measured.right,
          tileError: measured.probes.map((probe) => probe?.tileError ?? null),
          unmeasured: measured.probes.map((probe) => probe?.unmeasured ?? null),
          shiftM: measured.probes.map((probe) => probe?.shiftM ?? null),
        });
      }
    }
    return { routes: [...routes.values()], stations: [...stations.values()] };
  }

  /**
   * Forget what the tiles showed, so the next beginClearanceMeasurement
   * measures every station again: after a settings change that moves the
   * stations or the rays or changes where enemies can walk
   * (MEASUREMENT_KEYS). The bands go as well, the next build makes them
   * anew. A run under way is cancelled.
   */
  clearCorridorMeasurements(): void {
    this.cancelClearanceRun('measurements cleared');
    this.clearanceBySegment.clear();
    this.forgetBands();
  }

  /**
   * Stations of the routes in use the measurement could not take: no tile
   * under them, a tile coarser than `maxTileError`, no column at the bridge
   * end. The corridor build measures them once more on the fallback level
   * (CorridorBuild); what is left keeps the street width. Segments shared by
   * two routes count once, segments of a route that was replaced (a spawn
   * moved) not at all. DevWorld has none: there is nothing to measure there.
   */
  unmeasuredStations(): number {
    const seen = new Set<string>();
    let count = 0;
    for (const { points } of this.streetRoutes.values()) {
      for (let i = 0; i < points.length - 1; i++) {
        const key = segmentKey(points[i], points[i + 1]);
        if (seen.has(key)) continue;
        seen.add(key);
        const probes = this.clearanceBySegment.get(key)?.probes ?? [];
        for (const probe of probes) if (probe !== null && probe.unmeasured !== null) count++;
      }
    }
    return count;
  }

  /**
   * How the corridor comes about at the route station nearest to local
   * (x, z), for `__corridor.pick()`: the street width from OSM and where it
   * came from, what the station's rays found left and right (first hit of
   * the low and the high ray, a wall or not), why a station stayed
   * unmeasured, what the fitting made of it and which rule set the half
   * width, plus the stations around it along the route. Null without routes.
   */
  explainCorridorAt(x: number, z: number): CorridorExplanation | null {
    const engine = this.engine;
    const network = this.streetNetwork;
    if (!engine || !network) return null;
    const local = (p: LatLon) => engine.sync.geoToLocalSimple(p.lat, p.lon, 0);
    const stationCount = (route: StreetRoute, i: number, length: number) =>
      this.measuredOf(route, i)?.left.length ?? Math.max(1, Math.round(length / corridorConfig.stationSpacing));

    // The nearest station over every route.
    let best: { routeId: string; route: StreetRoute; i: number; k: number; n: number; x: number; z: number; d: number } | null = null;
    for (const [routeId, route] of this.streetRoutes) {
      for (let i = 0; i < route.points.length - 1; i++) {
        const a = local(route.points[i]);
        const b = local(route.points[i + 1]);
        const n = stationCount(route, i, Math.hypot(b.x - a.x, b.z - a.z));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const sx = a.x + (b.x - a.x) * t;
          const sz = a.z + (b.z - a.z) * t;
          const d = Math.hypot(sx - x, sz - z);
          if (!best || d < best.d) best = { routeId, route, i, k, n, x: sx, z: sz, d };
        }
      }
    }
    if (!best) return null;

    const { routeId, route, i, k, n } = best;
    const segments = this.corridorStationsOf(route);
    const fit = fitCorridorStations(segments);
    const measured = this.measuredOf(route, i);
    const probe = measured?.probes[k] ?? null;
    const way = this.getEdgeIndex(network).match(route.points)[i];
    // What the band made of the station: its backbone, its edges and the offset of the enemies' line.
    const bandStation = this.bands.get(routeKey(route))?.band.stations.find((s) => s.segment === i && s.k === k) ?? null;
    const banded = bandStation !== null && bandStation.kind !== 'fixed';
    const estimate = way ? estimateStreetWidth(way) : null;
    const inUse = this.corridorInUse(routeId, best.x, best.z);

    // The pieces the route gets: the stations' half widths with short
    // narrowings closed over the whole route.
    const pieces = this.fitRoute(route);
    const pieceAt = (j: number, t: number): CorridorPiece => pieceCovering(pieces[j], t);

    const sideRow = (side: 'left' | 'right'): CorridorSideRow => {
      const station = fit[side][i][k];
      const hits = probe && probe.unmeasured === null ? probe[side] : null;
      const own = station ? station.halfWidth : route.halfWidths[i];
      // The free space is the high ray's hit, nearer than the low one: probeFreeSpace took the outer face of an overhang.
      const overhang = hits !== null && station !== undefined && station.free === hits[hits.length - 1] && hits[hits.length - 1] < hits[0];
      const rule = station ? (overhang ? `${station.rule}, overhang: outer face` : station.rule)
        : route.underWay[i] !== null ? `under way ${route.underWay[i]}: street width`
        : bandStation?.kind === 'passage' ? 'passage: street width'
        : route.inTunnel[i] ? 'tunnel or covered: street width'
        : 'not measured yet: street width';
      const halfWidth = pieceAt(i, (k + 0.5) / n)[side];
      return {
        side,
        streetHalfWidthM: route.halfWidths[i],
        lowHitM: hits ? round1(hits[0]) : null,
        highHitM: hits ? round1(hits[hits.length - 1]) : null,
        lowRiseM: hits ? round1(probe?.lowRise?.[side] ?? NaN) : null,
        wall: hits ? hits.every((d) => d < corridorConfig.maxHalfWidth) || probeLowWall(probe, side) : null,
        freeM: station ? round1(station.free) : null,
        smoothedM: station ? round1(station.smoothed) : null,
        halfWidthM: halfWidth,
        inUseM: inUse ? inUse[side] : null,
        rule: halfWidth > own ? `${rule}, short narrowing closed` : rule,
      };
    };

    // Four stations either side along the route, across its waypoints.
    const flat: { i: number; k: number; n: number; alongM: number }[] = [];
    let along = 0;
    for (let j = 0; j < route.points.length - 1; j++) {
      const a = local(route.points[j]);
      const b = local(route.points[j + 1]);
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      const count = segments[j].left.length;
      for (let m = 0; m < count; m++) flat.push({ i: j, k: m, n: count, alongM: along + ((m + 0.5) / count) * length });
      along += length;
    }
    const here = flat.findIndex((s) => s.i === i && s.k === k);
    const nearby = (here < 0 ? [] : flat.slice(Math.max(0, here - 4), here + 5)).map((s): CorridorStationRow => {
      const near = this.measuredOf(route, s.i)?.probes[s.k] ?? null;
      return {
        station: `${s.i}:${s.k + 1}/${s.n}`,
        alongM: round1(s.alongM),
        leftFreeM: round1(fit.left[s.i][s.k].free),
        leftM: pieceAt(s.i, (s.k + 0.5) / s.n).left,
        rightFreeM: round1(fit.right[s.i][s.k].free),
        rightM: pieceAt(s.i, (s.k + 0.5) / s.n).right,
        unmeasured: near ? near.unmeasured : 'no probe',
        here: s.i === i && s.k === k,
      };
    });

    return {
      route: routeId,
      station: `${i}:${k + 1}/${n}`,
      distanceM: round1(best.d),
      way: way?.id ?? null,
      type: way?.type ?? '(off network: leg to the HQ)',
      name: way?.name ?? '',
      tags: way ? describeStreetTags(way) : '',
      streetWidthM: estimate?.widthM ?? null,
      widthSource: estimate?.source ?? 'inherited',
      onStreet: route.onStreet[i],
      inTunnel: route.inTunnel[i],
      underWay: route.underWay[i],
      backboneM: bandStation?.backbone ? round1(bandStation.backbone.offset) : null,
      backboneY: bandStation?.backbone ? round1(bandStation.backbone.y) : null,
      streetY: bandStation?.street != null ? round1(bandStation.street) : null,
      bandLeftM: banded ? round1(bandStation!.left) : null,
      bandRightM: banded ? round1(bandStation!.right) : null,
      bandKind: bandStation?.kind ?? null,
      detourM: bandStation && Math.abs(bandStation.centre) > 1e-9 ? round1(bandStation.centre) : null,
      passage: bandStation?.kind === 'passage',
      unmeasured: route.underWay[i] !== null ? `under way ${route.underWay[i]}: not measured`
        : bandStation?.kind === 'passage' ? 'passage: not measured'
        : route.inTunnel[i] ? 'tunnel or covered: not measured'
        : probe ? probe.unmeasured
        : measured ? 'no probe (DevWorld)'
        : 'not measured yet',
      tileError: probe ? round1(probe.tileError) : null,
      sides: [sideRow('left'), sideRow('right')],
      nearby,
      shiftM: probe?.shiftM ?? null,
    };
  }

  /** Half widths the cached route of `routeId` uses at local (x, z): those of its segment nearest to the point. */
  private corridorInUse(routeId: string, x: number, z: number): { left: number; right: number } | null {
    const path = this.cachedPaths.get(routeId);
    const engine = this.engine;
    if (!path || !engine) return null;
    let best = Infinity;
    let found: RouteWaypoint | null = null;
    for (let i = 0; i < path.length - 1; i++) {
      const a = engine.sync.geoToLocalSimple(path[i].lat, path[i].lon, 0);
      const b = engine.sync.geoToLocalSimple(path[i + 1].lat, path[i + 1].lon, 0);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq)) : 0;
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (d < best) {
        best = d;
        found = path[i];
      }
    }
    return found ? { left: segmentLeft(found), right: segmentRight(found) } : null;
  }

  /**
   * Start measuring how much room the tiles leave left and right of every
   * route segment, so the next route build fits the corridor to it: the
   * free space on each side sets the half width there, up to
   * `corridorConfig.maxHalfWidth` (fitCorridorPieces). A station every
   * `stationSpacing` metres with a low and a high horizontal ray to each
   * side (TerrainQueries.measureStreetClearance); a station without fine
   * tiles keeps the street width. Stations measured before are kept and only
   * the ones without fine tiles are measured again, so a segment whose tiles
   * had only partly loaded gets the rest on a later run instead of keeping
   * the street width there for the whole location.
   *
   * The run takes the stations in the order the routes list them, as many
   * per `step(budgetMs)` as fit in the budget, and hands them over in
   * `commit()`, which reports whether a corridor changed (routes and grid
   * then need a rebuild). Until then routes built in between keep the
   * corridor as it was. A later station may see finer tiles than an earlier
   * one if tiles load in between; each keeps what it saw, as in one go.
   * Replacing the routes (clearCache, initialize, dispose) or forgetting
   * the measurements cancels the run, and so does starting another.
   *
   * The grid is rebuilt from the result, so it must not run under placed
   * towers (CorridorBuild).
   */
  beginClearanceMeasurement(): CorridorMeasurement {
    this.cancelClearanceRun('superseded');
    const run = this.clearanceRunOver(this.clearanceSegments(false), (measured) => this.storeClearance(measured));
    this.clearanceRun = run;
    return run;
  }

  /**
   * Every station of the routes in use measured once more on the tiles
   * loaded now, into a list the corridor never sees: the same stations, rays
   * and order as a run of beginClearanceMeasurement that starts from
   * nothing. Nothing is stored, no run is cancelled or replaced. For
   * `__corridor.probeLod()`, which times it. Null without an engine.
   */
  measureAllStations(): (StationProbe | null)[] | null {
    if (!this.engine) return null;
    const segments = this.clearanceSegments(true);
    // Never committed: what it measured stays in `segments`.
    this.clearanceRunOver(segments, () => false).step(Infinity);
    return segments.flatMap((segment) => segment.probes);
  }

  /** A clearance run over `segments` with the corridor settings of now; `store` takes what it measured on commit. */
  private clearanceRunOver(
    segments: ClearanceSegment[],
    store: (segments: readonly ClearanceSegment[]) => boolean,
  ): ClearanceRun {
    const engine = this.engine;
    const rayHeights = [corridorConfig.rayHeightLow, corridorConfig.rayHeightHigh];
    const maxHalfWidth = corridorConfig.maxHalfWidth;
    return new ClearanceRun(
      segments,
      2 * rayHeights.length,
      (x, z, acrossX, acrossZ, onDeck, deckEnd) =>
        engine?.terrain.measureStreetClearance(x, z, acrossX, acrossZ, rayHeights, maxHalfWidth, onDeck, deckEnd) ?? null,
      store,
    );
  }

  /**
   * The segments of the routes in use a clearance run measures, each once:
   * with the stations the last runs could not measure, or with every station
   * afresh (`all`).
   */
  private clearanceSegments(all: boolean): ClearanceSegment[] {
    const engine = this.engine;
    const segments: ClearanceSegment[] = [];
    // Routes from several spawns share segments; one pass over each is
    // enough. Each route over one hands on its stretches off a bridge end.
    const byKey = new Map<string, ClearanceSegment | null>();

    for (const { points, onBridge, inTunnel } of this.streetRoutes.values()) {
      if (!engine) break;
      const local = points.map((p) => engine.sync.geoToLocalSimple(p.lat, p.lon, 0));
      // The stretches off each bridge end, as the route cells there find them.
      const approaches = deckApproaches(local, onBridge, inTunnel);
      for (let i = 0; i < points.length - 1; i++) {
        // In a tunnel the rays would hit its walls and the column the ground
        // above: the street width stays.
        if (inTunnel[i]) continue;
        const key = segmentKey(points[i], points[i + 1]);
        const stretches = segmentApproaches(approaches[i], local);
        const seen = byKey.get(key);
        if (seen !== undefined) {
          seen?.approaches.push(stretches);
          continue;
        }
        byKey.set(key, null);
        const known = all ? undefined : this.clearanceBySegment.get(key);
        if (known && !known.left.some(Number.isNaN)) continue;

        const start = local[i];
        const dx = local[i + 1].x - start.x;
        const dz = local[i + 1].z - start.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.01) continue;

        const count = Math.max(1, Math.round(length / corridorConfig.stationSpacing));
        const segment: ClearanceSegment = {
          key, x: start.x, z: start.z, dx, dz, count, onBridge: onBridge[i], approaches: [stretches],
          left: known ? [...known.left] : new Array<number>(count).fill(NaN),
          right: known ? [...known.right] : new Array<number>(count).fill(NaN),
          probes: known ? [...known.probes] : new Array<StationProbe | null>(count).fill(null),
        };
        byKey.set(key, segment);
        segments.push(segment);
      }
    }
    return segments;
  }

  /**
   * Hand what a finished run measured to the corridor; true when that
   * changes a corridor. The band comes afterwards, from the columns of the
   * corridor build (buildBands).
   */
  private storeClearance(segments: readonly ClearanceSegment[]): boolean {
    const t0 = corridorTrace.enabled ? performance.now() : 0;
    const before = this.fittedCorridors();
    // For the corridor trace, without another fit of the corridors: whether
    // the run brought free space the corridor did not have. Whether a width
    // changed says `changed`.
    const measured = corridorTrace.enabled && segments.some(({ key, left, right }) => {
      const known = this.clearanceBySegment.get(key);
      return !sameNumbers(known?.left, left) || !sameNumbers(known?.right, right);
    });
    // Stored with their unmeasured stations as well: they keep their
    // place, so the smoothing along the route does not join what lies
    // either side of them.
    for (const { key, left, right, probes } of segments) {
      this.clearanceBySegment.set(key, { left, right, probes });
    }
    const changed = this.fittedCorridors() !== before;
    if (corridorTrace.enabled) {
      corridorTrace.noteChange(measured ? ['measured'] : []);
      corridorTrace.log('store', { changed, by: measured ? 'measured' : 'none', segments: segments.length, ms: performance.now() - t0 });
    }
    return changed;
  }

  /** Cancel the clearance measurement under way, if any; nothing of it is stored. */
  private cancelClearanceRun(reason: string): void {
    this.clearanceRun?.cancel(reason);
  }

  /**
   * Clear all route lines
   */
  clearRouteLines(): void {
    if (!this.engine) return;
    this.routeLines.clear(this.engine.getOverlayGroup());
  }

  /**
   * Clear all routes (alias for clearRouteLines)
   */
  clearAllRoutes(): void {
    this.clearRouteLines();
  }

  /**
   * Set visibility of all route lines
   * @param visible Visibility state
   */
  setRouteLinesVisible(visible: boolean): void {
    this.routeLines.setVisible(visible);
  }

  /**
   * Toggle route lines visibility based on UI state signal.
   * Called from component event handler.
   */
  toggleRouteLinesVisibility(): void {
    this.setRouteLinesVisible(this.uiStore.routesVisible());
  }

  /**
   * Get all route lines
   */
  getRouteLines(): Line2[] {
    return this.routeLines.all;
  }

  // ========================================
  // DIAGNOSTICS
  // ========================================

  /**
   * Die gecachten Routen je OSM-Way, mit Straßenbreite, Korridor und dem
   * größten Abstand Zelle über Straßen-Overlay, für `__routes.describe()`.
   * Siehe describeRouteWays(). Nur für Diagnose.
   */
  describeRoutes(): RouteWayRun[] {
    const engine = this.engine;
    const service = this.pathfindingService;
    if (!engine || !service || !this.streetNetwork) return [];
    return describeRouteWays(this.cachedPaths, this.getEdgeIndex(this.streetNetwork), engine, this.globalRouteGrid, service);
  }

  // ========================================
  // CLEANUP
  // ========================================

  /**
   * Dispose all route lines and cleanup
   */
  dispose(): void {
    this.cancelClearanceRun('disposed');
    this.clearRouteLines();
    // Bumps the routes epoch as well.
    this.clearCache();
    this.pathfindingWorker.dispose();
    this.engine = null;
    this.streetNetwork = null;
    this.edgeIndex = null;
    this.underpassIndex = null;
    this.streetRoutes.clear();
    this.clearanceBySegment.clear();
    this.forgetBands();
    this.baseCoords = null;
    this.routesVisible = null;
    this.pathfindingService = null;
    this.onRouteBuilt = null;
  }
}

/** What the corridor in use is made of, see PathAndRouteService.corridorState. */
export interface CorridorState {
  /** Per route in use (key of its street route): the stations of its walkable band, empty before one is built. */
  routes: { key: string; band: readonly BandStation[] }[];
  /**
   * Per measured segment of the street routes (segment key), per station:
   * the free space left and right (NaN unmeasured), the geometric error of
   * the tile under it (Infinity without a tile, null without a probe), why
   * it stayed unmeasured and how far along the route it was measured from
   * (StationProbe.shiftM, null where it was not moved). The fingerprint
   * leaves the shift out.
   */
  stations: {
    key: string;
    left: number[];
    right: number[];
    tileError: (number | null)[];
    unmeasured: (string | null)[];
    shiftM: (number | null)[];
  }[];
}

/** A segment a clearance run measures: where its stations stand and what they found. */
interface ClearanceSegment {
  key: string;
  /** Local start of the segment and the step to its end. */
  x: number;
  z: number;
  dx: number;
  dz: number;
  /** Stations on the segment; station k stands at (k + 0.5) / count of it. */
  count: number;
  onBridge: boolean;
  /**
   * Per route over the segment, the stretches off a bridge end it lies on
   * (deckApproaches), with the route from their bridge ends as the route
   * cells there take them. A station on such a stretch on every route
   * (stationApproach) measures from where those cells stand and judges no
   * low wall, as on the deck (TerrainQueries.measureStreetClearance,
   * `deckEnd`).
   */
  approaches: SegmentApproach[][];
  /** Free space per station and side, NaN until measured, and what each station's rays found. */
  left: number[];
  right: number[];
  probes: (StationProbe | null)[];
}

/**
 * One clearance measurement, see PathAndRouteService.beginClearanceMeasurement.
 * Works through the stations without a measurement one after the other, so
 * a run cut into slices casts the same rays in the same order as one that
 * takes them all at once. Keeps what it found to itself until commit().
 */
class ClearanceRun implements CorridorMeasurement {
  /** The next station to look at. */
  private segment = 0;
  private station = 0;
  /** Stations the run set out to measure, for the log of a cancelled run. */
  private readonly planned: number;
  private probed = 0;
  private unmeasured = 0;
  /** Of those, stations whose tile is still coarser than maxTileError. */
  private coarse = 0;
  private slices = 0;
  /** Main-thread time in step() and commit(). */
  private busyMs = 0;
  private readonly startedAt = performance.now();
  /** How the run ended; null while it is open. */
  private end: 'commit' | 'cancel' | null = null;
  /** Local "x,z" of the stations that found no tile, not even beside themselves, for the log. */
  private readonly noTile: string[] = [];
  /** Positions of stations without a tile the log names; the rest it counts. */
  private static readonly MAX_LOGGED_STATIONS = 10;
  /** Tile geometric error of the stations probed, and the slices against their budget, for the corridor trace. */
  private readonly lod = emptyLod();
  private maxSliceMs = 0;
  private sliceMsTotal = 0;
  private overBudget = 0;
  private readonly budgets = new Set<number>();

  constructor(
    private readonly segments: ClearanceSegment[],
    /** Rays a measured station casts, for the log. */
    private readonly raysPerStation: number,
    private readonly probeAt: (
      x: number, z: number, acrossX: number, acrossZ: number, onDeck: boolean, deckEnd: DeckEnd | null,
    ) => StationProbe | null,
    /** Stores what the run measured; true when that changes a corridor. */
    private readonly store: (segments: readonly ClearanceSegment[]) => boolean,
  ) {
    let planned = 0;
    for (const segment of segments) {
      for (let k = 0; k < segment.count; k++) if (Number.isNaN(segment.left[k])) planned++;
    }
    this.planned = planned;
    corridorTrace.log('clearance.start', { segments: segments.length, stations: planned });
  }

  get open(): boolean {
    return this.end === null;
  }

  /** Stations tried so far and the stations the run set out to measure. */
  get progress(): { done: number; total: number } {
    return { done: this.probed, total: this.planned };
  }

  step(budgetMs: number): boolean {
    if (this.end) return true;
    const start = performance.now();
    this.slices++;
    let here = 0;
    for (let segment = this.next(); segment; segment = this.next()) {
      // Stop before a station that would run past the budget, going by what
      // the stations so far cost (a column and a ray per height and side).
      const elapsed = performance.now() - start;
      if (here > 0 && elapsed + (this.busyMs + elapsed) / this.probed > budgetMs) break;
      this.probe(segment);
      here++;
    }
    const sliceMs = performance.now() - start;
    this.busyMs += sliceMs;
    this.maxSliceMs = Math.max(this.maxSliceMs, sliceMs);
    this.sliceMsTotal += sliceMs;
    this.budgets.add(budgetMs);
    if (sliceMs > budgetMs) this.overBudget++;
    // Against its own budget, not LONG_STEP_MS: these slices aim at budgetMs.
    corridorTrace.cost('clearance.slice', sliceMs, { stations: here, budgetMs }, budgetMs);
    return this.next() === null;
  }

  commit(): boolean {
    if (this.end) return false;
    this.end = 'commit';
    const start = performance.now();
    const changed = this.store(this.segments);
    const storeMs = performance.now() - start;
    this.busyMs += storeMs;
    const rays = this.raysPerStation * (this.probed - this.unmeasured);
    if (this.segments.length > 0) {
      console.log(
        `[Corridor] clearance: segments=${this.segments.length} stations=${this.probed} unmeasured=${this.unmeasured} ` +
        `(coarse tile ${this.coarse}) rays=${rays} changed=${changed} ` +
        `in ${this.busyMs.toFixed(1)}ms slices=${this.slices} wall=${(performance.now() - this.startedAt).toFixed(1)}ms` +
        (this.noTile.length > 0 ? ` noTile=${this.noTileList()}` : ''),
      );
    }
    // A run without segments too, for the trace: the build asked and there was nothing left to measure.
    if (corridorTrace.enabled) {
      corridorTrace.noteChange([], rays);
      corridorTrace.log('clearance.commit', {
        segments: this.segments.length, stations: this.probed, unmeasured: this.unmeasured, coarse: this.coarse, rays, changed,
        lod: formatLod(this.lod), ...this.sliceStats(), busyMs: this.busyMs,
        wallMs: performance.now() - this.startedAt,
      });
      corridorTrace.cost('clearance.commit', storeMs);
    }
    return changed;
  }

  cancel(reason: string): void {
    if (this.end) return;
    this.end = 'cancel';
    if (corridorTrace.enabled) {
      corridorTrace.log('clearance.cancel', { reason, segments: this.segments.length, stations: this.probed, of: this.planned, ...this.sliceStats() });
    }
    if (this.segments.length === 0) return;
    console.log(
      `[Corridor] clearance cancelled (${reason}): stations=${this.probed} of ${this.planned} in ${this.busyMs.toFixed(1)}ms ` +
      `slices=${this.slices} wall=${(performance.now() - this.startedAt).toFixed(1)}ms, corridor unchanged`,
    );
  }

  /**
   * The slices against their budget, for the corridor trace. A slice takes
   * at least one station whatever the budget, so a slow station runs past
   * it (`overBudget`); `budgetMs` lists the budgets the slices had.
   */
  private sliceStats(): Record<string, unknown> {
    return {
      slices: this.slices,
      budgetMs: [...this.budgets].join('/'),
      overBudget: this.overBudget,
      maxSliceMs: this.maxSliceMs,
      meanSliceMs: this.slices > 0 ? this.sliceMsTotal / this.slices : 0,
      msPerStation: this.probed > 0 ? this.sliceMsTotal / this.probed : 0,
    };
  }

  /** The segment of the next station without a measurement, `station` its index there; null when none is left. */
  private next(): ClearanceSegment | null {
    while (this.segment < this.segments.length) {
      const segment = this.segments[this.segment];
      while (this.station < segment.count) {
        if (Number.isNaN(segment.left[this.station])) return segment;
        this.station++;
      }
      this.segment++;
      this.station = 0;
    }
    return null;
  }

  /** The first MAX_LOGGED_STATIONS positions of noTile, then how many more there are. */
  private noTileList(): string {
    const max = ClearanceRun.MAX_LOGGED_STATIONS;
    const more = this.noTile.length - max;
    return this.noTile.slice(0, max).join(';') + (more > 0 ? `;+${more}` : '');
  }

  /** Measure the station next() found and move past it. */
  private probe(segment: ClearanceSegment): void {
    const k = this.station++;
    const t = (k + 0.5) / segment.count;
    const x = segment.x + segment.dx * t;
    const z = segment.z + segment.dz * t;
    // Off a bridge end: the end nearest the station, as for a route cell there
    const approach = segment.onBridge ? null : stationApproach(segment.approaches, t);
    // (-dz, dx) points right of the direction of travel.
    const probe = this.probeAt(x, z, -segment.dz, segment.dx, segment.onBridge, approach ? deckEndAt(approach, t) : null);
    segment.probes[k] = probe;
    this.probed++;
    countLod(this.lod, probe?.tileError ?? Infinity);
    if (probe?.unmeasured === 'coarse tile') this.coarse++;
    if (probe?.unmeasured === 'no tile') this.noTile.push(`${x.toFixed(1)},${z.toFixed(1)}`);
    const free = probeFreeSpace(probe, 'left');
    if (Number.isNaN(free)) {
      this.unmeasured++;
      return;
    }
    segment.left[k] = free;
    segment.right[k] = probeFreeSpace(probe, 'right');
  }
}
