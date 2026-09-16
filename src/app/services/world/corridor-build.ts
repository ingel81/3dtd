import { MEASUREMENT_KEYS, corridorConfig } from '../../utils/route-corridor';
import { corridorTrace, widthProfile, type CorridorSnapshot } from '../../utils/corridor-trace';
import {
  MUTED_CAMERA_ERROR_TARGET,
  nextFrameOrTimeout,
  waitForQuietTiles,
  type TilesLodDebug,
} from '../../three-engine/tiles-lod-debug';
import { ROUTE_CORRIDOR_COARSE_ERROR_TARGET, ROUTE_CORRIDOR_ERROR_TARGET } from '../../three-engine/route-corridor-region';
import type { PathAndRouteService } from './path-route.service';
import type { RouteAnimationService } from './route-animation.service';
import type { EngineInitializationService } from '../infrastructure/engine-initialization.service';
import type { TowerDefenseStore } from '../../store/tower-defense.store';
import type { GameStateManager } from '../../managers/game-state.manager';

/**
 * A measurement of the corridor clearance under way
 * (PathAndRouteService.beginClearanceMeasurement). The corridor in use stays
 * as it was until commit().
 */
export interface CorridorMeasurement {
  /** Neither committed nor cancelled yet. */
  readonly open: boolean;
  /** Stations tried so far and the stations the run set out to measure. */
  readonly progress: { done: number; total: number };
  /**
   * Measure stations for up to about `budgetMs`, at least one. True once
   * none is left, or when the run is closed.
   */
  step(budgetMs: number): boolean;
  /** Store what was measured; true when that changes a corridor. False for a closed run. */
  commit(): boolean;
  /** Drop the run and what it measured; `reason` goes to the log. */
  cancel(reason: string): void;
}

/** Where a build is, for the loading screen and the hint over the map while HQ or spawn move. */
export interface CorridorProgress {
  step: string;
  /** Share of the step done, whole percent; null where it cannot tell. */
  percent: number | null;
}

/** What a build ended with, see CorridorBuild.build. */
export interface CorridorBuildResult {
  /** Stations this build measured, the ones on the fallback level among them. */
  stations: number;
  /** Stations still without a measurement at the end: they keep the street width. */
  unmeasured: number;
  /** Builds of routes and cells until the walk check narrowed nothing more. */
  passes: number;
  /** The tiles did not settle within TILES_TIMEOUT_MS: the build took what had come. */
  timedOut: boolean;
  /** Stations and cells the finest level had no column for and the fallback level had. */
  fallbackStations: number;
  fallbackCells: number;
  cells: number;
  /** From the call to the freeze, ms. */
  ms: number;
}

/** What CorridorBuild needs; VisualizationFacadeService passes its services. */
export interface CorridorBuildDeps {
  /** The game state, set by the facade's initialize(); read on each call. */
  gameState: () => Pick<GameStateManager, 'towerCount' | 'enemyManager' | 'waveManager' | 'getGlobalRouteGrid' | 'rebuildRouteCells'>;
  engineInit: Pick<EngineInitializationService, 'getEngine'>;
  pathRoute: Pick<
    PathAndRouteService,
    | 'beginClearanceMeasurement' | 'unmeasuredStations' | 'resetWalkCaps' | 'walkState' | 'narrowToWalkable'
    | 'clearCorridorMeasurements' | 'refreshRouteLines' | 'getCachedPaths' | 'routesEpoch'
  >;
  routeAnimation: Pick<RouteAnimationService, 'isRunning' | 'startAnimation'>;
  store: Pick<TowerDefenseStore, 'spawnPoints'>;
  /** Resolves on the next frame; the default waits for rAF, in a hidden tab for a timeout. */
  nextFrame?: () => Promise<void>;
  /** Monotonic clock, ms; the default is performance.now(). */
  now?: () => number;
}

type BuildEngine = NonNullable<ReturnType<EngineInitializationService['getEngine']>>;

/** The steps of a build as the loading screen and the hint show them. */
const TILES_STEP = 'Loading the corridor tiles';
const MEASURE_STEP = 'Measuring the corridor';
const FALLBACK_STEP = 'Loading coarser tiles for the gaps';
const BUILD_STEP = 'Building the corridor';

const percentOf = ({ done, total }: { done: number; total: number }) => (total > 0 ? Math.floor((100 * done) / total) : 100);

