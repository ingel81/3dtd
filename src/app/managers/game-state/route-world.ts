import type { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import type { PathAndRouteService } from '../../services/world/path-route.service';
import type { WaveManager } from '../wave.manager';
import type { ThreeTilesEngine } from '../../three-engine';
import type { GeoPosition, RouteWaypoint } from '../../models/game.types';
import type { WorldSource } from '../../coop/world-package';
import { raycastStats } from '../../utils/raycast-stats';
import { fnv1a } from '../../utils/fnv1a';

/** What the route world reads of the GameStateManager */
export interface RouteWorldHost {
  readonly grid: GlobalRouteGridService;
  readonly pathRoutes: PathAndRouteService;
  readonly waveManager: WaveManager;
  engine(): ThreeTilesEngine | null;
  /** The HQ, null before the world stands */
  basePosition(): GeoPosition | null;
  /** New routes enter the towers' ranges elsewhere (TowerLifecycle.refreshGuardHeadings) */
  routesChanged(): void;
}

/**
 * The world the GameStateManager simulates on: the route grid's cells built
 * from the routes in use, the world's key and the package a coop host sends.
 */
export class RouteWorld {
  constructor(private readonly host: RouteWorldHost) {}

  /** The enemy routes in use, for LOS preview during tower placement */
  routes(): RouteWaypoint[][] {
    return Array.from(this.host.pathRoutes.getCachedPaths().values());
  }

  /**
   * The cells of the routes in use built again from nothing, without setting
   * the tile region anew: the corridor build (CorridorBuild) narrows the
   * routes pass by pass, and the tiles it measures on stay the ones of the
   * street routes the location was loaded with.
   */
  rebuildCells(): void {
    this.host.grid.clear();
    this.buildCells(false);
  }

  /** Initialize the grid and generate the cells of the routes in use; with `region`, set the tile region to them as well. */
  buildCells(region: boolean): void {
    const engine = this.host.engine();
    if (!engine) {
      console.warn('[GameStateManager] Cannot initialize GlobalRouteGrid - no engine');
      return;
    }

    // One terrain probe for the grid: ground plus the tile LOD it came from,
    // which `sampleCellY` uses so a coarse streaming pass cannot overwrite a
    // finer sample. The engine caches per column, so repeated cells are free.
    // Its rays are booked as routeGrid (`__raycastStats()`).
    const columnSampler = (x: number, z: number) => {
      const scope = raycastStats.enter('routeGrid');
      try {
        return engine.terrain.sampleColumn(x, z);
      } finally {
        raycastStats.exit(scope);
      }
    };
    // Cheap LOD-probe used by the route-grid full-sweep to skip stable
    // cells whose tile-LOD has not improved (Option C, perf/route-grid-
    // tile-aware-update).
    const terrainPeekLOD = (x: number, z: number) => engine.terrain.peekBestTileLODAtLocal(x, z);
    this.host.grid.initialize(columnSampler, engine.sync, terrainPeekLOD);

    // Generate cells from routes
    const routes = this.routes();
    // Fine tiles along the whole corridor, so the cells sample real ground
    // even where the camera does not look.
    if (region) engine.setRouteCorridor(routes);
    if (routes.length > 0) {
      this.host.grid.generateFromRoutes(routes);
    }

    this.host.routesChanged();
  }

  /** Defense reach percent of the routes in use, see GlobalRouteGridService.getDefenseReachPercent */
  defenseReachPercent(): number {
    return this.host.grid.getDefenseReachPercent(this.routes());
  }

  /**
   * A key of the world the simulation runs on: the frozen cell heights, the
   * routes and the local origin, hashed. A snapshot or a replay file only
   * re-simulates on the world with the same key (docs/SIMULATOR_PLAN.md,
   * P4). Walks every cell, a few ms: for export and import, not per frame.
   */
  key(): string {
    const heights = [...this.host.grid.snapshotHeights()].sort((a, b) => a[0] - b[0]);
    const parts: string[] = heights.map(([key, height]) => `${key}:${height.toFixed(2)}`);
    for (const path of this.host.waveManager.getPaths()) {
      parts.push(path.map((p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`).join(';'));
    }
    const origin = this.host.engine()?.sync.getOrigin();
    if (origin) parts.push(`o=${origin.lat.toFixed(7)},${origin.lon.toFixed(7)}`);
    return fnv1a(parts.join('|'));
  }

  /**
   * The finished world as a coop host packs it (coop/world-package.ts): HQ,
   * spawns, the routes as the corridor build left them, the cells' heights
   * and the world key. Null before the world stands. Walks every cell.
   */
  source(): WorldSource | null {
    const origin = this.host.engine()?.sync.getOrigin();
    const hq = this.host.basePosition();
    if (!origin || !hq) return null;
    return {
      origin: { lat: origin.lat, lon: origin.lon, height: origin.height },
      hq,
      spawns: this.host.waveManager.spawnPoints,
      paths: this.host.pathRoutes.getCachedPaths(),
      heights: this.host.grid.exportHeights(),
      worldKey: this.key(),
    };
  }
}
