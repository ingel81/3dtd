import { MEASUREMENT_KEYS, corridorConfig } from '../../utils/route-corridor';

/**
 * A measurement of the corridor clearance under way
 * (PathAndRouteService.beginClearanceMeasurement). The corridor in use stays
 * as it was until commit().
 */
export interface CorridorMeasurement {
  /** Neither committed nor cancelled yet. */
  readonly open: boolean;
  /**
   * Measure stations for up to about `budgetMs`, at least one. True once
   * none is left, or when the run is closed.
   */
  step(budgetMs: number): boolean;
  /**
   * Store what was measured; true when that changes a corridor. False for a
   * closed run. `flushedBy` marks a run finished in one go before a tower or
   * a wave (CorridorRefit.flush), for the log.
   */
  commit(flushedBy?: string): boolean;
  /** Drop the run and what it measured; `reason` goes to the log. */
  cancel(reason: string): void;
}

/** What CorridorRefit needs from the game; CorridorController wires it. */
export interface CorridorRefitHost {
  /** A location is loaded: there are routes and cells to rebuild. */
  ready(): boolean;
  towerCount(): number;
  enemyCount(): number;
  waveRunning(): boolean;
  /** The intro camera flight is running. */
  introRunning(): boolean;
  /** Start measuring the stations without a measurement (PathAndRouteService.beginClearanceMeasurement). */
  beginMeasurement(): CorridorMeasurement;
  /** Stations waiting for finer tiles (PathAndRouteService.hasUnmeasuredStations). */
  hasUnmeasured(): boolean;
  /** Forget every measurement, so the next one takes all stations again. */
  clearMeasurements(): void;
  /** Rebuild routes, cells and route line with the corridor as measured and configured now. */
  rebuild(): void;
  /** Cells in the grid, for the console. */
  cellCount(): number;
  /** Monotonic clock, ms. */
  now(): number;
  /** Call `tick` once per frame for as long as it returns true; the function returned stops it. */
  eachFrame(tick: () => boolean): () => void;
  /** Call `callback` once, `ms` from now; the function returned cancels it. */
  after(ms: number, callback: () => void): () => void;
}

/**
 * When the route corridor is fitted to the tiles and routes and cells are
 * rebuilt with it:
 *
 * - `fitToTiles`: once per location, when the height update has stopped.
 * - `remeasure`: whenever a tile-load batch has settled, for the stations
 *   that were still on coarse tiles, at most every REMEASURE_INTERVAL_MS
 *   and not during the intro flight.
 * - `change`: `__corridor.set()` / `reset()`, measuring again first when
 *   the change moves the stations or the rays.
 *
 * None of them runs while towers stand, enemies walk or a wave runs:
 * towers keep their LOS answers in the cells a rebuild replaces, enemies
 * their cell and their route.
 *
 * `fitToTiles` and `remeasure` measure in slices of MEASURE_BUDGET_MS, one
 * per frame, instead of blocking the main thread for the whole run. Routes
 * and cells keep the corridor they have until the run is done; then it is
 * stored and, where it changes a corridor, rebuilt in the same frame. A
 * tower or a wave about to arrive finishes the run first (flush), enemies
 * that turn up (debug panel) cancel it, so none of them meets a
 * half-measured corridor.
 */
export class CorridorRefit {
  /** Shortest time between two re-measurements after tile loads. */
  static readonly REMEASURE_INTERVAL_MS = 3000;

  /**
   * Main-thread time per frame for the measurement. A station (a column and
   * four rays) cost about 1.7 ms in the city-centre playtest of 2026-09-12
   * (533 ms for 316 stations): two stations a frame there. Below the 5 ms of
   * the terrain sweep (VisualizationFacadeService.TERRAIN_REFRESH_BUDGET_MS),
   * which runs in the same frames after a tile load, so both together stay
   * under 10 ms of a 16.7 ms frame. Nothing waits for the run, the corridor
   * in use holds until it is done.
   */
  static readonly MEASURE_BUDGET_MS = 4;

  /** When `remeasure` last measured, `now()` ms. */
  private lastRemeasure = -Infinity;

  /** The measurement under way and what stops its frames. */
  private running: { measurement: CorridorMeasurement; stop: () => void } | null = null;

  /** Cancels the call of `remeasure` it waits for, see retryRemeasure. */
  private pendingRetry: (() => void) | null = null;

  constructor(private readonly host: CorridorRefitHost) {}

  /** Why routes and cells must not be rebuilt now, null if they may. */
  rebuildBlocker(): string | null {
    if (this.host.towerCount() > 0) return 'towers stand on the map, sell them first';
    if (this.host.waveRunning()) return 'a wave is running';
    if (this.host.enemyCount() > 0) return 'enemies are on the map';
    return null;
  }