/**
 * The one owner of the route corridor: routes with their widths, walk caps
 * and detours, the cells and their heights and the route line are built
 * here and nowhere else, once per route set, and then stay as they are.
 *
 * A build (build) runs behind the loading screen of a location load, under
 * the hint while HQ or spawn move, and for `__corridor.set()` / `reset()`:
 *
 * 1. Region to the finest level (ROUTE_CORRIDOR_ERROR_TARGET), the camera's
 *    own refinement muted, wait until the tiles are quiet (TILES_TIMEOUT_MS,
 *    then with what came).
 * 2. Every station measured once on these tiles, in slices of SLICE_MS a
 *    frame, against an emptied column cache.
 * 3. Stations without a column there: the coarse level
 *    (ROUTE_CORRIDOR_COARSE_ERROR_TARGET) for them, then back.
 * 4. Routes and cells built again and again until the walk check narrows
 *    nothing more (walk caps only narrow within a build).
 * 5. Cells without a height of their own: the fallback level for them.
 * 6. The route line on the final cells; frozen. Camera back, and the region
 *    down to the coarse level (unmute).
 *
 * Afterwards no tile load, camera move or tower changes routes, cells or
 * heights; the next build does. Towers and waves wait for it (pending),
 * `__corridor.set()` is refused under towers, a wave or enemies
 * (rebuildBlocker), as their LOS answers, cells and routes stand on the
 * corridor.
 */
export class CorridorBuild {
  /**
   * Main-thread time per frame for the measurement, ms. The loading screen or
   * the hint of a move stands and nothing else waits for the frames; the bar
   * still moves. A station cost 0.6 to 1.9 ms at the five places of 2026-09-16.
   */
  static readonly SLICE_MS = 32;

  /** Longest wait for the corridor tiles, ms; a slow connection builds with what came (`build.tiles timedOut=true`). */
  static readonly TILES_TIMEOUT_MS = 30_000;

  /** Longest wait for the tiles of each switch to the fallback level and back, ms. */
  static readonly FALLBACK_TIMEOUT_MS = 10_000;

  /**
   * Safety stop for the passes. Walk caps only narrow within a build, so
   * without a detour plan that flips back and forth (which the build tells
   * by the state repeating) it ends by itself; this is for the rest.
   */
  static readonly MAX_PASSES = 20;

  /** Bumped by expect() and dispose(): a build from before stops at its next frame. */
  private generation = 0;
  /** The build expected or running; null when the corridor is frozen. */
  private active: number | null = null;
  /** The build past its start, until it freezes or stops; see unmute(). */
  private running: number | null = null;
  /** The camera's error target while a build has it muted, see mute(). */
  private muted: { tiles: TilesLodDebug; camera: number } | null = null;

  private readonly nextFrame: () => Promise<void>;
  private readonly now: () => number;

  constructor(private readonly deps: CorridorBuildDeps) {
    this.nextFrame = deps.nextFrame ?? nextFrameOrTimeout;
    this.now = deps.now ?? (() => performance.now());
  }

  /**
   * A build is expected or running: towers and waves wait
   * (GameStateManager.corridorPending), the loading screen stays
   * (VisualizationFacadeService.checkAllLoaded).
   */
  pending(): boolean {
    return this.active !== null;
  }

  /**
   * Announce a build that begins later (after the height update of a
   * location load): pending from now on. A build still running stops. The
   * number goes to build().
   */
  expect(): number {
    this.active = ++this.generation;
    return this.active;
  }

  /** Why the corridor must not be built again now, null if it may: `__corridor.set()`. */
  rebuildBlocker(): string | null {
    const gameState = this.deps.gameState();
    if (gameState.towerCount() > 0) return 'towers stand on the map, sell them first';
    if (gameState.waveManager.phase() === 'wave') return 'a wave is running';
    if (gameState.enemyManager.getAliveCount() > 0) return 'enemies are on the map';
    return null;
  }

