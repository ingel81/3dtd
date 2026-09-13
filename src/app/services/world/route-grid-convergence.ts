import type { GlobalRouteGridService } from './global-route-grid.service';
import type { PathAndRouteService } from './path-route.service';
import type { MarkerVisualizationService } from './marker-visualization.service';
import type { RouteAnimationService } from './route-animation.service';
import type { TowerDefenseStore } from '../../store/tower-defense.store';

/** What RouteGridConvergence needs; VisualizationFacadeService passes its services. */
export interface RouteGridConvergenceDeps {
  /** The route grid of the game state, set by the facade's initialize(); read on each call. */
  grid: () => Pick<
    GlobalRouteGridService,
    'addCellsChangedListener' | 'isTerrainRefreshActive' | 'stepTerrainHeightRefresh' | 'retryUnsampledCells'
  >;
  store: Pick<TowerDefenseStore, 'spawnPoints'>;
  pathRoute: Pick<PathAndRouteService, 'refreshRouteLines' | 'getCachedPaths'>;
  markerViz: Pick<MarkerVisualizationService, 'updateMarkerHeights'>;
  routeAnimation: Pick<RouteAnimationService, 'isRunning' | 'startAnimation'>;
  /** The loop has ended: a tile batch has settled (CorridorController.remeasure). */
  settled: () => void;
}

/**
 * Keeps the route grid and what was baked off its heights in step with
 * streaming tiles: drives the frame-budgeted terrain sweep and the retry of
 * unsampled cells after a tile load (schedule), and rebuilds route line,
 * markers and route animation when cells change (scheduleBakedHeightRefresh).
 */
export class RouteGridConvergence {
  /** Per-frame time budget (ms) for the budgeted terrain-refresh sweep.
   * ~5ms keeps frames at ~55fps while ~1300 raycasts converge over 1.5 to 2 s
   * in the background, instead of one ~900ms blocking sweep. Central tuning
   * knob: smaller = smoother but slower convergence. */
  static readonly TERRAIN_REFRESH_BUDGET_MS = 5;

  /** rAF handle of the debounced {@link scheduleBakedHeightRefresh}, cancelled in dispose(). */
  private bakedRefreshRaf: number | null = null;
  /** A refresh was requested while a budgeted sweep was in flight. */
  private bakedRefreshPending = false;
  /** Unsubscribe for the cells-changed listener, see followCells(). */
  private cellsChangedOff: (() => void) | null = null;

  private routeGridConvergenceScheduled = false;
  /** rAF handle for the convergence loop, cancelled in dispose(). */
  private routeGridConvergenceRaf: number | null = null;

  constructor(private readonly deps: RouteGridConvergenceDeps) {}

  /**
   * Rebuild the baked heights whenever cells change. This runs again on
   * every location change and the grid is a root singleton, so drop the
   * previous subscription instead of stacking a second (third, fourth…)
   * rebuild onto every emit.
   */
  followCells(): void {
    this.cellsChangedOff?.();
    this.cellsChangedOff = this.deps.grid().addCellsChangedListener(() =>
      this.scheduleBakedHeightRefresh(),
    );
  }

  /**
   * Rebuild everything that was baked off cell heights, once a streaming
   * batch has settled.
   *
   * The route line and the markers copy cell / terrain heights at build
   * time. Cells self-heal as tiles refine, but the copies did not: the only
   * thing that rebuilt them was the tile-load callback, which used to fire
   * solely when the terrain column under the HQ moved by more than 2 m.
   * Refinement out along the corridor never moves that column, so a route
   * baked during the coarse phase stayed baked: the line, the spawn marker
   * and the enemies walking that path all stuck at the height the coarse
   * tiles reported, which in a dense city is roof level.
   *
   * Driven by the grid itself now, and debounced through rAF so a burst of
   * promotions collapses into one rebuild.
   *
   * A rebuild is NOT cheap: it re-runs pathfinding per spawn, reallocates the
   * Line2 geometry and restarts the route animation (which resets its dash
   * offset). While the budgeted sweep is in flight it emits changed cells
   * every single frame, so doing this per slice would both dwarf the sweep's
   * own 5 ms budget and freeze the dash animation at offset 0 for the whole
   * sweep. Requests during a sweep are therefore coalesced into one rebuild
   * once it converges (see `schedule`).
   */
  scheduleBakedHeightRefresh(): void {
    if (this.deps.grid().isTerrainRefreshActive()) {
      this.bakedRefreshPending = true;
      return;
    }
    if (this.bakedRefreshRaf !== null) return;
    this.bakedRefreshRaf = requestAnimationFrame(() => {
      this.bakedRefreshRaf = null;
      const spawns = this.deps.store.spawnPoints();
      this.deps.pathRoute.refreshRouteLines(spawns);
      this.deps.markerViz.updateMarkerHeights();
      if (this.deps.routeAnimation.isRunning()) {
        const cachedPaths = this.deps.pathRoute.getCachedPaths();
        if (cachedPaths.size > 0) {
          this.deps.routeAnimation.startAnimation(cachedPaths, spawns);
        }
      }
    });
  }

