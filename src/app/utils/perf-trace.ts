/**
 * The `[PerfTrace]` lines of every settled tile load and every height sweep
 * (ThreeTilesEngine.onTileSetSettled, VisualizationFacadeService.onTilesLoaded,
 * RouteGridHeightSweep): off by default, `__perf.trace(true)` in DevTools
 * turns them on, `__perf.trace(false)` off again.
 *
 * console.log, not console.warn: Chrome attaches an expandable stack to
 * every warning. In the Berlin log of 2026-09-15 those stacks were about
 * 192,000 of 206,000 lines, and DevTools gave up. Warnings are for problems.
 */
class PerfTrace {
  enabled = false;

  /** Print the line `line` builds, only while on: nothing is formatted while off. */
  log(line: () => string): void {
    if (this.enabled) console.log(line());
  }
}

export const perfTrace = new PerfTrace();
