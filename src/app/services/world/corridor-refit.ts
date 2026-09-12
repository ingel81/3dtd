import { MEASUREMENT_KEYS, corridorConfig } from '../../utils/route-corridor';

/** What CorridorRefit needs from the game; VisualizationFacadeService wires it. */
export interface CorridorRefitHost {
  /** A location is loaded: there are routes and cells to rebuild. */
  ready(): boolean;
  towerCount(): number;
  enemyCount(): number;
  waveRunning(): boolean;
  /** The intro camera flight is running. */
  introRunning(): boolean;
  /**
   * Measure the stations without a measurement
   * (PathAndRouteService.measureStreetClearance); true when a corridor
   * changed.
   */
  measure(): boolean;
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
 */
export class CorridorRefit {
  /** Shortest time between two re-measurements after tile loads. */
  static readonly REMEASURE_INTERVAL_MS = 3000;

  /** When `remeasure` last measured, `now()` ms. */
  private lastRemeasure = -Infinity;

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
   * other widths than before.
   *
   * @returns true when routes and cells were rebuilt
   */
  fitToTiles(): boolean {
    if (this.rebuildBlocker()) return false;
    if (!this.host.measure()) return false;
    this.host.rebuild();
    return true;
  }

  /**
   * Measure again the stations that had no fine tile at the last run and
   * rebuild where that changes the corridor. The first measurement does not
   * wait for the corridor tiles, which keep streaming in after it.
   *
   * @returns true when routes and cells were rebuilt
   */
  remeasure(): boolean {
    if (!this.host.hasUnmeasured()) return false;
    if (this.rebuildBlocker() || this.host.introRunning()) return false;
    const now = this.host.now();
    if (now - this.lastRemeasure < CorridorRefit.REMEASURE_INTERVAL_MS) return false;
    this.lastRemeasure = now;
    return this.fitToTiles();
  }

  /**
   * Apply a change of the corridor settings and rebuild with it. Measures
   * again first when the change moves the stations or what the rays see
   * (MEASUREMENT_KEYS); the other settings only reshape what was measured.
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

    const remeasure = MEASUREMENT_KEYS.some((key) => before[key] !== corridorConfig[key]);
    if (remeasure) this.host.clearMeasurements();
    this.host.measure();
    this.host.rebuild();
    return `Corridor rebuilt${remeasure ? ', measured again' : ''}: ${this.host.cellCount()} cells. Widths per stretch: __routes.describe()`;
  }
}
