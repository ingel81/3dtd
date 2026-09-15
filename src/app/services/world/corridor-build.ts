import type { PathAndRouteService } from './path-route.service';
import type { RouteAnimationService } from './route-animation.service';
import type { TowerDefenseStore } from '../../store/tower-defense.store';
import type { GameStateManager } from '../../managers/game-state.manager';
import { corridorTrace, widthProfile, type CorridorSnapshot } from '../../utils/corridor-trace';

/** What CorridorBuild needs; CorridorController passes the facade's services. */
export interface CorridorBuildDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<GameStateManager, 'getGlobalRouteGrid' | 'rebuildRouteCells'>;
  pathRoute: Pick<PathAndRouteService, 'narrowToWalkable' | 'refreshRouteLines' | 'getCachedPaths'>;
  routeAnimation: Pick<RouteAnimationService, 'isRunning' | 'startAnimation'>;
  store: Pick<TowerDefenseStore, 'spawnPoints'>;
}

/**
 * The one writer of the route corridor: routes with their widths, walk caps
 * and detours, the cells and their heights and the route line are built
 * here and nowhere else. CorridorController decides when (CorridorRefit).
 */
export class CorridorBuild {
  /**
   * Builds a rebuild adds at most to drop cells an enemy could not walk to
   * (rebuild). One is the rule: the second build rarely finds new ones; what
   * is left waits for the next remeasure.
   */
  static readonly MAX_WALK_PASSES = 2;

  constructor(private readonly deps: CorridorBuildDeps) {}

  /**
   * Rebuild the routes with the corridor widths as measured and configured
   * now, their cells and the route line, all in one frame. Logs how long
   * each part took (`[Corridor] rebuild:`): routes (pathfinding, corridor
   * fit, route line), grid (the cells and their first sample), heights (the
   * full terrain sweep), walk (routes, cells and heights again, `narrowed`
   * times, short of the cells an enemy could not walk to), lines
   * (pathfinding and route line again, on the new cells' heights) and
   * overlays (debug layers, route animation).
   *
   * @returns the walk passes it ran, MAX_WALK_PASSES when it ran out of them
   */
  rebuild(): number {
    const trace = corridorTrace.enter('rebuild');
    const tSnapshot = performance.now();
    const before = corridorTrace.enabled ? this.snapshot() : null;
    let snapshotMs = performance.now() - tSnapshot;
    // Routes with the new widths first, then the cells built from them,
    // then the route line on the new cells' heights.
    const t0 = performance.now();
    const spawns = this.deps.store.spawnPoints();
    const gameState = this.deps.gameState();
    const grid = gameState.getGlobalRouteGrid();
    // Each step under its own label, so the corridor trace tells the route line rebuilds apart.
    corridorTrace.within('routes', () => this.deps.pathRoute.refreshRouteLines(spawns));
    const tRoutes = performance.now();
    gameState.rebuildRouteCells();
    const tGrid = performance.now();
    grid.updateTerrainHeights();
    const tHeights = performance.now();
    // The new cells may reach further than the last ones, onto a car or
    // under an eave: narrow the corridor short of them and build again.
    let narrowed = 0;
    while (narrowed < CorridorBuild.MAX_WALK_PASSES && this.deps.pathRoute.narrowToWalkable()) {
      narrowed++;
      corridorTrace.within(`walkPass ${narrowed}`, () => {
        this.deps.pathRoute.refreshRouteLines(spawns);
        gameState.rebuildRouteCells();
        grid.updateTerrainHeights();
      });
    }
    const tWalk = performance.now();
    corridorTrace.within('lines', () => this.deps.pathRoute.refreshRouteLines(spawns));
    const tLines = performance.now();
    grid.initSpatialGridVisualizationIfEnabled();
    grid.initAirSpatialGridVisualizationIfEnabled();
    grid.initAirRouteLayerIfEnabled();
    if (this.deps.routeAnimation.isRunning()) {
      this.deps.routeAnimation.startAnimation(this.deps.pathRoute.getCachedPaths(), spawns);
    }
    const tEnd = performance.now();

    const ms = (from: number, to: number) => (to - from).toFixed(1);
    console.log(
      `[Corridor] rebuild: routes=${ms(t0, tRoutes)} grid=${ms(tRoutes, tGrid)} heights=${ms(tGrid, tHeights)} ` +
      `walk=${ms(tHeights, tWalk)} narrowed=${narrowed} ` +
      `lines=${ms(tWalk, tLines)} overlays=${ms(tLines, tEnd)} total=${ms(t0, tEnd)}ms ` +
      `spawns=${spawns.length} cells=${grid.getStats().totalCells}`,
    );
    if (before) {
      const tAfter = performance.now();
      const after = this.snapshot();
      snapshotMs += performance.now() - tAfter;
      corridorTrace.rebuilt(before, after, { narrowed, spawns: spawns.length, snapshotMs }, tEnd - t0);
    }
    corridorTrace.exit(trace);
    return narrowed;
  }

  /** The cells, the half widths along each route and the waypoints in use, for the corridor trace (CorridorTrace.rebuilt). */
  private snapshot(): CorridorSnapshot {
    const paths = this.deps.pathRoute.getCachedPaths();
    let waypoints = 0;
    for (const path of paths.values()) waypoints += path.length;
    return { cells: this.deps.gameState().getGlobalRouteGrid().snapshotHeights(), widths: widthProfile(paths), waypoints };
  }
}
