import { Injectable, WritableSignal, inject } from '@angular/core';
import { Vector3, Vector2 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { ThreeTilesEngine } from '../../three-engine';
import { GeoPosition, RouteWaypoint } from '../../models/game.types';
import { Street, StreetNetwork, StreetNode } from '../location/osm-street.service';
import { StreetEdgeIndex } from '../../utils/route-ways';
import {
  CorridorPiece,
  CorridorStations,
  StationProbe,
  corridorConfig,
  estimateStreetWidth,
  fitCorridorPieces,
  fitCorridorStations,
  probeFreeSpace,
  routeHalfWidths,
  runsUnderCover,
  segmentLeft,
  segmentRight,
} from '../../utils/route-corridor';
import { SpawnPoint } from './marker-visualization.service';
import { DevWorldService } from '../../devworld/devworld.service';
import { extendPathToOptimalTurnoff, leavePathForBase, subdivideGeoPath } from '../../utils/route-geometry';
import { UIStore } from '../../store/ui.store';
import { PathfindingWorkerService } from '../location/pathfinding-worker.service';
import { GlobalRouteGridService } from './global-route-grid.service';
import type { CorridorMeasurement } from './corridor-refit';

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
}

/** Key of a directed route segment, for the clearance cache. */
const segmentKey = (a: LatLon, b: LatLon) => `${a.lat},${a.lon}|${b.lat},${b.lon}`;

/** Smallest and largest value seen so far, as `5.0` or `5.0-12.0`, for the diagnostics table. */
class Span {
  private min = Infinity;
  private max = -Infinity;

  add(value: number): string {
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
    return this.min === this.max ? this.min.toFixed(1) : `${this.min.toFixed(1)}-${this.max.toFixed(1)}`;
  }
}

/** `width=5 tunnel=building_passage` etc., for the diagnostics table. */
function describeStreetTags(street: Street): string {
  const parts: string[] = [];
  for (const key of ['width', 'lanes', 'bridge', 'tunnel', 'covered', 'layer'] as const) {
    if (street[key] !== undefined) parts.push(`${key}=${street[key]}`);
  }
  return parts.join(' ');
}

/**
 * One row of `describeRoutes()`: a stretch of a route that runs over a
 * single OSM way (or off the network, `way === null`).
 */
export interface RouteWayRun {
  route: string;
  /** First and last waypoint index of the stretch */
  fromIndex: number;
  toIndex: number;
  way: number | null;
  type: string;
  name: string;
  /** width/lanes/bridge/tunnel/covered/layer, where the way has them */
  tags: string;
  /** Street width the corridor starts from, metres; null off the network */
  widthM: number | null;
  /**
   * Where `widthM` came from: the `width` or `lanes` tag, a typical value
   * for the `highway` class, or `inherited` off the network (the leg to the
   * HQ keeps the width of the street it leaves).
   */
  widthSource: string;
  /** Corridor width in use (left plus right half width), a range where it varies */
  corridorM: string;
  /** Half width left and right of the direction of travel, ranges likewise */
  leftM: string;
  rightM: string;
  lengthM: number;
  /**
   * Largest gap between the cell height (red line, enemy feet) and the
   * street overlay height (yellow line) along the centre line. Several
   * metres mean the cells sit on a roof or a canopy there. Null while the
   * grid or the tiles cannot answer yet.
   */
  maxCellAboveStreetM: number | null;
  /** lat,lon of that maximum */
  at: string;
}

const round1 = (v: number): number | null => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/** One side of the station `__corridor.pick()` explains, see explainCorridorAt(). */
export interface CorridorSideRow {
  side: 'left' | 'right';
  /** Half width from the OSM street: the fallback, and the cap on the leg to the HQ. */
  streetHalfWidthM: number;
  /** First fine hit of the low and the high ray; the ray length where nothing was hit. */
  lowHitM: number | null;
  highHitM: number | null;
  /** Both rays hit something within their length: a wall. */
  wall: boolean | null;
  /** Free space the fitting starts from (the farther hit), after smoothing along the route. */
  freeM: number | null;
  smoothedM: number | null;
  /** Half width that gives now. */
  halfWidthM: number;
  /** Half width the route in use has there; differs from halfWidthM until the next rebuild. */
  inUseM: number | null;
  /** What set the half width. */
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
  /** Street width from OSM and where it came from. */
  streetWidthM: number | null;
  widthSource: string;
  /** False on the leg to the HQ, where the street width is the cap. */
  onStreet: boolean;
  /** In a tunnel or covered passage: not measured, the street width stays. */
  inTunnel: boolean;
  /** Why the station has no measurement, null if it has one. */
  unmeasured: string | null;
  /** Geometric error of the tile under the station at the last probe. */
  tileError: number | null;
  sides: CorridorSideRow[];
  nearby: CorridorStationRow[];
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

