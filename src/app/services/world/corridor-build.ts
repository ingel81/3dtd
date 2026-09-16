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
  /** Stations of the walkable band over all routes, and the stretches of them run as a passage. */
  bandStations: number;
  passages: number;
  /** The tiles did not settle within TILES_TIMEOUT_MS: the build took what had come. */
  timedOut: boolean;
  /** Stations and cells the finest level had no column for and the fallback level had. */
  fallbackStations: number;
  fallbackCells: number;
  cells: number;
  /** Cells that still have no height of their own at the freeze, the fallback level included. */
  cellsWithoutHeight: number;
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
    | 'beginClearanceMeasurement' | 'unmeasuredStations' | 'buildBands'
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
 * The one owner of the route corridor: the walkable band of every route
 * with the enemies' line in it, the cells and their heights and the route
 * line are built here and nowhere else, once per route set, and then stay
 * as they are.
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
 * 4. The walkable band of every route on these columns (buildBands), then
 *    the routes in it and their cells. One pass: the band reads the frozen
 *    columns, not the cells.
 * 5. Cells without a height: the coarse level for them. No way back:
 *    what follows reads the cells, not the columns.
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

  /** Bumped by expect() and dispose(): a build from before stops at its next frame. */
  private generation = 0;
  /** The build expected or running; null when the corridor is frozen. */
  private active: number | null = null;
  /** The build past its start, until it freezes or stops; see unmute(). */
  private running: number | null = null;
  /** The camera's error target while a build has it muted, see mute(). */
  private muted: { tiles: TilesLodDebug; camera: number } | null = null;
  /** The last build froze without measuring anything, see frozeBlind(). */
  private blind = false;

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
   *
   * Every build cycle starts here, build() included, so this is where the
   * blind flag is dropped: it describes the build that froze last, and a new
   * cycle has not frozen anything yet. Without that it outlived a location,
   * because this class is a singleton and dispose() only runs when the app
   * shuts down: a blind location, then one whose build stops early (routes
   * replaced), and the next visibility change rebuilt a corridor that had
   * measured fine (review-corridor.md).
   */
  expect(): number {
    this.blind = false;
    this.active = ++this.generation;
    return this.active;
  }

  /**
   * The corridor in use came out of a build that measured on nothing: no
   * station had a tile, or no cell got a height. It then holds the street
   * widths from OSM, and since nothing re-measures after a freeze, only
   * another build gets it out of that. VisualizationFacadeService runs one
   * when the page becomes visible again: a location that loads in a hidden
   * tab loads no tiles at all, because the browser stops rAF and the
   * renderer never traverses.
   *
   * Always about the build cycle running now: expect() drops it, and only a
   * freeze sets it. A build that stops early therefore leaves it false, not
   * whatever an earlier location left behind.
   */
  frozeBlind(): boolean {
    return this.blind;
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
    const ms = { tiles: 0, measure: 0, fallback: 0, build: 0, lines: 0 };
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
        }), true);
        if (!reached) {
          dropped();
          return null;
        }
        ms.fallback += this.now() - t;
        fallbackStations = missing - pathRoute.unmeasuredStations();
        traced(() => corridorTrace.log('build.fallback', { what: 'stations', missing, found: fallbackStations }));
      }

      // 4. The band of every route on these columns, then routes and cells.
      const spawns = this.deps.store.spawnPoints();
      const gameState = this.deps.gameState();
      const grid = gameState.getGlobalRouteGrid();
      const before = corridorTrace.enabled ? this.snapshot() : null;
      report({ step: BUILD_STEP, percent: null });
      const t0 = this.now();
      const band = traced(() => corridorTrace.within('band', () => {
        // The band is looked for along the street's own line, so the routes stand there first.
        pathRoute.refreshRouteLines(spawns);
        return pathRoute.buildBands();
      }));
      traced(() => corridorTrace.within('build', () => {
        pathRoute.refreshRouteLines(spawns);
        gameState.rebuildRouteCells();
      }));
      ms.build = this.now() - t0;
      traced(() => {
        corridorTrace.log('build.band', { ...band, cells: grid.getStats().totalCells, ms: ms.build });
        corridorTrace.cost('build.band', ms.build);
      });
      if (dropped()) return null;

      // 5. Cells the finest level gave no height of their own: the fallback level.
      let fallbackCells = 0;
      const bare = grid.cellsWithoutHeight();
      if (tiles && engine && bare > 0) {
        const { why } = grid.describeCellsWithoutHeight();
        const t = this.now();
        const reached = await this.onFallbackLevel(tiles, engine, report, stopped, () => traced(() => {
          fallbackCells = grid.retryUnsampledCells().promoted;
        }), false);
        if (!reached) {
          dropped();
          return null;
        }
        ms.fallback += this.now() - t;
        traced(() => corridorTrace.log('build.fallback', { what: 'cells', missing: bare, found: fallbackCells, why }));
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
        bandStations: band.stations,
        passages: band.passages,
        timedOut,
        fallbackStations,
        fallbackCells,
        cells: grid.getStats().totalCells,
        cellsWithoutHeight: grid.cellsWithoutHeight(),
        ms: this.now() - start,
      };
      const f = (value: number) => value.toFixed(1);
      console.log(
        `[Corridor] build: reason=${reason} tiles=${f(ms.tiles)} measure=${f(ms.measure)} fallback=${f(ms.fallback)} ` +
        `band=${band.stations} (${f(ms.build)}) lines=${f(ms.lines)} wall=${f(result.ms)}ms stations=${measured} ` +
        `unmeasured=${result.unmeasured} cells=${result.cells}${timedOut ? ' tiles timed out' : ''}`,
      );
      // Built on nothing: no station had a tile, or no cell got a height.
      // Not a note, the corridor freezes like this until the next build, so
      // every route keeps the width its OSM tags gave it.
      const blindStations = measured > 0 && result.unmeasured === measured;
      const blindCells = result.cells > 0 && result.cellsWithoutHeight === result.cells;
      this.blind = blindStations || blindCells;
      if (this.blind) {
        const settled = timedOut ? ', and the tiles never settled' : '';
        const what = blindStations
          ? `no station found a tile (${measured} stations${settled})`
          : `no cell got a height (${result.cells} cells${settled})`;
        console.warn(
          `[Corridor] build: ${what}. The corridor keeps the street widths from OSM until the next build; ` +
          'it builds again by itself when the page becomes visible, and a reload or a move of the HQ builds it too.',
        );
        traced(() => corridorTrace.log('build.notiles', {
          stations: measured, unmeasured: result.unmeasured, cells: result.cells,
          bare: result.cellsWithoutHeight, timedOut,
        }));
      }
      traced(() => {
        if (before) corridorTrace.rebuilt(before, this.snapshot(), { bands: band.routes, spawns: spawns.length }, ms.build + ms.lines);
        // Cells still without a height: why, and where the first of them stand.
        const bareCells = result.cellsWithoutHeight > 0 ? grid.describeCellsWithoutHeight() : {};
        corridorTrace.log('build.freeze', {
          ...result, ...bareCells, tilesMs: ms.tiles, measureMs: ms.measure, fallbackMs: ms.fallback, buildMs: ms.build,
        });
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
    this.blind = false;
    this.unmute();
  }

  /**
   * Switch the region to the fallback level, run `work` on its tiles, and
   * with `back` return to the finest level; the column cache emptied after
   * each switch. False when the build stopped meanwhile.
   *
   * `back` for the stations, whose band and cells measure on the finest
   * level after them. Not for the cells: the route line and the overlays
   * after them read the cells (the line reads the column at the HQ only for
   * a point with no cell height around it), and the freeze hands the region
   * to this level anyway (unmute). The way back waited at least
   * QUIET_MS for tiles no one measured on; a whole fallback took 1036 to
   * 1087 ms in Rothenburg, Berlin and Paris (2026-09-16).
   *
   * With `back`, a stop or a throw on the fallback level still hands the
   * region back at the finest level, so the level does not depend on what the
   * build does after it (unmute).
   */
  private async onFallbackLevel(
    tiles: TilesLodDebug,
    engine: BuildEngine,
    report: (progress: CorridorProgress) => void,
    stopped: () => string | null,
    work: () => void,
    back: boolean,
  ): Promise<boolean> {
    report({ step: FALLBACK_STEP, percent: null });
    const stop = () => stopped() !== null;
    tiles.setRegionErrorTarget(ROUTE_CORRIDOR_COARSE_ERROR_TARGET);
    // Only a stop owes the way back; on the way through it is set once, below.
    let owed = back;
    try {
      await waitForQuietTiles(tiles, CorridorBuild.FALLBACK_TIMEOUT_MS, this.nextFrame, this.now, { stop });
      if (stop()) return false;
      engine.terrain.clearHeightCache();
      work();
      if (!back) return true;
      owed = false;
      tiles.setRegionErrorTarget(ROUTE_CORRIDOR_ERROR_TARGET);
      await waitForQuietTiles(tiles, CorridorBuild.FALLBACK_TIMEOUT_MS, this.nextFrame, this.now, { stop });
      if (stop()) return false;
      engine.terrain.clearHeightCache();
      return true;
    } finally {
      if (owed) tiles.setRegionErrorTarget(ROUTE_CORRIDOR_ERROR_TARGET);
    }
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
