import type { RouteWaypoint } from '../models/game.types';
import type { CoordinateSync } from '../three-engine/renderers';
import { CellSample, RouteCell } from './route-cell';
import type { RouteCellSampler } from './route-cell-sampler';
import type { RouteCellLattice } from './route-grid-builder';
import type { WalkCheck, WalkJudgement } from './corridor-walk';

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

/** Every cell of the grid, for `dumpCellsInBox`. */
export const WHOLE_GRID: Readonly<RouteCellBox> = { xMin: -Infinity, xMax: Infinity, zMin: -Infinity, zMax: Infinity };

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
  /** Cells without a sample of their own, their height interpolated between stable neighbours. */
  filled: number;
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
  /**
   * The cell lies in the walkable band of its station (cellWalkable,
   * corridor-walk.ts). False beside the band: the band ends before it. Null
   * where that cannot be told or would change nothing (no sample of its
   * own, a coarse tile, a deck or tunnel cell, a passage, a stretch the
   * band does not decide) or without a cell.
   */
  walkable: boolean | null;
  /** Why `walkable` is what it is (WalkCheck): `band`, `roof`, `step`, `drop`, `hollow`, `coarse tile` and so on; null without a cell. */
  walkCheck: WalkCheck | null;
  /** Height of the cell over the backbone of its band station (corridor-band.ts). */
  overLineM: number | null;
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
  judgeWalk: (cell: RouteCell) => WalkJudgement,
): RouteCellProbe {
  const median = cell?.heightSampled ? neighbourMedian(cell) : null;
  const walk = cell ? judgeWalk(cell) : null;
  return {
    x,
    z,
    routeM: round(routeM, 1),
    cell: cell !== undefined,
    state: cell?.sample.state ?? '-',
    heightM: cell ? round(cell.terrainHeight, 2) : null,
    walkable: walk?.walkable ?? null,
    walkCheck: walk?.check ?? null,
    overLineM: walk?.overLine != null ? round(walk.overLine, 2) : null,
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
  /**
   * Cells an enemy could not walk to that the corridor still holds (a car or
   * an eave a finer tile showed only once towers stood), see RouteCellProbe.walkable.
   */
  unwalkable: number;
}

/**
 * Count what the grid knows about the cells in a tower's range.
 *
 * @param inRange Every cell whose centre lies within the range, sampled or not.
 * @param holes Grid positions in range without a cell, see `GlobalRouteGrid.findHolesInRange`.
 * @param neighbourMedian Median height of a cell's stable neighbours, null with fewer than three.
 * @param walkable Whether an enemy could walk to a cell (cellWalkable), null where that cannot be told.
 */
export function summarizeTowerRange(
  inRange: readonly RouteCell[],
  towerId: string,
  holes: RouteCellSpot[],
  neighbourMedian: (cell: RouteCell) => number | null,
  walkable: (cell: RouteCell) => boolean | null,
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
    unwalkable: 0,
  };
  for (const cell of inRange) {
    if (!cell.heightSampled) report.unsampled++;
    if (walkable(cell) === false) report.unwalkable++;
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
  let filled = 0;
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
    } else if (cell.sample.state === 'filled') {
      filled++;
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
    filled,
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

// ========================================
// Spatial probes on the cell lattice, for `__corridor.towerCells()` / `pick()`
// ========================================

/** What the spatial probes read off the grid: its cells, their lattice and the routes it was built from. */
export interface RouteGridView {
  cells: ReadonlyMap<number, RouteCell>;
  lattice: RouteCellLattice;
  routes: readonly (readonly RouteWaypoint[])[];
  /** Null before the grid is initialized; the route probes then find nothing. */
  sync: CoordinateSync | null;
}

/**
 * Grid positions within `range` of (x, z) that have no cell while the four
 * positions next to them along the axes all have one: holes in the
 * corridor, which the LOS display would show as gaps in the street. Every
 * segment claims a convex region of cells, so there should be none.
 */
export function findCorridorHoles(view: RouteGridView, x: number, z: number, range: number): RouteCellSpot[] {
  const { cells, lattice } = view;
  const holes: RouteCellSpot[] = [];
  const rangeSq = range * range;
  const has = (gx: number, gz: number) => cells.has(lattice.key(gx, gz));
  for (let gx = lattice.index(x - range); gx <= lattice.index(x + range); gx++) {
    const cx = (gx + 0.5) * lattice.cellSize;
    for (let gz = lattice.index(z - range); gz <= lattice.index(z + range); gz++) {
      const cz = (gz + 0.5) * lattice.cellSize;
      if ((cx - x) ** 2 + (cz - z) ** 2 > rangeSq || has(gx, gz)) continue;
      if (has(gx - 1, gz) && has(gx + 1, gz) && has(gx, gz - 1) && has(gx, gz + 1)) holes.push({ x: cx, z: cz });
    }
  }
  return holes;
}

/**
 * The cells the route centre lines run through within `range` of (x, z),
 * probed every half metre along each segment, and the spots on a centre
 * line without a cell. A row missing along the red line shows up here.
 */
export function collectCentreLineCells(
  view: RouteGridView,
  x: number,
  z: number,
  range: number,
): { cells: RouteCell[]; missing: RouteCellSpot[] } {
  const { lattice } = view;
  const cells = new Map<number, RouteCell>();
  const missing = new Map<number, RouteCellSpot>();
  const rangeSq = range * range;
  forEachCentreSpot(view, (px, pz) => {
    if ((px - x) ** 2 + (pz - z) ** 2 > rangeSq) return;
    const gx = lattice.index(px);
    const gz = lattice.index(pz);
    const key = lattice.key(gx, gz);
    const cell = view.cells.get(key);
    if (cell) cells.set(key, cell);
    else missing.set(key, { x: (gx + 0.5) * lattice.cellSize, z: (gz + 0.5) * lattice.cellSize });
  });
  return { cells: [...cells.values()], missing: [...missing.values()] };
}

/**
 * Every grid spot within `radius` of (x, z) and what the grid holds there,
 * nearest to the route line first, for `__corridor.pick()`. `towerId`
 * adds that tower's answers.
 */
export function probeCellsAround(
  view: RouteGridView,
  x: number,
  z: number,
  radius: number,
  towerId: string | null,
  neighbourMedian: (cell: RouteCell) => number | null,
  judgeWalk: (cell: RouteCell) => WalkJudgement,
): RouteCellProbe[] {
  const { cells, lattice } = view;
  const rows: RouteCellProbe[] = [];
  const radiusSq = radius * radius;
  for (let gx = lattice.index(x - radius); gx <= lattice.index(x + radius); gx++) {
    const cx = (gx + 0.5) * lattice.cellSize;
    for (let gz = lattice.index(z - radius); gz <= lattice.index(z + radius); gz++) {
      const cz = (gz + 0.5) * lattice.cellSize;
      if ((cx - x) ** 2 + (cz - z) ** 2 > radiusSq) continue;
      rows.push(probeRouteCell(
        cells.get(lattice.key(gx, gz)), cx, cz, distanceToRoutes(view, cx, cz), towerId, neighbourMedian, judgeWalk,
      ));
    }
  }
  return rows.sort((a, b) => a.routeM - b.routeM);
}

/** Walk the centre lines of the routes in half-metre steps (local x, z). */
function forEachCentreSpot(view: RouteGridView, visit: (x: number, z: number) => void): void {
  const sync = view.sync;
  if (!sync) return;
  for (const route of view.routes) {
    for (let i = 0; i < route.length - 1; i++) {
      const a = sync.geoToLocalSimple(route[i].lat, route[i].lon, 0);
      const b = sync.geoToLocalSimple(route[i + 1].lat, route[i + 1].lon, 0);
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5));
      for (let s = 0; s <= steps; s++) visit(a.x + ((b.x - a.x) * s) / steps, a.z + ((b.z - a.z) * s) / steps);
    }
  }
}

/** Distance from (x, z) to the nearest centre line of the routes. */
function distanceToRoutes(view: RouteGridView, x: number, z: number): number {
  const sync = view.sync;
  let best = Infinity;
  if (!sync) return best;
  for (const route of view.routes) {
    for (let i = 0; i < route.length - 1; i++) {
      const a = sync.geoToLocalSimple(route[i].lat, route[i].lon, 0);
      const b = sync.geoToLocalSimple(route[i + 1].lat, route[i + 1].lon, 0);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lenSq = dx * dx + dz * dz;
      const t = lenSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / lenSq)) : 0;
      best = Math.min(best, Math.hypot(a.x + dx * t - x, a.z + dz * t - z));
    }
  }
  return best;
}
