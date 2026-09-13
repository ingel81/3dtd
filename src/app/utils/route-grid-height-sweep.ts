import { RouteCell } from './route-cell';
import { RouteCellSampler } from './route-cell-sampler';
import { logGrid } from './route-grid-log';

/**
 * Frame-budgeted terrain-refresh sweep over the route cells.
 *
 * `begin` snapshots the cell set into a queue; `step` chews through it
 * across rAF ticks within a per-frame time budget. The only sweep
 * implementation there is: GlobalRouteGrid.updateTerrainHeights drains this
 * same queue with an infinite budget. `null` queue = no sweep in flight.
 */
export class RouteGridHeightSweep {
  private queue: RouteCell[] | null = null;
  private index = 0;
  private changed: RouteCell[] = [];
  private promoted = 0;
  private refreshed = 0;
  private slices = 0;
  private start = 0;

  /**
   * @param sampler The grid's cell sampler; without its column sampler no sweep runs.
   * @param onSliceChanged Told about the cells one slice moved, as soon as the
   *   slice is done: the grid snaps its viz and tells its cells-changed listeners.
   */
  constructor(
    private readonly sampler: RouteCellSampler,
    private readonly onSliceChanged: (changed: RouteCell[]) => void,
  ) {}

  /**
   * Begin a sweep over `cells`. Snapshots them into the queue; the caller
   * then drives `step(budgetMs)` once per rAF tick until it reports `done`.
   *
   * Re-calling while a sweep is already in flight restarts it from scratch
   * (a fresh tile-load means newer LOD is available). The peek-skip fast
   * path in `sampleCellY` makes re-sweeping already-current cells cheap, so
   * restarting is not wasteful.
   */
  begin(cells: Iterable<RouteCell>): void {
    if (!this.sampler.columnSampler) return;
    this.queue = Array.from(cells);
    this.index = 0;
    this.changed.length = 0;
    this.promoted = 0;
    this.refreshed = 0;
    this.slices = 0;
    this.start = performance.now();
    // Reset the skip/raycast diagnostic counters so the aggregated
    // PerfTrace logged at `done` reflects this sweep only.
    this.sampler.peekSkipCount = 0;
    this.sampler.raycastCount = 0;
  }

  /**
   * Process one frame's worth of the sweep. Raycasts cells from the cursor
   * until the `budgetMs` time budget is exhausted (checked every ~32 cells
   * to keep `performance.now()` overhead negligible), then yields. Hands
   * THIS slice's changed cells to `onSliceChanged`, so no change is lost
   * when a new tile-load restarts the sweep. Listeners with expensive
   * follow-up work (per-tower LOS, route line) collect the slices and run
   * once the sweep is over.
   *
   * Returns `done=true` once the queue is exhausted (or there is no sweep
   * in flight), at which point the aggregated `[PerfTrace]` line is logged.
   */
  step(budgetMs: number): { done: boolean; processed: number; changed: number } {
    const queue = this.queue;
    if (!this.sampler.columnSampler || queue === null) {
      return { done: true, processed: 0, changed: 0 };
    }

    const t0 = performance.now();
    let processed = 0;
    this.slices++;

    while (this.index < queue.length) {
      const cell = queue[this.index++];
      const wasUnsampled = !cell.heightSampled;
      if (this.sampler.sampleCellY(cell)) {
        this.changed.push(cell);
        if (wasUnsampled) {
          this.promoted++;
        } else {
          this.refreshed++;
        }
      }
      processed++;
      // Budget check only every 32 cells: peek-skipped cells are so cheap
      // that a per-cell performance.now() would dominate their cost.
      if ((processed & 31) === 0 && performance.now() - t0 >= budgetMs) break;
    }

    const done = this.index >= queue.length;

    // Snap viz + drive LOS for this slice's changes, then clear the buffer.
    // `changedThisSlice` is reported back purely as caller diagnostics: the
    // route line / animation subscribe to cells-changed like everyone else
    // and coalesce their (expensive) rebuild to the end of the sweep
    // themselves; nothing here needs to re-snap them.
    const changedThisSlice = this.changed.length;
    if (changedThisSlice > 0) {
      this.onSliceChanged(this.changed.slice());
      this.changed.length = 0;
    }

    if (done) {
      const total = queue.length;
      const skipped = this.sampler.peekSkipCount;
      const raycasted = this.sampler.raycastCount;
      const skipRatio = total > 0 ? ((skipped / total) * 100).toFixed(1) : '0.0';
      const spanMs = performance.now() - this.start;
      console.warn(
        `[PerfTrace] updateTerrainHeights: spanMs=${spanMs.toFixed(1)} ` +
        `slices=${this.slices} | ` +
        `cells=${total} ` +
        `peekSkipped=${skipped} (${skipRatio}%) ` +
        `raycasted=${raycasted} ` +
        `promoted=${this.promoted} ` +
        `refreshed=${this.refreshed} ` +
        `peekAvailable=${this.sampler.terrainPeekLOD !== null}`
      );
      logGrid(
        'HEIGHT_UPDATE',
        `cells=${total} promoted=${this.promoted} ` +
        `refreshed=${this.refreshed} skipped=${skipped} slices=${this.slices}`,
      );
      this.queue = null;
    }

    return { done, processed, changed: changedThisSlice };
  }

  /** True while a sweep is in flight. */
  get active(): boolean {
    return this.queue !== null;
  }

  /** Drop an in-flight sweep without running its remaining cells. */
  abort(): void {
    this.queue = null;
    this.index = 0;
    this.changed.length = 0;
  }
}
