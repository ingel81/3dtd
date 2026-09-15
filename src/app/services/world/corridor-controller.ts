import { CorridorRefit } from './corridor-refit';
import type { PathAndRouteService } from './path-route.service';
import type { RouteAnimationService } from './route-animation.service';
import type { IntroCameraFlightService } from './intro-camera-flight.service';
import { MEASURING_STEP, type RelocationStatusService } from './relocation-status.service';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { TowerDefenseStore } from '../../store/tower-defense.store';
import type { GameStateManager } from '../../managers/game-state.manager';
import { corridorTrace, widthProfile, type CorridorSnapshot } from '../../utils/corridor-trace';

/** What CorridorController needs; VisualizationFacadeService passes its services. */
export interface CorridorControllerDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<
    GameStateManager,
    'towerCount' | 'enemyManager' | 'waveManager' | 'getGlobalRouteGrid' | 'initializeGlobalRouteGrid' | 'setBeforeCorridorLock'
  >;
  engineInit: Pick<EngineInitializationService, 'getEngine'>;
  introFlight: Pick<IntroCameraFlightService, 'isRunning'>;
  pathRoute: Pick<
    PathAndRouteService,
    | 'beginClearanceMeasurement' | 'hasUnmeasuredStations' | 'hasUnwalkableCells' | 'narrowToWalkable'
    | 'clearCorridorMeasurements' | 'refreshRouteLines' | 'getCachedPaths'
  >;
  routeAnimation: Pick<RouteAnimationService, 'isRunning' | 'startAnimation'>;
  store: Pick<TowerDefenseStore, 'spawnPoints'>;
  /** The hint while the HQ moves: the player waits for the measurement while it shows it (MEASURING_STEP). */
  relocationStatus: Pick<RelocationStatusService, 'status'>;
}

/**
 * When the route corridor is measured and routes and cells are rebuilt
 * with it: after the height update
 * (VisualizationFacadeService.scheduleOverlayHeightUpdate), after each
 * settled tile batch (RouteGridConvergence) and from `__corridor.set()` /
 * `reset()`. The rules live in CorridorRefit, which measures a slice per
 * animation frame, like the terrain sweep; this class wires it to the game
 * and rebuilds.
 */
export class CorridorController {
  /**
   * Builds a rebuild adds at most to drop cells an enemy could not walk to
   * (rebuildCorridors). One is the rule: the second build rarely finds new
   * ones; what is left waits for the next remeasure.
   */
  static readonly MAX_WALK_PASSES = 2;

  private readonly refit: CorridorRefit;

  /** The flush hook is set on the game state, see attach(). */
  private attached = false;

  constructor(private readonly deps: CorridorControllerDeps) {
    this.refit = new CorridorRefit({
      ready: () => deps.engineInit.getEngine() !== null,
      towerCount: () => deps.gameState().towerCount(),
      enemyCount: () => deps.gameState().enemyManager.getAliveCount(),
      waveRunning: () => deps.gameState().waveManager.phase() === 'wave',
      introRunning: () => deps.introFlight.isRunning(),
      // Only the measurement of the routes a move in place built. Not under
      // "Loading streets" before a move outside the streets: a run then
      // measures the old routes, and the location change drops its result.
      hurried: () => deps.relocationStatus.status()?.step === MEASURING_STEP,
      beginMeasurement: () => deps.pathRoute.beginClearanceMeasurement(),
      // Or cells a finer tile showed no enemy could walk to: the commit of
      // the (then empty) run drops them. The walk check looks at every cell,
      // so not while a blocker holds the corridor anyway.
      hasUnmeasured: () => deps.pathRoute.hasUnmeasuredStations()
        || (this.refit.rebuildBlocker() === null && deps.pathRoute.hasUnwalkableCells()),
      clearMeasurements: () => deps.pathRoute.clearCorridorMeasurements(),
      rebuild: () => this.rebuildCorridors(),
      cellCount: () => deps.gameState().getGlobalRouteGrid().getStats().totalCells,
      now: () => performance.now(),
      eachFrame: (tick) => {
        let frame = 0;
        const step = () => {
          if (tick()) frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        return () => cancelAnimationFrame(frame);
      },
      after: (ms, callback) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
      },
    });
  }