  /**
   * Unified rAF refresh loop. Each tick first advances the frame-budgeted
   * terrain-refresh sweep (kicked off by `beginTerrainHeightRefresh` in
   * VisualizationFacadeService.onTilesLoaded); once that sweep is done it
   * falls back to `retryUnsampledCells` self-heal until convergence, i.e.
   * two consecutive frames promote zero cells, or the safety cap is hit.
   *
   * A single loop (rather than two competing rAF loops) avoids two raycast
   * passes racing each frame. The retry phase handles cells whose tile mesh
   * decodes asynchronously AFTER the budgeted sweep already passed them
   * (tile-mesh decoding is async to the tile-load-end event; cf. cases
   * 2/5/6/10/12/14 in the bug hunt).
   *
   * `MAX_FRAMES = 120` (~2s at 60fps) is purely a safety guard against
   * pathological loops; on normal hardware the loop exits within a
   * handful of frames once the engine has decoded the mesh.
   */
  schedule(): void {
    if (this.routeGridConvergenceScheduled) return;
    this.routeGridConvergenceScheduled = true;
    const MAX_FRAMES = 120;
    const grid = this.deps.grid();
    let frames = 0;
    let zeroFrames = 0;

    // The grid emits cells-changed for every slice that moved a cell, but
    // `scheduleBakedHeightRefresh` defers while the sweep is active, so the
    // whole sweep collapses into the single rebuild fired here. Same one
    // implementation, just triggered once instead of per frame.
    const finish = () => {
      this.routeGridConvergenceScheduled = false;
      if (this.bakedRefreshPending) {
        this.bakedRefreshPending = false;
        this.scheduleBakedHeightRefresh();
      }
      // The batch has settled: corridor stations that were still on coarse
      // tiles may have fine ones now (CorridorRefit.remeasure).
      this.deps.settled();
    };

    const tick = () => {
      this.routeGridConvergenceRaf = null;
      // dispose() may have torn down the engine/grid between frames.
      if (!this.routeGridConvergenceScheduled) return;
      if (frames++ >= MAX_FRAMES) {
        finish();
        return;
      }

      // Phase 1: advance the budgeted terrain-refresh sweep. While it's in
      // flight, keep ticking and skip the unsampled-retry (the sweep already
      // covers promotion + refresh for every cell).
      if (grid.isTerrainRefreshActive()) {
        grid.stepTerrainHeightRefresh(RouteGridConvergence.TERRAIN_REFRESH_BUDGET_MS);
        // The MAX_FRAMES cap guards the unsampled-retry tail only; don't let
        // it abandon an in-flight (or panning-restarted) sweep.
        frames = 0;
        zeroFrames = 0;
        this.routeGridConvergenceRaf = requestAnimationFrame(tick);
        return;
      }

      // Phase 2: self-heal cells whose mesh decoded after the sweep passed.
      const { promoted } = grid.retryUnsampledCells();
      if (promoted > 0) {
        zeroFrames = 0;
        this.routeGridConvergenceRaf = requestAnimationFrame(tick);
      } else if (zeroFrames < 1) {
        // One empty frame may just be the gap between tile-decode bursts:
        // give it one more chance before declaring convergence.
        zeroFrames++;
        this.routeGridConvergenceRaf = requestAnimationFrame(tick);
      } else {
        finish();
      }
    };
    this.routeGridConvergenceRaf = requestAnimationFrame(tick);
  }

  /**
   * Drop the cells listener, stop the loop, cancel a baked refresh waiting
   * for its frame and forget one the sweep held back.
   */
  dispose(): void {
    this.cellsChangedOff?.();
    this.cellsChangedOff = null;
    if (this.routeGridConvergenceRaf !== null) {
      cancelAnimationFrame(this.routeGridConvergenceRaf);
      this.routeGridConvergenceRaf = null;
    }
    if (this.bakedRefreshRaf !== null) {
      cancelAnimationFrame(this.bakedRefreshRaf);
      this.bakedRefreshRaf = null;
    }
    this.routeGridConvergenceScheduled = false;
    this.bakedRefreshPending = false;
  }
}