  /** Street lookup for route segments, built on first use per street network. */
  private edgeIndex: StreetEdgeIndex | null = null;

  /**
   * Each spawn's route as the street network gives it, before the measured
   * widths split its segments. beginClearanceMeasurement walks these.
   */
  private streetRoutes = new Map<string, StreetRoute>();

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

  /** The clearance measurement under way, see beginClearanceMeasurement. */
  private clearanceRun: ClearanceRun | null = null;

  /** 3D route lines for visualization (using Line2 for proper line width) */
  private routeLines: Line2[] = [];

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
    this.streetRoutes.clear();
    this.cancelClearanceRun('location changed');
    this.clearanceBySegment.clear();
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
  }

  /**
   * Clear all cached paths and the street routes behind them. The routes
   * are about to be replaced, so a clearance measurement of the old ones is
   * cancelled. What was measured stays, by segment: a segment the new
   * routes share keeps its measurement.
   */
  clearCache(): void {
    this.cachedPaths.clear();
    this.streetRoutes.clear();
    this.cancelClearanceRun('routes replaced');
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

    const overlayGroup = this.engine.getOverlayGroup();
    const wasVisible = this.routesVisible?.() ?? false;

    // Remove existing route lines
    for (const line of this.routeLines) {
      overlayGroup.remove(line);
      line.geometry.dispose();
      if (Array.isArray(line.material)) {
        line.material.forEach((m) => m.dispose());
      } else {
        line.material.dispose();
      }
    }
    this.routeLines = [];

    // Re-create route lines for all spawns (in parallel via worker)
    await Promise.all(spawnPoints.map((spawn) => this.showPathFromSpawnAsync(spawn)));

    // Restore visibility state
    for (const line of this.routeLines) {
      line.visible = wasVisible;
    }
  }

  /**
   * Refresh all route lines (re-create from cached paths)
   * @param spawnPoints Current spawn points
   */
  refreshRouteLines(spawnPoints: SpawnPoint[]): void {
    if (!this.engine) return;
    const tRefresh0 = performance.now();

    const overlayGroup = this.engine.getOverlayGroup();
    const wasVisible = this.routesVisible?.() ?? false;

    // Remove existing route lines
    for (const line of this.routeLines) {
      overlayGroup.remove(line);
      line.geometry.dispose();
      if (Array.isArray(line.material)) {
        line.material.forEach((m) => m.dispose());
      } else {
        line.material.dispose();
      }
    }
    this.routeLines = [];

    // Re-create route lines for all spawns
    for (const spawn of spawnPoints) {
      this.showPathFromSpawn(spawn);
    }

    void tRefresh0;

    // Restore visibility state
    for (const line of this.routeLines) {
      line.visible = wasVisible;
    }
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
    // tunnel.
    const ways = this.getEdgeIndex(this.streetNetwork).match(geoPath);
    const streetRoute: StreetRoute = {
      points: geoPath,
      halfWidths: routeHalfWidths(ways),
      onBridge: ways.map((way) => way?.bridge !== undefined),
      onStreet: ways.map((way) => way !== null),
      inTunnel: ways.map((way) => way !== null && runsUnderCover(way)),
    };
    this.streetRoutes.set(spawn.id, streetRoute);
    const fitted = this.applyClearance(streetRoute);
    geoPath = fitted.points;
    const { left: leftWidths, right: rightWidths, onBridge, inTunnel } = fitted;

    // Create route line in Three.js - on terrain with RELATIVE heights
    // DevWorld needs higher offset due to steep procedural terrain
    const HEIGHT_ABOVE_GROUND = this.devWorld.isActive ? 3 : 1;
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
    // We draw a flat line at HQ level; refreshRouteLines runs after
    // onTilesLoaded / grid init and snaps the line up to real heights.
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
      }
      pathWithHeights[i] = waypoint;
    }

    this.cachedPaths.set(spawn.id, pathWithHeights);

    // The spawn portal stands on the route's first cell, facing along it
    this.onRouteBuilt?.(spawn.id, pathWithHeights, startCellY);

    // Convert points to flat array for LineGeometry
    const positions: number[] = [];
    for (const pt of points) {
      positions.push(pt.x, pt.y, pt.z);
    }

    const geometry = new LineGeometry();
    geometry.setPositions(positions);

    const material = new LineMaterial({
      color: spawn.color,
      linewidth: 2, // In pixels (actually works with Line2!)
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: false,
      worldUnits: false, // Use screen pixels, not world units
      resolution: new Vector2(window.innerWidth, window.innerHeight),
    });

    const routeLine = new Line2(geometry, material);
    routeLine.computeLineDistances(); // Required for Line2
    routeLine.visible = this.routesVisible?.() ?? false;
    routeLine.renderOrder = 1;
    routeLine.frustumCulled = false; // Prevent disappearing at certain angles

    overlayGroup.add(routeLine);
    this.routeLines.push(routeLine);
  }

  /**
   * Split each segment into the pieces the tiles gave it
   * (fitCorridorPieces), with the half width left and right of the
   * direction of travel per piece. Each piece keeps its segment's bridge
   * and tunnel flags. Before anything was measured, every segment runs at
   * its street's half width on both sides.
   */
  private applyClearance(
    route: StreetRoute,
  ): { points: LatLon[]; left: number[]; right: number[]; onBridge: boolean[]; inTunnel: boolean[] } {
    const { points, halfWidths, onBridge, inTunnel } = route;
    if (this.clearanceBySegment.size === 0) return { points, left: halfWidths, right: halfWidths, onBridge, inTunnel };

    const fitted = this.fitRoute(route);
    const fittedPoints: LatLon[] = [];
    const left: number[] = [];
    const right: number[] = [];
    const fittedBridges: boolean[] = [];
    const fittedTunnels: boolean[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      for (const piece of fitted[i]) {
        fittedPoints.push(piece.t === 0 ? a : { lat: a.lat + (b.lat - a.lat) * piece.t, lon: a.lon + (b.lon - a.lon) * piece.t });
        left.push(piece.left);
        right.push(piece.right);
        fittedBridges.push(onBridge[i]);
        fittedTunnels.push(inTunnel[i]);
      }
    }
    fittedPoints.push(points[points.length - 1]);
    return { points: fittedPoints, left, right, onBridge: fittedBridges, inTunnel: fittedTunnels };
  }

  /** The corridor pieces of each segment of `route`, from what the tiles showed. */
  private fitRoute(route: StreetRoute): CorridorPiece[][] {
    return fitCorridorPieces(this.corridorStationsOf(route));
  }

  /** The segments of `route` as the corridor fitting sees them. */
  private corridorStationsOf(route: StreetRoute): CorridorStations[] {
    const segments: CorridorStations[] = [];
    for (let i = 0; i < route.points.length - 1; i++) {
      const measured = this.clearanceBySegment.get(segmentKey(route.points[i], route.points[i + 1]));
      segments.push({
        left: measured?.left ?? [],
        right: measured?.right ?? [],
        fallback: route.halfWidths[i],
        onStreet: route.onStreet[i],
      });
    }
    return segments;
  }

  /** The pieces every route gets from what is measured now, to tell whether a measurement changed any. */
  private fittedCorridors(): string {
    return JSON.stringify([...this.streetRoutes.values()].map((route) => this.fitRoute(route)));
  }

  /**
   * Forget what the tiles showed, so the next beginClearanceMeasurement
   * measures every station again: after a settings change that moves the
   * stations or the rays (MEASUREMENT_KEYS). A run under way is cancelled.
   */
  clearCorridorMeasurements(): void {
    this.cancelClearanceRun('measurements cleared');
    this.clearanceBySegment.clear();
  }

  /**
   * Stations of the routes in use that the last measurement could not take
   * because their tile was missing or still coarser than `maxTileError`,
   * which a later run may. Segments of a route that was replaced (a spawn
   * moved) do not count. DevWorld has none: there is nothing to measure
   * there.
   */
  hasUnmeasuredStations(): boolean {
    for (const { points } of this.streetRoutes.values()) {
      for (let i = 0; i < points.length - 1; i++) {
        const probes = this.clearanceBySegment.get(segmentKey(points[i], points[i + 1]))?.probes;
        if (probes?.some((probe) => probe !== null && probe.unmeasured !== null)) return true;
      }
    }
    return false;
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
      this.clearanceBySegment.get(segmentKey(route.points[i], route.points[i + 1]))?.left.length
        ?? Math.max(1, Math.round(length / corridorConfig.stationSpacing));

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
    const measured = this.clearanceBySegment.get(segmentKey(route.points[i], route.points[i + 1]));
    const probe = measured?.probes[k] ?? null;
    const way = this.getEdgeIndex(network).match(route.points)[i];
    const estimate = way ? estimateStreetWidth(way) : null;
    const inUse = this.corridorInUse(routeId, best.x, best.z);

    const sideRow = (side: 'left' | 'right'): CorridorSideRow => {
      const station = fit[side][i][k];
      const hits = probe && probe.unmeasured === null ? probe[side] : null;
      return {
        side,
        streetHalfWidthM: route.halfWidths[i],
        lowHitM: hits ? round1(hits[0]) : null,
        highHitM: hits ? round1(hits[hits.length - 1]) : null,
        wall: hits ? hits.every((d) => d < corridorConfig.maxHalfWidth) : null,
        freeM: station ? round1(station.free) : null,
        smoothedM: station ? round1(station.smoothed) : null,
        halfWidthM: station ? station.halfWidth : route.halfWidths[i],
        inUseM: inUse ? inUse[side] : null,
        rule: station ? station.rule
          : route.inTunnel[i] ? 'tunnel or covered: street width'
          : 'not measured yet: street width',
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
      const near = this.clearanceBySegment.get(segmentKey(route.points[s.i], route.points[s.i + 1]))?.probes[s.k] ?? null;
      return {
        station: `${s.i}:${s.k + 1}/${s.n}`,
        alongM: round1(s.alongM),
        leftFreeM: round1(fit.left[s.i][s.k].free),
        leftM: fit.left[s.i][s.k].halfWidth,
        rightFreeM: round1(fit.right[s.i][s.k].free),
        rightM: fit.right[s.i][s.k].halfWidth,
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
      streetWidthM: estimate?.widthM ?? null,
      widthSource: estimate?.source ?? 'inherited',
      onStreet: route.onStreet[i],
      inTunnel: route.inTunnel[i],
      unmeasured: route.inTunnel[i] ? 'tunnel or covered: not measured'
        : probe ? probe.unmeasured
        : measured ? 'no probe (DevWorld)'
        : 'not measured yet',
      tileError: probe ? round1(probe.tileError) : null,
      sides: [sideRow('left'), sideRow('right')],
      nearby,
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
   * towers (CorridorRefit).
   */
  beginClearanceMeasurement(): CorridorMeasurement {
    this.cancelClearanceRun('superseded');
    const engine = this.engine;
    const rayHeights = [corridorConfig.rayHeightLow, corridorConfig.rayHeightHigh];
    const maxHalfWidth = corridorConfig.maxHalfWidth;
    const segments: ClearanceSegment[] = [];
    // Routes from several spawns share segments; one pass over each is enough.
    const seen = new Set<string>();

    for (const { points, onBridge, inTunnel } of this.streetRoutes.values()) {
      if (!engine) break;
      for (let i = 0; i < points.length - 1; i++) {
        // In a tunnel the rays would hit its walls and the column the ground
        // above: the street width stays.
        if (inTunnel[i]) continue;
        const a = points[i];
        const b = points[i + 1];
        const key = segmentKey(a, b);
        if (seen.has(key)) continue;
        seen.add(key);
        const known = this.clearanceBySegment.get(key);
        if (known && !known.left.some(Number.isNaN)) continue;

        const start = engine.sync.geoToLocalSimple(a.lat, a.lon, 0);
        const end = engine.sync.geoToLocalSimple(b.lat, b.lon, 0);
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.01) continue;

        const count = Math.max(1, Math.round(length / corridorConfig.stationSpacing));
        segments.push({
          key, x: start.x, z: start.z, dx, dz, count, onBridge: onBridge[i],
          left: known ? [...known.left] : new Array<number>(count).fill(NaN),
          right: known ? [...known.right] : new Array<number>(count).fill(NaN),
          probes: known ? [...known.probes] : new Array<StationProbe | null>(count).fill(null),
        });
      }
    }

    const run: ClearanceRun = new ClearanceRun(
      segments,
      2 * rayHeights.length,
      (x, z, acrossX, acrossZ, onDeck) =>
        engine?.terrain.measureStreetClearance(x, z, acrossX, acrossZ, rayHeights, maxHalfWidth, onDeck) ?? null,
      (measured) => this.storeClearance(run, measured),
    );
    this.clearanceRun = run;
    return run;
  }

  /** Hand what a finished run measured to the corridor; true when that changes one. */
  private storeClearance(run: ClearanceRun, segments: readonly ClearanceSegment[]): boolean {
    if (this.clearanceRun === run) this.clearanceRun = null;
    const before = this.fittedCorridors();
    // Stored with their unmeasured stations as well: they keep their
    // place, so the smoothing along the route does not join what lies
    // either side of them.
    for (const { key, left, right, probes } of segments) {
      this.clearanceBySegment.set(key, { left, right, probes });
    }
    return this.fittedCorridors() !== before;
  }

  /** Cancel the clearance measurement under way, if any; nothing of it is stored. */
  private cancelClearanceRun(reason: string): void {
    this.clearanceRun?.cancel(reason);
    this.clearanceRun = null;
  }

  /**
   * Clear all route lines
   */
  clearRouteLines(): void {
    if (!this.engine) return;

    const overlayGroup = this.engine.getOverlayGroup();

    for (const line of this.routeLines) {
      overlayGroup.remove(line);
      line.geometry.dispose();
      if (Array.isArray(line.material)) {
        line.material.forEach((m) => m.dispose());
      } else {
        line.material.dispose();
      }
    }

    this.routeLines = [];
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
    for (const line of this.routeLines) {
      line.visible = visible;
    }
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
    return this.routeLines;
  }

  // ========================================
  // DIAGNOSTICS
  // ========================================

  /**
   * Zerlegt jede gecachte Route in die OSM-Ways, über die sie läuft, und
   * vergleicht entlang der Mittellinie (alle 2 m) die Zellhöhe mit der Höhe,
   * die das gelbe Straßen-Overlay an derselben Stelle nimmt
   * (`getGroundHeightEstimate`, seitliches Minimum). Beantwortet am Ort eines
   * Routen-Befunds zwei Fragen: Läuft die Route dort über einen anderen Way
   * als die sichtbare Straße (Fußweg, Durchgang, Tunnel)? Und liegen die
   * Zellen dort auf Dach oder Baumkrone, während die Straße darunter liegt?
   * Dazu die Straßenbreite, ihre Quelle und die Korridorbreite, die daraus
   * geworden ist.
   *
   * Nur für Diagnose: ein Aufruf kostet pro Punkt bis zu fünf Säulen-Samples.
   */
  describeRoutes(): RouteWayRun[] {
    const engine = this.engine;
    const service = this.pathfindingService;
    if (!engine || !service || !this.streetNetwork) return [];

    const index = this.getEdgeIndex(this.streetNetwork);
    const cellsReady = this.globalRouteGrid.isInitialized();
    const rows: RouteWayRun[] = [];

    for (const [routeId, path] of this.cachedPaths) {
      const ways = index.match(path);
      let run: RouteWayRun | null = null;
      let spans = { corridor: new Span(), left: new Span(), right: new Span() };

      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const street = ways[i];
        const wayId = street?.id ?? null;

        if (!run || run.way !== wayId) {
          const estimate = street ? estimateStreetWidth(street) : null;
          run = {
            route: routeId,
            fromIndex: i,
            toIndex: i + 1,
            way: wayId,
            type: street?.type ?? '(off network)',
            name: street?.name ?? '',
            tags: street ? describeStreetTags(street) : '',
            widthM: estimate?.widthM ?? null,
            widthSource: estimate?.source ?? 'inherited',
            corridorM: '',
            leftM: '',
            rightM: '',
            lengthM: 0,
            maxCellAboveStreetM: null,
            at: '',
          };
          rows.push(run);
          spans = { corridor: new Span(), left: new Span(), right: new Span() };
        }
        run.toIndex = i + 1;

        const left = segmentLeft(a);
        const right = segmentRight(a);
        run.corridorM = spans.corridor.add(left + right);
        run.leftM = spans.left.add(left);
        run.rightM = spans.right.add(right);

        const length = service.haversineDistance(a.lat, a.lon, b.lat, b.lon);
        run.lengthM += length;
        if (!cellsReady) continue;

        const steps = Math.max(1, Math.ceil(length / 2));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const lat = a.lat + (b.lat - a.lat) * t;
          const lon = a.lon + (b.lon - a.lon) * t;
          const local = engine.sync.geoToLocalSimple(lat, lon, 0);
          const cellY = this.globalRouteGrid.getGroundLocalYAt(local.x, local.z);
          const streetY = engine.terrain.getGroundHeightEstimate(lat, lon, a.lat, a.lon, b.lat, b.lon);
          if (cellY === null || streetY === null) continue;
          const gap = cellY - streetY;
          if (run.maxCellAboveStreetM === null || gap > run.maxCellAboveStreetM) {
            run.maxCellAboveStreetM = gap;
            run.at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
          }
        }
      }
    }

    for (const row of rows) {
      row.lengthM = Math.round(row.lengthM * 10) / 10;
      if (row.maxCellAboveStreetM !== null) {
        row.maxCellAboveStreetM = Math.round(row.maxCellAboveStreetM * 10) / 10;
      }
    }
    return rows;
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
    this.clearCache();
    this.pathfindingWorker.dispose();
    this.engine = null;
    this.streetNetwork = null;
    this.edgeIndex = null;
    this.streetRoutes.clear();
    this.clearanceBySegment.clear();
    this.baseCoords = null;
    this.routesVisible = null;
    this.pathfindingService = null;
    this.onRouteBuilt = null;
  }
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
  private isOpen = true;

  constructor(
    private readonly segments: ClearanceSegment[],
    /** Rays a measured station casts, for the log. */
    private readonly raysPerStation: number,
    private readonly probeAt: (x: number, z: number, acrossX: number, acrossZ: number, onDeck: boolean) => StationProbe | null,
    /** Stores what the run measured; true when that changes a corridor. */
    private readonly store: (segments: readonly ClearanceSegment[]) => boolean,
  ) {
    let planned = 0;
    for (const segment of segments) {
      for (let k = 0; k < segment.count; k++) if (Number.isNaN(segment.left[k])) planned++;
    }
    this.planned = planned;
  }

  get open(): boolean {
    return this.isOpen;
  }

  step(budgetMs: number): boolean {
    if (!this.isOpen) return true;
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
    this.busyMs += performance.now() - start;
    return this.next() === null;
  }

  commit(flushedBy?: string): boolean {
    if (!this.isOpen) return false;
    this.isOpen = false;
    const start = performance.now();
    const changed = this.store(this.segments);
    this.busyMs += performance.now() - start;
    if (this.segments.length > 0) {
      console.warn(
        `[Corridor] clearance: segments=${this.segments.length} stations=${this.probed} unmeasured=${this.unmeasured} ` +
        `(coarse tile ${this.coarse}) rays=${this.raysPerStation * (this.probed - this.unmeasured)} changed=${changed} ` +
        `in ${this.busyMs.toFixed(1)}ms slices=${this.slices} wall=${(performance.now() - this.startedAt).toFixed(1)}ms` +
        (flushedBy ? ` flushed=${flushedBy}` : ''),
      );
    }
    return changed;
  }

  cancel(reason: string): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.segments.length === 0) return;
    console.warn(
      `[Corridor] clearance cancelled (${reason}): stations=${this.probed} of ${this.planned} in ${this.busyMs.toFixed(1)}ms ` +
      `slices=${this.slices} wall=${(performance.now() - this.startedAt).toFixed(1)}ms, corridor unchanged`,
    );
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

  /** Measure the station next() found and move past it. */
  private probe(segment: ClearanceSegment): void {
    const k = this.station++;
    const t = (k + 0.5) / segment.count;
    // (-dz, dx) points right of the direction of travel.
    const probe = this.probeAt(segment.x + segment.dx * t, segment.z + segment.dz * t, -segment.dz, segment.dx, segment.onBridge);
    segment.probes[k] = probe;
    this.probed++;
    if (probe?.unmeasured === 'coarse tile') this.coarse++;
    const free = probeFreeSpace(probe, 'left');
    if (Number.isNaN(free)) {
      this.unmeasured++;
      return;
    }
    segment.left[k] = free;
    segment.right[k] = probeFreeSpace(probe, 'right');
  }
}
