/**
 * ──────────────────────────────────────────────────────────────────────────
 * Debug-Logging — unified prefix `[CELL-GRID]` so the entire subsystem can
 * be filtered as one stream in DevTools / log output. Each sub-tag is a
 * single token after the prefix to keep the format greppable:
 *
 *   [CELL-GRID] SAMPLE  ...
 *   [CELL-GRID] REFINE  ...
 *   [CELL-GRID] HEIGHT_UPDATE  ...
 *
 * Sub-tag toggles control verbosity per category. REFINE stays on for
 * production-light tracing; SAMPLE and HEIGHT_UPDATE fire very often and
 * stay off unless investigating.
 * ──────────────────────────────────────────────────────────────────────────
 */
const CELL_GRID_LOG = {
  SAMPLE: false,
  REFINE: true,
  HEIGHT_UPDATE: false,
} as const;

type CellGridLogTag = keyof typeof CELL_GRID_LOG;

/** Single helper so the `[CELL-GRID]` prefix never drifts. */
export function logGrid(tag: CellGridLogTag, ...args: unknown[]): void {
  if (!CELL_GRID_LOG[tag]) return;
  console.log(`[CELL-GRID] ${tag}`, ...args);
}