  /**
   * Build the corridor of the routes in use, see the class comment. Stops
   * without freezing when another build begins (`superseded`) or the routes
   * are replaced (`routes replaced`, PathAndRouteService.routesEpoch); camera
   * and region go back then as well.
   *
   * @param reason For the log and the trace
   * @param report Told each step and its percentage
   * @param ticket From expect(); without, the build announces itself
   * @returns what it built, null when it stopped before the freeze
   */
  async build(
    reason: string,
    report: (progress: CorridorProgress) => void = () => undefined,
    ticket = this.expect(),
  ): Promise<CorridorBuildResult | null> {
    if (ticket !== this.generation) return null;
    this.running = ticket;
    const { pathRoute } = this.deps;
    const epoch = pathRoute.routesEpoch();
    // The frames and the awaits run under the chain the build began under.
    const chain = corridorTrace.capture();
    const traced = <T>(fn: () => T): T => corridorTrace.within(`build ${reason}`, fn, chain);
    const stopped = (): string | null =>
      ticket !== this.generation ? 'superseded' : epoch !== pathRoute.routesEpoch() ? 'routes replaced' : null;
    const dropped = (): boolean => {
      const why = stopped();
      if (why) traced(() => corridorTrace.log('build.cancel', { reason: why }));
      return why !== null;
    };
    const start = this.now();
    const engine = this.deps.engineInit.getEngine();
    const tiles = engine?.tilesLodDebug() ?? null;
    const ms = { tiles: 0, measure: 0, fallback: 0, passes: 0, lines: 0 };
    try {
      traced(() => corridorTrace.log('build.start', { reason, tiles: tiles !== null }));

      // 1. The tiles of the region at the finest level, whatever the camera shows.
      let timedOut = false;
      if (tiles) {
        report({ step: TILES_STEP, percent: null });
        this.mute(tiles);
        tiles.setRegionErrorTarget(ROUTE_CORRIDOR_ERROR_TARGET);
        // Quiet on its own would end this wait a second after it began while
        // the region holds no tile at all: nothing is loading because nothing
        // has been asked for yet. The build would then measure on nothing and
        // freeze the OSM street widths (browser check 2026-09-16, in a
        // background tab, where rAF and with it the renderer stand still).
        // So wait for the region's first tile, and meanwhile ask the renderer
        // to traverse; without a region (null) there is nothing to wait for.
        let sawTiles = false;
        const wait = await waitForQuietTiles(tiles, CorridorBuild.TILES_TIMEOUT_MS, this.nextFrame, this.now, {
          stop: () => stopped() !== null,
          ready: () => (sawTiles ||= (engine?.routeCorridorLod()?.tiles ?? 1) > 0),
          nudge: () => tiles.requestUpdate(),
        });
        if (dropped()) return null;
        timedOut = wait.timedOut;
        ms.tiles = wait.ms;
        traced(() => corridorTrace.log('build.tiles', {
          target: ROUTE_CORRIDOR_ERROR_TARGET, loadS: wait.ms / 1000, timedOut, ...(engine?.routeCorridorLod() ?? {}),
        }));
      }

      // 2. Every station once, on these tiles only.
      engine?.terrain.clearHeightCache();
      pathRoute.resetWalkCaps();
      const run = traced(() => pathRoute.beginClearanceMeasurement());
      for (;;) {
        const t = this.now();
        const done = traced(() => run.step(CorridorBuild.SLICE_MS));
        ms.measure += this.now() - t;
        if (done) break;
        report({ step: MEASURE_STEP, percent: percentOf(run.progress) });
        await this.nextFrame();
        const why = stopped();
        if (why) {
          run.cancel(why);
          dropped();
          return null;
        }
      }
      if (dropped()) return null;
      const measured = run.progress.done;
      traced(() => run.commit());

      // 3. Stations the finest level has no column for: the fallback level.
      let fallbackStations = 0;
      const missing = pathRoute.unmeasuredStations();
      if (tiles && engine && missing > 0) {
        const t = this.now();
        const reached = await this.onFallbackLevel(tiles, engine, report, stopped, () => traced(() => {
          const retry = pathRoute.beginClearanceMeasurement();
          retry.step(Infinity);
          retry.commit();
        }));
        if (!reached) {
          dropped();
          return null;
        }
        ms.fallback += this.now() - t;
        fallbackStations = missing - pathRoute.unmeasuredStations();
        traced(() => corridorTrace.log('build.fallback', { what: 'stations', missing, found: fallbackStations }));
      }

      // 4. Routes and cells until the walk check narrows nothing more.
      const spawns = this.deps.store.spawnPoints();
      const gameState = this.deps.gameState();
      const grid = gameState.getGlobalRouteGrid();
      const before = corridorTrace.enabled ? this.snapshot() : null;
      const seen = new Set([pathRoute.walkState()]);
      let passes = 0;
      for (;;) {
        passes++;
        report({ step: BUILD_STEP, percent: null });
        const t = this.now();
        const changed = traced(() => corridorTrace.within(`pass ${passes}`, () => {
          pathRoute.refreshRouteLines(spawns);
          gameState.rebuildRouteCells();
          return pathRoute.narrowToWalkable();
        }));
        const passMs = this.now() - t;
        ms.passes += passMs;
        traced(() => {
          corridorTrace.log('build.pass', { pass: passes, changed, cells: grid.getStats().totalCells, ms: passMs });
          corridorTrace.cost('build.pass', passMs);
        });
        if (!changed) break;
        const state = pathRoute.walkState();
        const unsettled = seen.has(state) ? 'walk caps and detours came back to an earlier state'
          : passes >= CorridorBuild.MAX_PASSES ? `still narrowing after ${passes} passes`
          : null;
        seen.add(state);
        if (unsettled) {
          // The last planning still needs its routes and cells.
          traced(() => corridorTrace.within('last plan', () => {
            pathRoute.refreshRouteLines(spawns);
            gameState.rebuildRouteCells();
          }));
          console.warn(`[Corridor] build did not settle: ${unsettled}; frozen with the last plan`);
          traced(() => corridorTrace.log('build.unsettled', { passes, why: unsettled }));
          break;
        }
        await this.nextFrame();
        if (dropped()) return null;
      }

      // 5. Cells the finest level gave no height of their own: the fallback level.
      let fallbackCells = 0;
      const bare = grid.cellsWithoutHeight();
      if (tiles && engine && bare > 0) {
        const t = this.now();
        const reached = await this.onFallbackLevel(tiles, engine, report, stopped, () => traced(() => {
          fallbackCells = grid.retryUnsampledCells().promoted;
        }));
        if (!reached) {
          dropped();
          return null;
        }
        ms.fallback += this.now() - t;
        traced(() => corridorTrace.log('build.fallback', { what: 'cells', missing: bare, found: fallbackCells }));
      }

      // 6. The route line on the final cells, the overlays, the animation: frozen.
      const t = this.now();
      traced(() => corridorTrace.within('lines', () => pathRoute.refreshRouteLines(spawns)));
      grid.initSpatialGridVisualizationIfEnabled();
      grid.initAirSpatialGridVisualizationIfEnabled();
      grid.initAirRouteLayerIfEnabled();
      if (this.deps.routeAnimation.isRunning()) {
        this.deps.routeAnimation.startAnimation(pathRoute.getCachedPaths(), spawns);
      }
      ms.lines = this.now() - t;

      const result: CorridorBuildResult = {
        stations: measured,
        unmeasured: pathRoute.unmeasuredStations(),
        passes,
        timedOut,
        fallbackStations,
        fallbackCells,
        cells: grid.getStats().totalCells,
        ms: this.now() - start,
      };
      const f = (value: number) => value.toFixed(1);
      console.log(
        `[Corridor] build: reason=${reason} tiles=${f(ms.tiles)} measure=${f(ms.measure)} fallback=${f(ms.fallback)} ` +
        `passes=${passes} (${f(ms.passes)}) lines=${f(ms.lines)} wall=${f(result.ms)}ms stations=${measured} ` +
        `unmeasured=${result.unmeasured} cells=${result.cells}${timedOut ? ' tiles timed out' : ''}`,
      );
      // Not a note: the corridor is frozen like this until the next build,
      // so every route keeps the width its OSM tags gave it.
      if (measured > 0 && result.unmeasured === measured) {
        console.warn(
          `[Corridor] build: no station found a tile (${measured} stations${timedOut ? ', and the tiles never settled' : ''}). ` +
          'The corridor keeps the street widths from OSM until the next build; reload the location or move the HQ to build it again.',
        );
        traced(() => corridorTrace.log('build.notiles', { stations: measured, timedOut }));
      }
      traced(() => {
        if (before) corridorTrace.rebuilt(before, this.snapshot(), { passes, spawns: spawns.length }, ms.passes + ms.lines);
        corridorTrace.log('build.freeze', { ...result, tilesMs: ms.tiles, measureMs: ms.measure, fallbackMs: ms.fallback, passesMs: ms.passes });
      });
      return result;
    } finally {
      if (this.running === ticket) this.running = null;
      if (ticket === this.generation) this.active = null;
      // A build that runs on keeps the camera muted; between builds it refines as usual.
      if (this.running === null) this.unmute();
    }
  }

