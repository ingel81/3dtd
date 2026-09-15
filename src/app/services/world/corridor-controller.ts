import { CorridorRefit } from './corridor-refit';
import { CorridorBuild } from './corridor-build';
import type { PathAndRouteService } from './path-route.service';
import type { RouteAnimationService } from './route-animation.service';
import type { IntroCameraFlightService } from './intro-camera-flight.service';
import { MEASURING_STEP, type RelocationStatusService } from './relocation-status.service';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { TowerDefenseStore } from '../../store/tower-defense.store';
import type { GameStateManager } from '../../managers/game-state.manager';
import { corridorTrace } from '../../utils/corridor-trace';

/** What CorridorController needs; VisualizationFacadeService passes its services. */
export interface CorridorControllerDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<
    GameStateManager,
    'towerCount' | 'enemyManager' | 'waveManager' | 'getGlobalRouteGrid' | 'rebuildRouteCells' | 'setBeforeCorridorLock'
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
 * animation frame, like the terrain sweep; this class wires it to the game,
 * and CorridorBuild rebuilds.
 */
export class CorridorController {
  private readonly refit: CorridorRefit;

  /** Routes, cells and route line, see CorridorBuild. */
  private readonly build: CorridorBuild;

  /** The flush hook is set on the game state, see attach(). */
  private attached = false;

  constructor(private readonly deps: CorridorControllerDeps) {
    this.build = new CorridorBuild(deps);
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
      // Out of builds: what the last one still shows waits for a remeasure,
      // which a still camera loads no tiles for.
      rebuild: () => {
        if (this.build.rebuild() === CorridorBuild.MAX_WALK_PASSES) this.refit.remeasureLater();
      },
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
}
