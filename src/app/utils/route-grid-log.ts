/**
 * ──────────────────────────────────────────────────────────────────────────
 * Debug-Logging — unified prefix `[CELL-GRID]` so the entire subsystem can
 * be filtered as one stream in DevTools / log output. Each sub-tag is a
 * single token after the prefix to keep the format greppable:
 *
 *   [CELL-GRID] BOOTUP  ...
 *   [CELL-GRID] SAMPLE  ...
 *   [CELL-GRID] REFINE  ...
 *
 * Sub-tag toggles control verbosity per category. Keep BOOTUP / REFINE /
 * VIZ-MODE / DISPOSE on for production-light tracing; the rest fires
 * very often and stays off unless investigating.
 * ──────────────────────────────────────────────────────────────────────────
 */
const CELL_GRID_LOG = {
  BOOTUP: true,
  CELL_GEN: false,
  SAMPLE: false,
  REFINE: true,
  VIZ_MODE: true,
  TOWER_REG: false,
  HEIGHT_UPDATE: false,
  DISPOSE: true,
} as const;

type CellGridLogTag = keyof typeof CELL_GRID_LOG;

/** Single helper so the `[CELL-GRID]` prefix never drifts. */
export function logGrid(tag: CellGridLogTag, ...args: unknown[]): void {
  if (!CELL_GRID_LOG[tag]) return;
  console.log(`[CELL-GRID] ${tag}`, ...args);
}