  /**
   * `__corridor.set()` and `reset()`: apply a change of the corridor settings
   * and build the corridor with it. Measures every station again first when
   * the change moves the stations or what the rays see (MEASUREMENT_KEYS);
   * the other settings only reshape what was measured.
   *
   * @param apply Changes `corridorConfig`, returns the problems that kept it from doing so
   * @returns what happened, for the console
   */
  async change(apply: () => string[]): Promise<string> {
    if (!this.deps.engineInit.getEngine()) return 'Not changed: no location loaded.';
    const blocker = this.rebuildBlocker();
    if (blocker) return `Not changed: ${blocker}.`;
    if (this.pending()) return 'Not changed: the corridor is being built.';

    const before = { ...corridorConfig };
    const problems = apply();
    if (problems.length > 0) return `Not changed: ${problems.join('; ')}.`;

    const remeasure = MEASUREMENT_KEYS.some((key) => before[key] !== corridorConfig[key]);
    corridorTrace.log('build.change', { remeasure });
    corridorTrace.noteChange(['settings']);
    if (remeasure) this.deps.pathRoute.clearCorridorMeasurements();
    const result = await corridorTrace.within('settings', () => this.build('settings changed'));
    if (!result) return 'Settings changed, the build stopped: the routes were replaced.';
    return `Corridor rebuilt${remeasure ? ', measured again' : ''}: ${result.cells} cells. Widths per stretch: __routes.describe()`;
  }

