import { CellSample, RouteCell } from './route-cell';
import type { RouteCellSampler } from './route-cell-sampler';

/**
 * DIAGNOSTICS — temporary debug API for the route-grid height-anomaly hunt
 * (plans/wir-wollen-einen-engine-typed-cray.md). Surfaced via __rg.* by
 * GlobalRouteGridService. Safe to delete once the cell-height-caching bug
 * is rooted out.
 *
 * Reine Funktionen über die Cell-Map des Grids. `GlobalRouteGrid` reicht
 * sie als `dumpCellsInBox` / `dumpStats` / `dumpOutliers` /
 * `resetHeightsAndRetry` durch, der Combat-Pfad ruft nichts davon.
 */

/** Compact histogram summary used by diagnostics dump methods. */
export interface HistogramSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  p95: number;
}

function histogramSummary(vals: number[]): HistogramSummary | null {
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const sum = sorted.reduce((s, v) => s + v, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
  };
}

/** Achsenparalleler Ausschnitt in lokalen Koordinaten. */
export interface RouteCellBox {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

/** Eine Zeile aus `collectCellsInBox` / `collectHeightOutliers`. */
export interface RouteCellDump {
  key: number;
  x: number;
  z: number;
  terrainHeight: number;
  /** `deck` on a bridge (column top), sonst `ground` */
  surface: RouteCell['surface'];
  routeAnchorY: number;
  deltaFromAnchor: number;
  state: CellSample['state'];
  tileDepth: number;
  tileGeometricError: number;
  heightSampled: boolean;
}

/** Ergebnis von `summarizeCellSamples`. */
export interface RouteGridSampleStats {
  totalCells: number;
  unsampled: number;
  stable: number;
  sampleFrame: number;
  tileDepth: HistogramSummary | null;
  tileGeometricError: HistogramSummary | null;
  terrainHeight: HistogramSummary | null;
  deltaFromAnchorAbs: HistogramSummary | null;
  routeAnchorY: HistogramSummary | null;
  unsampledCells: { key: number; x: number; z: number; routeAnchorY: number; terrainHeight: number }[];
}

/** Ergebnis von `resetFallbackHeights`. */
export interface HeightResetResult {
  reset: number;
  promotedAfter: number;
  avgAbsYDelta: number;
  maxAbsYDelta: number;
  topMoves: { key: number; x: number; z: number; before: number; after: number; delta: number }[];
}

/** A cell or grid position in local coordinates. */
export interface RouteCellSpot {
  x: number;
  z: number;
}

/** Above the median of its neighbours by more than this, a cell counts as raised (car roof, tree crown). */
const RAISED_CELL_M = 1;

/** One grid spot of `__corridor.pick()`: what the grid holds there. */
export interface RouteCellProbe {
  x: number;
  z: number;
  /** Distance of the spot to the nearest route centre line, metres. */
  routeM: number;
  /** false: no cell, the spot lies outside the corridor. */
  cell: boolean;
  state: CellSample['state'] | '-';
  heightM: number | null;
  /** Height above the median of the sampled neighbours. */
  aboveNeighboursM: number | null;
  surface: RouteCell['surface'] | '-';
  /** The tower's answers for this cell. */
  ground: 'visible' | 'blocked' | '-';
  air: 'visible' | 'blocked' | '-';
}

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

const answer = (value: boolean | undefined) => (value === undefined ? '-' : value ? 'visible' : 'blocked');

/** A row of `__corridor.pick()` for the spot (x, z); `cell` is the cell there, if any. */
export function probeRouteCell(
  cell: RouteCell | undefined,
  x: number,
  z: number,
  routeM: number,
  towerId: string | null,
  neighbourMedian: (cell: RouteCell) => number | null,
): RouteCellProbe {
  const median = cell?.heightSampled ? neighbourMedian(cell) : null;
  return {
    x,
    z,
    routeM: round(routeM, 1),
    cell: cell !== undefined,
    state: cell?.sample.state ?? '-',
    heightM: cell ? round(cell.terrainHeight, 2) : null,
    aboveNeighboursM: cell && median !== null ? round(cell.terrainHeight - median, 2) : null,
    surface: cell?.surface ?? '-',
    ground: cell && towerId ? answer(cell.towerVisibility.get(towerId)) : '-',
    air: cell && towerId ? answer(cell.airVisibility.get(towerId)) : '-',
  };
}

/**
 * What the grid holds in one tower's range, for `__corridor.towerCells()`:
 * where a gap in the tower's LOS display comes from.
 */
export interface TowerRangeReport {
  /** Cells whose centre lies within the range. */
  cells: number;
  /** Of those, cells without a terrain sample. The LOS display leaves them out. */
  unsampled: number;
  /** The tower's ground answers: visible, blocked, none at all. */
  groundVisible: number;
  groundBlocked: number;
  groundMissing: number;
  /** The same for its air answers. */
  airVisible: number;
  airBlocked: number;
  airMissing: number;
  /** Positions in range without a cell, but with a cell on all four sides. */
  holes: RouteCellSpot[];
  /** Sampled cells more than 1 m above the median of their sampled neighbours. */
  raised: (RouteCellSpot & { aboveM: number })[];
}

/**
 * Count what the grid knows about the cells in a tower's range.
 *
 * @param inRange Every cell whose centre lies within the range, sampled or not.
 * @param holes Grid positions in range without a cell, see `GlobalRouteGrid.findHolesInRange`.
 * @param neighbourMedian Median height of a cell's stable neighbours, null with fewer than three.
 */
export function summarizeTowerRange(
  inRange: readonly RouteCell[],
  towerId: string,
  holes: RouteCellSpot[],
  neighbourMedian: (cell: RouteCell) => number | null,
): TowerRangeReport {
  const report: TowerRangeReport = {
    cells: inRange.length,
    unsampled: 0,
    groundVisible: 0,
    groundBlocked: 0,
    groundMissing: 0,
    airVisible: 0,
    airBlocked: 0,
    airMissing: 0,
    holes,
    raised: [],
  };
  for (const cell of inRange) {
    if (!cell.heightSampled) report.unsampled++;
    const ground = cell.towerVisibility.get(towerId);
    if (ground === undefined) report.groundMissing++;
    else if (ground) report.groundVisible++;
    else report.groundBlocked++;
    const air = cell.airVisibility.get(towerId);
    if (air === undefined) report.airMissing++;
    else if (air) report.airVisible++;
    else report.airBlocked++;

    if (!cell.heightSampled) continue;
    const median = neighbourMedian(cell);
    if (median !== null && cell.terrainHeight - median > RAISED_CELL_M) {
      report.raised.push({ x: cell.x, z: cell.z, aboveM: Math.round((cell.terrainHeight - median) * 10) / 10 });
    }
  }
  report.raised.sort((a, b) => b.aboveM - a.aboveM);
  return report;
}

/**
 * Per-cell snapshot of the sample state — used by `dumpCellsInBox` /
 * `__rg.dumpCellsInBox(...)` to classify Sub-Fall A (unsampled+fallback)
 * vs Sub-Fall B (stable+outlier) in DevTools.
 */
export function collectCellsInBox(cells: ReadonlyMap<number, RouteCell>, box: RouteCellBox): RouteCellDump[] {
  const out = [];
  for (const cell of cells.values()) {
    if (cell.x < box.xMin || cell.x > box.xMax) continue;
    if (cell.z < box.zMin || cell.z > box.zMax) continue;
    out.push({
      key: cell.key,
      x: cell.x,
      z: cell.z,
      terrainHeight: cell.terrainHeight,
      surface: cell.surface,
      routeAnchorY: cell.routeAnchorY,
      deltaFromAnchor: cell.terrainHeight - cell.routeAnchorY,
      state: cell.sample.state,
      tileDepth: cell.sample.tileDepth,
      tileGeometricError: cell.sample.tileGeometricError,
      heightSampled: cell.heightSampled,
    });
  }
  out.sort((a, b) => (a.x - b.x) || (a.z - b.z));
  return out;
}

/**
 * Aggregate histogram across all cells — used by `__rg.dumpStats()` to
 * compare runs against each other (Mailand vs Manhattan, pre vs post
 * resetHeightsAndRetry). Includes `deltaFromAnchorAbs` which is the
 * most diagnostic single value: when this is large for many stable
 * cells, the LOD-race hypothesis is supported.
 */
export function summarizeCellSamples(cells: ReadonlyMap<number, RouteCell>, sampleFrame: number): RouteGridSampleStats {
  let unsampled = 0;
  let stable = 0;
  const depths: number[] = [];
  const errors: number[] = [];
  const heights: number[] = [];
  const deltas: number[] = [];
  const anchors: number[] = [];
  const unsampledCells: { key: number; x: number; z: number; routeAnchorY: number; terrainHeight: number }[] = [];

  for (const cell of cells.values()) {
    if (cell.sample.state === 'unsampled') {
      unsampled++;
      unsampledCells.push({
        key: cell.key,
        x: cell.x,
        z: cell.z,
        routeAnchorY: cell.routeAnchorY,
        terrainHeight: cell.terrainHeight,
      });
    } else {
      stable++;
      depths.push(cell.sample.tileDepth);
      if (Number.isFinite(cell.sample.tileGeometricError)) {
        errors.push(cell.sample.tileGeometricError);
      }
    }
    heights.push(cell.terrainHeight);
    deltas.push(Math.abs(cell.terrainHeight - cell.routeAnchorY));
    anchors.push(cell.routeAnchorY);
  }

  unsampledCells.sort((a, b) => (a.x - b.x) || (a.z - b.z));

  return {
    totalCells: cells.size,
    unsampled,
    stable,
    sampleFrame,
    tileDepth: histogramSummary(depths),
    tileGeometricError: histogramSummary(errors),
    terrainHeight: histogramSummary(heights),
    deltaFromAnchorAbs: histogramSummary(deltas),
    routeAnchorY: histogramSummary(anchors),
    unsampledCells,
  };
}

/**
 * Convenience filter — `dumpCellsInBox` over the whole grid, restricted
 * to cells with `|terrainHeight - routeAnchorY| > thresholdM`. Spares
 * the user having to pick a bounding box when they just want to see
 * "which cells are anomalous". Sorted by magnitude descending.
 */
export function collectHeightOutliers(cells: ReadonlyMap<number, RouteCell>, thresholdM: number): RouteCellDump[] {
  const out: RouteCellDump[] = [];
  for (const cell of cells.values()) {
    const delta = cell.terrainHeight - cell.routeAnchorY;
    if (Math.abs(delta) <= thresholdM) continue;
    out.push({
      key: cell.key,
      x: cell.x,
      z: cell.z,
      terrainHeight: cell.terrainHeight,
      surface: cell.surface,
      routeAnchorY: cell.routeAnchorY,
      deltaFromAnchor: delta,
      state: cell.sample.state,
      tileDepth: cell.sample.tileDepth,
      tileGeometricError: cell.sample.tileGeometricError,
      heightSampled: cell.heightSampled,
    });
  }
  out.sort((a, b) => Math.abs(b.deltaFromAnchor) - Math.abs(a.deltaFromAnchor));
  return out;
}

/**
 * Demote stable cells with low-quality samples back to `unsampled` and
 * run a fresh `retryUnsampledCells()` pass.
 *
 * Resets only cells that came from the legacy fallback path (no LOD
 * info: `tileDepth=0` or `tileGeomErr=Infinity`). Productive samples
 * with real tile-LOD are kept — wholesale reset destroyed them in
 * cases 1/7/8 of the bug hunt. The strict `sampleCellY` now rejects
 * fallback hits up front, so this method is now mostly a debug helper
 * for legacy data still in the cache from a previous build.
 *
 * Returns before/after Y-deltas so the user can see the magnitude of
 * the correction in one call.
 *
 * @param sampler Schreibt den Reset (`resetToUnsampled`), damit Höhe und
 *   Sample-State nur im Sampler geändert werden.
 * @param retryUnsampledCells Der Retry-Pass des Grids, läuft zwischen
 *   Zurücksetzen und Auswertung.
 */
export function resetFallbackHeights(
  cells: ReadonlyMap<number, RouteCell>,
  sampler: RouteCellSampler,
  retryUnsampledCells: () => void,
): HeightResetResult {
  const before = new Map<number, number>();
  let reset = 0;
  for (const cell of cells.values()) {
    if (cell.sample.state !== 'stable') continue;
    const isFallback = cell.sample.tileDepth === 0 || cell.sample.tileGeometricError === Infinity;
    if (!isFallback) continue;
    before.set(cell.key, cell.terrainHeight);
    sampler.resetToUnsampled(cell);
    reset++;
  }
  retryUnsampledCells();

  let promotedAfter = 0;
  let sumAbs = 0;
  let maxAbs = 0;
  const moves: { key: number; x: number; z: number; before: number; after: number; delta: number }[] = [];
  for (const cell of cells.values()) {
    if (cell.sample.state === 'stable') promotedAfter++;
    const prev = before.get(cell.key);
    if (prev === undefined) continue;
    const delta = cell.terrainHeight - prev;
    const abs = Math.abs(delta);
    sumAbs += abs;
    if (abs > maxAbs) maxAbs = abs;
    moves.push({ key: cell.key, x: cell.x, z: cell.z, before: prev, after: cell.terrainHeight, delta });
  }
  moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    reset,
    promotedAfter,
    avgAbsYDelta: moves.length > 0 ? sumAbs / moves.length : 0,
    maxAbsYDelta: maxAbs,
    topMoves: moves.slice(0, 10),
  };
}
