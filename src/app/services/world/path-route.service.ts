import { Injectable, WritableSignal, inject } from '@angular/core';
import { Group, Vector3, Vector2 } from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { ThreeTilesEngine } from '../../three-engine';
import { GeoPosition, RouteWaypoint } from '../../models/game.types';
import { Street, StreetNetwork, StreetNode } from '../location/osm-street.service';
import { StreetEdgeIndex } from '../../utils/route-ways';
import {
  CLEARANCE_RAY_HEIGHT_M,
  CLEARANCE_STATION_SPACING_M,
  CorridorPiece,
  clearancePieces,
  estimateStreetWidth,
  routeHalfWidths,
  segmentHalfWidth,
} from '../../utils/route-corridor';
import { SpawnPoint } from './marker-visualization.service';
import { DevWorldService } from '../../devworld/devworld.service';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';
import { UIStore } from '../../store/ui.store';
import { PathfindingWorkerService } from '../location/pathfinding-worker.service';
import { GlobalRouteGridService } from './global-route-grid.service';

/**
 * Interface for pathfinding services (OsmStreetService or DevStreetProvider)
 */
export interface PathfindingService {
  findPath(network: StreetNetwork, startLat: number, startLon: number, endLat: number, endLon: number): StreetNode[];
  haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number;
}

interface LatLon {
  lat: number;
  lon: number;
}