  /**
   * A tower or a wave freezes the corridor: a measurement still under way
   * finishes first instead of being dropped (CorridorRefit.flush).
   */
  attach(): void {
    this.deps.gameState().setBeforeCorridorLock((reason) => corridorTrace.within(`refit.flush ${reason}`, () => this.refit.flush(reason)));
    this.attached = true;
  }

  /** See CorridorRefit.fitToTiles. */
  fitToTiles(): void {
    corridorTrace.within('refit.fitToTiles', () => this.refit.fitToTiles());
  }

  /** See CorridorRefit.remeasure. */
  remeasure(): void {
    corridorTrace.within('refit.remeasure', () => this.refit.remeasure());
  }

  /** See CorridorRefit.change. */
  change(apply: () => string[]): string {
    return corridorTrace.within('refit.change', () => this.refit.change(apply));
  }

  /** Take the flush hook back and drop a measurement under way. */
  dispose(): void {
    if (this.attached) this.deps.gameState().setBeforeCorridorLock(null);
    this.attached = false;
    this.refit.dispose();
  }

  /**
   * Rebuild the routes with the corridor widths as measured and configured
   * now, their cells and the route line, all in one frame. Logs how long
   * each part took (`[Corridor] rebuild:`): routes (pathfinding, corridor
   * fit, route line), grid (the cells and their first sample), heights (the
   * full terrain sweep), walk (routes, cells and heights again, `narrowed`
   * times, short of the cells an enemy could not walk to), lines
   * (pathfinding and route line again, on the new cells' heights) and
   * overlays (debug layers, route animation).
   */
  private rebuildCorridors(): void {
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
    this.deps.pathRoute.refreshRouteLines(spawns);
    const tRoutes = performance.now();
    grid.clear();
    gameState.initializeGlobalRouteGrid();
    const tGrid = performance.now();
    grid.updateTerrainHeights();
    const tHeights = performance.now();
    // The new cells may reach further than the last ones, onto a car or
    // under an eave: narrow the corridor short of them and build again.
    let narrowed = 0;
    while (narrowed < CorridorController.MAX_WALK_PASSES && this.deps.pathRoute.narrowToWalkable()) {
      narrowed++;
      this.deps.pathRoute.refreshRouteLines(spawns);
      grid.clear();
      gameState.initializeGlobalRouteGrid();
      grid.updateTerrainHeights();
    }
    // Out of builds: what the last one still shows waits for a remeasure,
    // which a still camera loads no tiles for.
    if (narrowed === CorridorController.MAX_WALK_PASSES) this.refit.remeasureLater();
    const tWalk = performance.now();
    this.deps.pathRoute.refreshRouteLines(spawns);
    const tLines = performance.now();
    grid.initSpatialGridVisualizationIfEnabled();
    grid.initAirSpatialGridVisualizationIfEnabled();
    grid.initAirRouteLayerIfEnabled();
    if (this.deps.routeAnimation.isRunning()) {
      this.deps.routeAnimation.startAnimation(this.deps.pathRoute.getCachedPaths(), spawns);
    }
    const tEnd = performance.now();

    const ms = (from: number, to: number) => (to - from).toFixed(1);
    console.warn(
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
  }

  /** The cells, the half widths along each route and the waypoints in use, for the corridor trace (CorridorTrace.rebuilt). */
  private snapshot(): CorridorSnapshot {
    const paths = this.deps.pathRoute.getCachedPaths();
    let waypoints = 0;
    for (const path of paths.values()) waypoints += path.length;
    return { cells: this.deps.gameState().getGlobalRouteGrid().snapshotHeights(), widths: widthProfile(paths), waypoints };
  }
}
