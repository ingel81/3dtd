import type { GlobalRouteGridService } from '../../services/world/global-route-grid.service';
import type { WaveManager } from '../wave.manager';
import type { GeoPosition, RouteWaypoint } from '../../models/game.types';
import type { SimWorld } from '../../sim/protocol/messages';
import type { SimCoords } from '../../sim/core/sim-coords';
import { OriginSync } from '../../sim/core/sim-coords';
import { fnv1a } from '../../utils/fnv1a';

/** What the route world reads of the GameStateManager */
export interface RouteWorldHost {
  readonly grid: GlobalRouteGridService;
  readonly waveManager: WaveManager;
  readonly coords: SimCoords;
  /** New routes enter the towers' ranges elsewhere (TowerLifecycle.refreshGuardHeadings) */
  routesChanged(): void;
}

/**
 * A key of a world: the frozen cell heights (GlobalRouteGrid.snapshotHeights),
 * the routes in spawn point order and the local origin, hashed. A snapshot
 * or a replay file only re-simulates on the world with the same key
 * (docs/SIMULATOR_PLAN.md, P4); the simulation's must equal the main
 * thread's (SimWorld.worldKey). Walks every cell, a few ms: not per frame.
 */
export function routeWorldKey(
  heights: ReadonlyMap<number, number>,
  paths: Iterable<readonly GeoPosition[]>,
  origin: { lat: number; lon: number } | null,
): string {
  const sorted = [...heights].sort((a, b) => a[0] - b[0]);
  const parts: string[] = sorted.map(([key, height]) => `${key}:${height.toFixed(2)}`);
  for (const path of paths) {
    parts.push(path.map((p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`).join(';'));
  }
  if (origin) parts.push(`o=${origin.lat.toFixed(7)},${origin.lon.toFixed(7)}`);
  return fnv1a(parts.join('|'));
}

/**
 * The world the simulation runs on (docs/SIM_WORKER.md, "Welt"): the routes
 * and the route grid's cells as the main thread froze them (SimWorld). The
 * cells are generated from the routes and take the world's heights; nothing
 * is sampled, there are no tiles.
 */
export class RouteWorld {
  private paths = new Map<string, RouteWaypoint[]>();

  constructor(private readonly host: RouteWorldHost) {}

  /** The enemy routes by spawn point id, in the world's order */
  cachedPaths(): Map<string, RouteWaypoint[]> {
    return this.paths;
  }

  /** The enemy routes in use */
  routes(): RouteWaypoint[][] {
    return Array.from(this.paths.values());
  }

  /**
   * Stand on `world`: its frame (SimCoords), its routes, the grid's cells
   * generated from them with the world's heights. Throws when the heights
   * name cells the routes do not make.
   */
  load(world: SimWorld): void {
    const { grid, coords } = this.host;
    coords.use(new OriginSync(world.origin.lat, world.origin.lon, world.origin.height ?? 0));
    this.paths = new Map(world.paths);
    grid.clear();
    // No sampler: every cell's height comes from the world (restoreHeights)
    grid.initialize(() => null, coords.sync);
    const routes = this.routes();
    if (routes.length > 0) grid.generateFromRoutes(routes);
    const missing = grid.restoreHeights(world.heights);
    if (missing.length > 0) throw new Error(`SimWorld: ${missing.length} cell heights with no cell of the routes`);
    this.host.routesChanged();
  }

  /**
   * A frame and routes a spec built itself (integration/sim-world.ts): the
   * grid stands already, only the routes are taken.
   */
  adopt(paths: Map<string, RouteWaypoint[]>): void {
    this.paths = paths;
    this.host.routesChanged();
  }

  /** The key of the world the simulation stands on, see routeWorldKey */
  key(): string {
    const origin = this.host.coords.ready ? this.host.coords.sync.getOrigin() : null;
    return routeWorldKey(this.host.grid.snapshotHeights(), this.host.waveManager.getPaths(), origin);
  }
}