/** Key of a directed route segment, for the clearance cache. */
const segmentKey = (a: LatLon, b: LatLon) => `${a.lat},${a.lon}|${b.lat},${b.lon}`;

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
  /** Corridor width in use (twice the half width), a range where it varies */
  corridorM: string;
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
   * Each spawn's route as the street network gives it, before measured
   * narrowings split its segments, with the street half width per segment.
   * measureStreetClearance walks these.
   */
  private streetRoutes = new Map<string, { points: LatLon[]; halfWidths: number[] }>();

  /**
   * Corridor pieces the tiles allowed per street segment (segmentKey),
   * measured once per location and applied on every route build.
   */
  private clearanceBySegment = new Map<string, CorridorPiece[]>();


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

  /** Spawn markers for snap-to-path functionality */
  private spawnMarkers: Group[] = [];

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
   * @param spawnMarkers Array of spawn markers for snapping
   */
  initialize(
    engine: ThreeTilesEngine,
    streetNetwork: StreetNetwork,
    baseCoords: GeoPosition,
    routesVisible: WritableSignal<boolean>,
    pathfindingService: PathfindingService,
    spawnMarkers: Group[]
  ): void {
    this.engine = engine;
    this.streetNetwork = streetNetwork;
    this.edgeIndex = null;
    this.streetRoutes.clear();
    this.clearanceBySegment.clear();
    this.baseCoords = baseCoords;
    this.routesVisible = routesVisible;
    this.pathfindingService = pathfindingService;
    this.spawnMarkers = spawnMarkers;

    // Diagnose-API für Playtests, analog zu `__rg`: in DevTools
    // `__routes.describe()` aufrufen, siehe describeRoutes().
    (globalThis as Record<string, unknown>)['__routes'] = {
      describe: () => console.table(this.describeRoutes()),
    };
  }

  /**
   * Update spawn markers reference
   * @param spawnMarkers Updated spawn markers array
   */
  updateSpawnMarkers(spawnMarkers: Group[]): void {
    this.spawnMarkers = spawnMarkers;
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
   * Clear all cached paths
   */
  clearCache(): void {
    this.cachedPaths.clear();
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

    // Snap spawn marker to actual path start
    const pathStart = path[0];
    if (pathStart) {
      this.snapSpawnMarkerToPathStart(spawn.id, pathStart.lat, pathStart.lon);
    }

    // Convert path to geoPath
    let geoPath = path.map((n) => ({ lat: n.lat, lon: n.lon }));

    // Extend the path along the street to find the optimal turn-off point
    geoPath = this.extendPathToOptimalTurnoff(geoPath, this.baseCoords);

    // Find the closest point to HQ on the path
    let closestSegmentIndex = geoPath.length - 2;
    let closestPointOnSegment: { lat: number; lon: number } | null = null;
    let closestDist = Infinity;

    for (let i = 0; i < geoPath.length - 1; i++) {
      const a = geoPath[i];
      const b = geoPath[i + 1];

      const closest = this.closestPointOnSegment(a, b, {
        lat: this.baseCoords.lat,
        lon: this.baseCoords.lon,
      });
      const dist = this.pathfindingService.haversineDistance(
        closest.lat,
        closest.lon,
        this.baseCoords.lat,
        this.baseCoords.lon
      );

      if (dist < closestDist) {
        closestDist = dist;
        closestSegmentIndex = i;
        closestPointOnSegment = closest;
      }
    }

    // Cut path at the segment and insert the closest point
    geoPath = geoPath.slice(0, closestSegmentIndex + 1);
    if (closestPointOnSegment) {
      const lastPoint = geoPath[geoPath.length - 1];
      const distToLast = this.pathfindingService.haversineDistance(
        closestPointOnSegment.lat,
        closestPointOnSegment.lon,
        lastPoint.lat,
        lastPoint.lon
      );
      if (distToLast > 1) {
        geoPath.push(closestPointOnSegment);
      }
    }

    // Add HQ as final destination
    geoPath.push({ lat: this.baseCoords.lat, lon: this.baseCoords.lon });

    // DevWorld: Subdivide long segments for smooth terrain following on steep hills
    // Real World: Use original path directly (Google Maps terrain is smoother)
    if (this.devWorld.isActive) {
      geoPath = this.subdivideGeoPath(geoPath, 2);
    }

    // Corridor half width per segment, from the street each one runs over,
    // then narrowed where the tiles showed less room (measureStreetClearance).
    // Cells and enemy spread read it off the cached waypoints.
    const streetHalfWidths = routeHalfWidths(this.getEdgeIndex(this.streetNetwork).match(geoPath));
    this.streetRoutes.set(spawn.id, { points: geoPath, halfWidths: streetHalfWidths });
    const fitted = this.applyClearance(geoPath, streetHalfWidths);
    geoPath = fitted.points;
    const halfWidths = fitted.halfWidths;

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

    for (let i = 0; i < geoPath.length; i++) {
      const pos = geoPath[i];
      const local = this.engine.sync.geoToLocalSimple(pos.lat, pos.lon, 0);

      let cellY: number | null = null;
      if (cellsReady) {
        cellY = this.globalRouteGrid.getGroundLocalYAt(local.x, local.z);
      }
      const terrainY = cellY ?? fallbackTerrainY;

      // Line geometry: local frame, relative to origin's terrain Y, plus the
      // small lift so the line stays visible above ground.
      local.y = terrainY + HEIGHT_ABOVE_GROUND;
      points.push(local);

      // Cached path keeps an absolute geo height for any legacy reader.
      // Enemy movement/spawn no longer use this field — they read cells
      // directly — but route-animation and external consumers may rely on it.
      const waypoint: RouteWaypoint = { ...pos, height: terrainY + origin.height };
      if (i < halfWidths.length) waypoint.corridorHalfWidth = halfWidths[i];
      pathWithHeights[i] = waypoint;
    }

    this.cachedPaths.set(spawn.id, pathWithHeights);

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

  /** Split the segments the tiles narrowed into their pieces, see clearancePieces. */
  private applyClearance(points: LatLon[], halfWidths: number[]): { points: LatLon[]; halfWidths: number[] } {
    if (this.clearanceBySegment.size === 0) return { points, halfWidths };

    const fittedPoints: LatLon[] = [];
    const fittedWidths: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const pieces = this.clearanceBySegment.get(segmentKey(a, b));
      if (!pieces || pieces.length === 0) {
        fittedPoints.push(a);
        fittedWidths.push(halfWidths[i]);
        continue;
      }
      for (const piece of pieces) {
        fittedPoints.push(piece.t === 0 ? a : { lat: a.lat + (b.lat - a.lat) * piece.t, lon: a.lon + (b.lon - a.lon) * piece.t });
        fittedWidths.push(piece.halfWidth);
      }
    }
    fittedPoints.push(points[points.length - 1]);
    return { points: fittedPoints, halfWidths: fittedWidths };
  }

  /**
   * Measure how much room the tiles leave either side of every route
   * segment and remember where it is less than the street width, so the next
   * route build fits the corridor to it. A station every 2 m with two
   * horizontal rays (ThreeTilesEngine.measureStreetClearance); a station
   * without fine tiles keeps the street width. Segments measured before are
   * skipped, segments nothing could be measured on are tried again next time.
   *
   * Meant to run once per location, when the corridor tiles have loaded:
   * the grid is rebuilt from the result, so it must not run under placed
   * towers.
   *
   * @returns true when a segment came out narrower than its street, i.e.
   *   routes and grid need a rebuild
   */
  measureStreetClearance(): boolean {
    const engine = this.engine;
    if (!engine) return false;

    const t0 = performance.now();
    let segments = 0;
    let stations = 0;
    let unmeasured = 0;
    let narrowed = 0;

    for (const { points, halfWidths } of this.streetRoutes.values()) {
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const key = segmentKey(a, b);
        if (this.clearanceBySegment.has(key)) continue;

        const start = engine.sync.geoToLocalSimple(a.lat, a.lon, 0);
        const end = engine.sync.geoToLocalSimple(b.lat, b.lon, 0);
        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const length = Math.hypot(dx, dz);
        if (length < 0.01) continue;

        const count = Math.max(1, Math.round(length / CLEARANCE_STATION_SPACING_M));
        const clearances: number[] = [];
        let measured = 0;
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count;
          const clearance = engine.measureStreetClearance(
            start.x + dx * t, start.z + dz * t, -dz, dx, CLEARANCE_RAY_HEIGHT_M, halfWidths[i],
          );
          clearances.push(clearance ?? NaN);
          if (clearance !== null) measured++;
        }
        segments++;
        stations += count;
        unmeasured += count - measured;
        if (measured === 0) continue;

        const pieces = clearancePieces(halfWidths[i], clearances);
        this.clearanceBySegment.set(key, pieces);
        if (pieces.some((piece) => piece.halfWidth < halfWidths[i])) narrowed++;
      }
    }

    if (segments > 0) {
      console.warn(
        `[Corridor] clearance: segments=${segments} stations=${stations} unmeasured=${unmeasured} ` +
        `rays=${2 * (stations - unmeasured)} narrowed=${narrowed} in ${(performance.now() - t0).toFixed(1)}ms`,
      );
    }
    return narrowed > 0;
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
  // PATH OPTIMIZATION
  // ========================================

  // ========================================
  // HEIGHT SMOOTHING - CONSTANTS
  // ========================================

  /**
   * Max slope (rise/run) by OSM highway type.
   * Based on AASHTO road design standards with margin for photogrammetric noise.
   * Values represent the steepest realistic grade for each road category.
   */
  private static readonly SLOPE_LIMITS: Record<string, number> = {
    'motorway': 0.08,
    'motorway_link': 0.10,
    'trunk': 0.10,
    'trunk_link': 0.12,
    'primary': 0.12,
    'primary_link': 0.12,
    'secondary': 0.12,
    'secondary_link': 0.15,
    'tertiary': 0.15,
    'tertiary_link': 0.15,
    'residential': 0.15,
    'living_street': 0.15,
    'unclassified': 0.15,
    'service': 0.20,
    'pedestrian': 0.20,
    'footway': 0.35,
    'path': 0.35,
    'cycleway': 0.15,
    'track': 0.25,
    'steps': 0.80,
  };
  private static readonly DEFAULT_SLOPE_LIMIT = 0.20;

  /**
   * Sliding window size (meters) by road type.
   * Larger windows catch wider tree clusters but risk affecting bridges.
   * Smaller windows are more precise but miss wide anomalies.
   */
  private static readonly WINDOW_SIZES: Record<string, number> = {
    'motorway': 50,
    'motorway_link': 40,
    'trunk': 40,
    'trunk_link': 35,
    'primary': 35,
    'primary_link': 30,
    'secondary': 30,
    'secondary_link': 25,
    'tertiary': 25,
    'residential': 20,
    'living_street': 20,
    'service': 15,
    'footway': 12,
    'path': 12,
    'cycleway': 20,
    'track': 15,
  };
  private static readonly DEFAULT_WINDOW_SIZE = 20;

  /**
   * Threshold (meters) above sliding window minimum to flag as obstacle.
   * Must be high enough to preserve bridges (typically 2-4m above nearest ramp within window)
   * but low enough to catch trees (typically 5-15m above ground).
   */
  private static readonly OBSTACLE_THRESHOLD = 5;

  // ========================================
  // HEIGHT SMOOTHING - ALGORITHM
  // ========================================

  /**
   * Smooth path heights using a multi-pass algorithm to remove terrain sampling anomalies
   * (trees, buildings, vehicles hitting raycast instead of ground).
   *
   * Pipeline:
   * 1. Compute cumulative distances (meters) for distance-based operations
   * 2. Distance-based sliding window minimum to detect obstacles
   * 3. Forward-backward slope enforcement to remove remaining spikes
   * 4. Light distance-weighted smoothing for visual quality
   *
   * Preserves bridges: bridge ramps have realistic slopes (within limits) and
   * the sliding window minimum threshold is set above typical bridge elevation differences.
   *
   * @param points Path points with potentially noisy heights
   * @param streetType OSM highway type (e.g., 'residential', 'primary') for slope/window tuning
   * @returns Smoothed path points
   */
  smoothPathHeights(points: Vector3[], streetType?: string): Vector3[] {
    if (points.length < 3) return points.map(p => p.clone());

    // === Step 1: Compute cumulative distances in meters ===
    const cumDist: number[] = [0];
    for (let i = 1; i < points.length; i++) {
      const dx = points[i].x - points[i - 1].x;
      const dz = points[i].z - points[i - 1].z;
      cumDist.push(cumDist[i - 1] + Math.sqrt(dx * dx + dz * dz));
    }

    // Clone points for modification
    const result = points.map(p => p.clone());

    // === Step 2: Distance-based sliding window minimum ===
    // Compute window minimums from ORIGINAL heights (no cascading)
    const windowSize = (streetType && PathAndRouteService.WINDOW_SIZES[streetType])
      || PathAndRouteService.DEFAULT_WINDOW_SIZE;
    const halfWindow = windowSize / 2;
    const windowMins: number[] = [];

    for (let i = 0; i < result.length; i++) {
      let minY = result[i].y;

      // Look backward within window distance
      for (let j = i - 1; j >= 0 && (cumDist[i] - cumDist[j]) <= halfWindow; j--) {
        minY = Math.min(minY, result[j].y);
      }

      // Look forward within window distance
      for (let j = i + 1; j < result.length && (cumDist[j] - cumDist[i]) <= halfWindow; j++) {
        minY = Math.min(minY, result[j].y);
      }

      windowMins.push(minY);
    }

    // Correct points significantly above their window minimum (skip endpoints)
    for (let i = 1; i < result.length - 1; i++) {
      if (result[i].y - windowMins[i] > PathAndRouteService.OBSTACLE_THRESHOLD) {
        result[i].y = windowMins[i];
      }
    }

    // === Step 3: Forward-backward slope enforcement ===
    // Multiple iterations for convergence on consecutive anomalies
    const maxSlope = (streetType && PathAndRouteService.SLOPE_LIMITS[streetType])
      || PathAndRouteService.DEFAULT_SLOPE_LIMIT;

    for (let iteration = 0; iteration < 3; iteration++) {
      // Forward pass: cap how high each point can be relative to its predecessor
      for (let i = 1; i < result.length; i++) {
        const dist = cumDist[i] - cumDist[i - 1];
        if (dist < 0.001) continue;
        const maxRise = dist * maxSlope;
        result[i].y = Math.min(result[i].y, result[i - 1].y + maxRise);
      }

      // Backward pass: cap how high each point can be relative to its successor
      for (let i = result.length - 2; i >= 0; i--) {
        const dist = cumDist[i + 1] - cumDist[i];
        if (dist < 0.001) continue;
        const maxRise = dist * maxSlope;
        result[i].y = Math.min(result[i].y, result[i + 1].y + maxRise);
      }
    }

    // === Step 4: Light distance-weighted smoothing ===
    // Gaussian-like smooth to remove jaggedness after correction passes.
    // Uses real distance (sigma in meters) so effect is consistent regardless of point density.
    const SIGMA = 3; // meters - smoothing radius
    const SIGMA_SQ_2 = 2 * SIGMA * SIGMA;
    const MAX_SMOOTH_DIST = SIGMA * 3; // beyond 3*sigma, weight is negligible
    const smoothed = result.map(p => p.clone());

    for (let i = 1; i < result.length - 1; i++) {
      let weightedSum = 0;
      let weightTotal = 0;

      // Only scan nearby points within the smoothing radius
      for (let j = i; j >= 0 && (cumDist[i] - cumDist[j]) <= MAX_SMOOTH_DIST; j--) {
        const dist = cumDist[i] - cumDist[j];
        const weight = Math.exp(-(dist * dist) / SIGMA_SQ_2);
        weightedSum += result[j].y * weight;
        weightTotal += weight;
      }
      for (let j = i + 1; j < result.length && (cumDist[j] - cumDist[i]) <= MAX_SMOOTH_DIST; j++) {
        const dist = cumDist[j] - cumDist[i];
        const weight = Math.exp(-(dist * dist) / SIGMA_SQ_2);
        weightedSum += result[j].y * weight;
        weightTotal += weight;
      }

      if (weightTotal > 0) {
        smoothed[i].y = weightedSum / weightTotal;
      }
    }

    return smoothed;
  }

  /**
   * Find closest point on a line segment to a target point
   * @param a Segment start
   * @param b Segment end
   * @param target Target point
   * @returns Closest point on segment
   */
  private closestPointOnSegment(
    a: { lat: number; lon: number },
    b: { lat: number; lon: number },
    target: { lat: number; lon: number }
  ): { lat: number; lon: number } {
    // Project in metre-proportional units: a degree of longitude is only
    // cos(lat) as long as a degree of latitude. Unscaled, the foot point
    // slides along the street (~6 m on a diagonal street at 48° N) and the
    // last leg to the HQ runs at a slant instead of straight across.
    const lonScale = Math.cos(((a.lat + b.lat) * 0.5) * DEG_TO_RAD);
    const dLon = b.lon - a.lon;
    const dLat = b.lat - a.lat;
    const dx = dLon * lonScale;
    const lengthSquared = dx * dx + dLat * dLat;

    if (lengthSquared === 0) {
      return { lat: a.lat, lon: a.lon };
    }

    // Project target onto the line, clamped to segment
    const t = Math.max(0, Math.min(1, ((target.lon - a.lon) * lonScale * dx + (target.lat - a.lat) * dLat) / lengthSquared));

    return {
      lat: a.lat + t * dLat,
      lon: a.lon + t * dLon,
    };
  }

  /**
   * Extend path along streets to find optimal 90° turn-off point to HQ
   * @param geoPath Current path
   * @param base Base coordinates (GeoPosition with lat/lon)
   * @returns Extended path
   */
  private extendPathToOptimalTurnoff(
    geoPath: { lat: number; lon: number }[],
    base: GeoPosition
  ): { lat: number; lon: number }[] {
    if (!this.streetNetwork || !this.pathfindingService || geoPath.length < 2) return geoPath;

    const lastPoint = geoPath[geoPath.length - 1];

    // Find streets that contain a node near the last point
    const TOLERANCE = 0.00001; // ~1m tolerance
    const matchingStreets: { street: Street; nodeIndex: number }[] = [];

    for (const street of this.streetNetwork.streets) {
      for (let i = 0; i < street.nodes.length; i++) {
        const node = street.nodes[i];
        if (Math.abs(node.lat - lastPoint.lat) < TOLERANCE && Math.abs(node.lon - lastPoint.lon) < TOLERANCE) {
          matchingStreets.push({ street, nodeIndex: i });
        }
      }
    }

    if (matchingStreets.length === 0) return geoPath;

    // Find best extension
    let bestExtension: { lat: number; lon: number }[] = [];
    let bestClosestDist = this.pathfindingService.haversineDistance(
      lastPoint.lat,
      lastPoint.lon,
      base.lat,
      base.lon
    );

    for (const { street, nodeIndex } of matchingStreets) {
      // Try extending in both directions
      for (const direction of [-1, 1]) {
        const extension: { lat: number; lon: number }[] = [];
        let idx = nodeIndex + direction;
        let foundBetterPoint = false;

        // Extend up to 20 nodes in this direction
        while (idx >= 0 && idx < street.nodes.length && extension.length < 20) {
          const node = street.nodes[idx];

          const distToHQ = this.pathfindingService.haversineDistance(node.lat, node.lon, base.lat, base.lon);

          const prevPoint = extension.length > 0 ? extension[extension.length - 1] : lastPoint;
          const closestOnSeg = this.closestPointOnSegment(
            prevPoint,
            { lat: node.lat, lon: node.lon },
            { lat: base.lat, lon: base.lon }
          );
          const segDistToHQ = this.pathfindingService.haversineDistance(
            closestOnSeg.lat,
            closestOnSeg.lon,
            base.lat,
            base.lon
          );

          if (segDistToHQ < bestClosestDist || distToHQ < bestClosestDist) {
            foundBetterPoint = true;
            extension.push({ lat: node.lat, lon: node.lon });
            idx += direction;
          } else {
            break;
          }
        }

        if (foundBetterPoint && extension.length > 0) {
          let minDist = bestClosestDist;
          for (let i = 0; i < extension.length; i++) {
            const prev = i === 0 ? lastPoint : extension[i - 1];
            const curr = extension[i];
            const closest = this.closestPointOnSegment(prev, curr, {
              lat: base.lat,
              lon: base.lon,
            });
            const dist = this.pathfindingService.haversineDistance(closest.lat, closest.lon, base.lat, base.lon);
            if (dist < minDist) {
              minDist = dist;
            }
          }

          if (minDist < bestClosestDist) {
            bestClosestDist = minDist;
            bestExtension = extension;
          }
        }
      }
    }

    return [...geoPath, ...bestExtension];
  }

  /**
   * Snap spawn marker to actual path start position
   * @param spawnId Spawn point ID
   * @param lat Latitude
   * @param lon Longitude
   */
  private snapSpawnMarkerToPathStart(spawnId: string, lat: number, lon: number): void {
    if (!this.engine) return;

    const marker = this.spawnMarkers.find((m) => m.name === `spawnMarker_${spawnId}`);
    if (!marker) return;

    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);

    // Keep same Y, only update X and Z to match path start
    marker.position.x = local.x;
    marker.position.z = local.z;
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
      let corridorMin = Infinity;
      let corridorMax = -Infinity;

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
            lengthM: 0,
            maxCellAboveStreetM: null,
            at: '',
          };
          rows.push(run);
          corridorMin = Infinity;
          corridorMax = -Infinity;
        }
        run.toIndex = i + 1;

        const corridor = 2 * segmentHalfWidth(a);
        corridorMin = Math.min(corridorMin, corridor);
        corridorMax = Math.max(corridorMax, corridor);
        run.corridorM = corridorMin === corridorMax
          ? corridorMin.toFixed(1)
          : `${corridorMin.toFixed(1)}-${corridorMax.toFixed(1)}`;

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
          const streetY = engine.getGroundHeightEstimate(lat, lon, a.lat, a.lon, b.lat, b.lon);
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
    this.spawnMarkers = [];
  }

  /**
   * Subdivide a geo path so no segment is longer than maxLength meters.
   * This ensures smooth terrain following on hilly terrain.
   *
   * @param path Original geo path
   * @param maxLength Maximum segment length in meters
   * @returns Subdivided path with more points
   */
  private subdivideGeoPath(
    path: { lat: number; lon: number }[],
    maxLength: number
  ): { lat: number; lon: number }[] {
    if (path.length < 2) return path;

    const METERS_PER_DEGREE = METERS_PER_DEGREE_LAT;
    const result: { lat: number; lon: number }[] = [];

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];

      // Calculate distance
      const dLat = b.lat - a.lat;
      const dLon = b.lon - a.lon;
      const avgLat = (a.lat + b.lat) / 2;
      const dx = dLon * METERS_PER_DEGREE * Math.cos(avgLat * Math.PI / 180);
      const dy = dLat * METERS_PER_DEGREE;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Always add start point
      result.push(a);

      // Add intermediate points if segment is too long
      if (distance > maxLength) {
        const numSegments = Math.ceil(distance / maxLength);
        for (let j = 1; j < numSegments; j++) {
          const t = j / numSegments;
          result.push({
            lat: a.lat + t * dLat,
            lon: a.lon + t * dLon,
          });
        }
      }
    }

    // Add final point
    result.push(path[path.length - 1]);

    return result;
  }
}