  /**
   * Measure the free space along every route and rebuild where it gives
   * other widths than before. The first slice runs right away, the rest in
   * the following frames; a run already under way is left to finish.
   */
  fitToTiles(): void {
    if (this.running?.measurement.open) return;
    // A run the routes replaced (PathAndRouteService cancelled it).
    this.running?.stop();
    this.running = null;
    if (this.rebuildBlocker()) return;

    const measurement = this.host.beginMeasurement();
    const slice = (): boolean => {
      const blocker = this.rebuildBlocker();
      if (!blocker && !measurement.step(CorridorRefit.MEASURE_BUDGET_MS)) return true;
      if (this.running?.measurement === measurement) this.running = null;
      if (blocker) measurement.cancel(blocker);
      else if (measurement.commit()) this.host.rebuild();
      return false;
    };
    if (slice()) this.running = { measurement, stop: this.host.eachFrame(slice) };
  }

  /**
   * Measure again the stations that had no fine tile at the last run and
   * rebuild where that changes the corridor. The first measurement does not
   * wait for the corridor tiles, which keep streaming in after it.
   *
   * Held back by the intro flight, a run under way or the interval, it
   * calls itself again later: the last tile batch often settles right then
   * (the intro flight streams the corridor), and nothing else would call it
   * before the camera loads new tiles. Not under a tower, an enemy or a
   * wave: the corridor stays as it is while they are there.
   */
  remeasure(): void {
    if (!this.host.hasUnmeasured()) return;
    if (this.rebuildBlocker()) return;
    const now = this.host.now();
    const wait = this.running?.measurement.open || this.host.introRunning()
      ? CorridorRefit.REMEASURE_INTERVAL_MS
      : this.lastRemeasure + CorridorRefit.REMEASURE_INTERVAL_MS - now;
    if (wait > 0) {
      this.retryRemeasure(wait);
      return;
    }
    this.lastRemeasure = now;
    this.fitToTiles();
  }

  /**
   * Apply a change of the corridor settings and rebuild with it. Measures
   * again first when the change moves the stations or what the rays see
   * (MEASUREMENT_KEYS); the other settings only reshape what was measured.
   * Measures in one go: the console waits for the answer.
   *
   * @param apply Changes `corridorConfig`, returns the problems that kept it from doing so
   * @returns what happened, for the console
   */
  change(apply: () => string[]): string {
    if (!this.host.ready()) return 'Not changed: no location loaded.';
    const blocker = this.rebuildBlocker();
    if (blocker) return `Not changed: ${blocker}.`;

    const before = { ...corridorConfig };
    const problems = apply();
    if (problems.length > 0) return `Not changed: ${problems.join('; ')}.`;

    // A run under way took its stations and rays from the old settings.
    this.cancel('settings changed');
    const remeasure = MEASUREMENT_KEYS.some((key) => before[key] !== corridorConfig[key]);
    if (remeasure) this.host.clearMeasurements();
    const measurement = this.host.beginMeasurement();
    measurement.step(Infinity);
    measurement.commit();
    this.host.rebuild();
    return `Corridor rebuilt${remeasure ? ', measured again' : ''}: ${this.host.cellCount()} cells. Widths per stretch: __routes.describe()`;
  }

  /**
   * Finish the measurement under way right now, before a tower is placed or
   * a wave starts (GameStateManager.setBeforeCorridorLock). Either freezes
   * the corridor; cancelling the run would leave the location at the street
   * widths. The rest of the run is measured in one go, stored and rebuilt
   * as usual, so at worst this is the one hitch of the old one-shot run. A
   * blocker that is already there (enemies from the debug panel) cancels the
   * run instead.
   *
   * @param reason What is about to freeze the corridor, for the log (`flushed=`)
   */
  flush(reason: string): void {
    const running = this.running;
    if (!running?.measurement.open) return;
    this.running = null;
    running.stop();
    const blocker = this.rebuildBlocker();
    if (blocker) {
      running.measurement.cancel(blocker);
      return;
    }
    running.measurement.step(Infinity);
    if (running.measurement.commit(reason)) this.host.rebuild();
  }

  /** Stop for good, from CorridorController.dispose(). */
  dispose(): void {
    this.pendingRetry?.();
    this.pendingRetry = null;
    this.cancel('disposed');
  }

  /** Call remeasure again in `ms`; one call waits at a time. */
  private retryRemeasure(ms: number): void {
    if (this.pendingRetry) return;
    this.pendingRetry = this.host.after(ms, () => {
      this.pendingRetry = null;
      this.remeasure();
    });
  }

  /** Drop the measurement under way; the corridor stays as it was. */
  private cancel(reason: string): void {
    const running = this.running;
    if (!running) return;
    this.running = null;
    running.stop();
    running.measurement.cancel(reason);
  }
}