  /** Stop a build under way and give the camera its refinement back, from VisualizationFacadeService.dispose(). */
  dispose(): void {
    this.generation++;
    this.active = null;
    this.running = null;
    this.unmute();
  }

  /**
   * Switch the region to the fallback level, run `work` on its tiles, and
   * back to the finest level; the column cache emptied after each switch.
   * False when the build stopped meanwhile.
   */
  private async onFallbackLevel(
    tiles: TilesLodDebug,
    engine: BuildEngine,
    report: (progress: CorridorProgress) => void,
    stopped: () => string | null,
    work: () => void,
  ): Promise<boolean> {
    report({ step: FALLBACK_STEP, percent: null });
    const stop = () => stopped() !== null;
    tiles.setRegionErrorTarget(ROUTE_CORRIDOR_COARSE_ERROR_TARGET);
    await waitForQuietTiles(tiles, CorridorBuild.FALLBACK_TIMEOUT_MS, this.nextFrame, this.now, { stop });
    if (stop()) return false;
    engine.terrain.clearHeightCache();
    work();
    tiles.setRegionErrorTarget(ROUTE_CORRIDOR_ERROR_TARGET);
    await waitForQuietTiles(tiles, CorridorBuild.FALLBACK_TIMEOUT_MS, this.nextFrame, this.now, { stop });
    if (stop()) return false;
    engine.terrain.clearHeightCache();
    return true;
  }

  /** Mute the camera's refinement, keeping what it was: a build that follows one under way keeps the first value. */
  private mute(tiles: TilesLodDebug): void {
    this.muted ??= { tiles, camera: tiles.snapshot().cameraErrorTarget };
    tiles.setCameraErrorTarget(MUTED_CAMERA_ERROR_TARGET);
  }

  /**
   * Give the camera its refinement back and let the region rest at the
   * coarse level.
   *
   * Only a build needs the finest level, and the frozen corridor samples no
   * cell any more. The region itself stays: it is the only thing that keeps
   * corridor tiles ACTIVE while they are off screen, and the renderer
   * activates only what the camera frustum covers. Two things still depend
   * on that, long after the freeze and wherever the camera happens to look:
   * the tower LOS cubemap, which renders the tiles group from the tower tip
   * (TowerShadowMapper, on every placement, range upgrade and air retrofit),
   * and the CPU raycast fallback the combat loop takes where a cell holds no
   * answer (TerrainQueries.raycastLineOfSight). Both need geometry to be
   * there, not to be fine, so the coarse level serves them.
   *
   * Holding the finest level for the whole session instead cost 39 to
   * 166 MB of active tiles (phase 0, 2026-09-16).
   */
  private unmute(): void {
    const muted = this.muted;
    if (!muted) return;
    this.muted = null;
    muted.tiles.setCameraErrorTarget(muted.camera);
    muted.tiles.setRegionErrorTarget(ROUTE_CORRIDOR_COARSE_ERROR_TARGET);
  }

  /** The cells, the half widths along each route and the waypoints in use, for the corridor trace (CorridorTrace.rebuilt). */
  private snapshot(): CorridorSnapshot {
    const paths = this.deps.pathRoute.getCachedPaths();
    let waypoints = 0;
    for (const path of paths.values()) waypoints += path.length;
    return { cells: this.deps.gameState().getGlobalRouteGrid().snapshotHeights(), widths: widthProfile(paths), waypoints };
  }
}
