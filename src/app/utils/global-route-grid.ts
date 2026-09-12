import { InstancedMesh, Vector3 } from 'three';
import { Enemy } from '../entities/enemy.entity';
import { GeoPosition, RouteWaypoint } from '../models/game.types';
import { segmentHalfWidth } from './route-corridor';
import { CoordinateSync } from '../three-engine/renderers';
import { ColumnSampler, TerrainPeekLOD } from '../three-engine/renderers/three-tower.renderer';
import { LOS_VIZ_CONFIG } from '../configs/los-viz.config';
import { LosResolveContext, isCubeVisible } from './gpu-cube-resolve';
import { RouteCell, getAirTargetY } from './route-cell';
import {
  HeightResetResult,
  RouteCellBox,
  RouteCellDump,
  RouteGridSampleStats,
  collectCellsInBox,
  collectHeightOutliers,
  resetFallbackHeights,
  summarizeCellSamples,
} from './route-grid-diagnostics';
import { RouteGridAggregateViz } from './route-grid-aggregate-viz';
import { RouteCellSampler } from './route-cell-sampler';
import { logGrid } from './route-grid-log';

/** Numeric ascending order for Array.prototype.sort, hoisted so hot paths allocate no comparator. */
const ascending = (a: number, b: number): number => a - b;

/**
 * GlobalRouteGrid - Unified Cell System for Enemy Tracking and LOS
 *
 * Replaces both EnemySpatialGrid and RouteLosGrid with a single global system.
 * Cells are pre-generated along enemy routes and store:
 * - Terrain height (for visualization)
 * - Current enemies in the cell
 * - LOS visibility per tower
 *
 * Benefits:
 * - Single point of truth for cell-based queries
 * - O(1) enemy position updates
 * - O(1) LOS checks (pre-computed per tower)
 * - Unified visualization
 */
export class GlobalRouteGrid {
  /** Map of cell keys to RouteCell data */
  private readonly cells = new Map<number, RouteCell>();

  /**
   * Listener called when cells change their terrain sample — either
   * promoted (unsampled→sampled) or refreshed (sampled→strictly-better
   * tile LOD). Both shift `cell.terrainHeight`, so per-tower LOS resolved
   * against the old height is stale for exactly those cells. Consumers
   * (e.g. tower-placement-service) use the changed-cell list to re-resolve
   * LOS for just those cells per placed tower and to refresh per-tower viz
   * meshes — instead of rebuilding every tower's whole visibility cache.
   */
  private cellsChangedListeners: ((changed: RouteCell[]) => void)[] = [];

  /** Map of enemy ID to current cell key (for fast cell transitions) */
  private enemyCellKeys = new Map<string, number>();

  /** Unique across instances, so an enemy's cell memo can never match another grid. */
  private static nextGeneration = 0;

  /**
   * Bumped whenever `cells` and `enemyCellKeys` are rebuilt or dropped
   * (generateFromRoutes, clear). Between bumps the cell set is fixed (cells
   * are only ever created inside generateFromRoutes), which is what lets an
   * enemy's cell memo (Enemy.routeCell*) stand in for the Map lookups.
   */
  private generation = GlobalRouteGrid.nextGeneration++;

  /**
   * Last set of routes that `generateFromRoutes` was called with. Used
   * by the air-route-tube debug overlay to re-render along the same
   * geometry the grid was built from. Empty until `generateFromRoutes`
   * runs at least once.
   */
  private cachedRoutes: RouteWaypoint[][] = [];

  /** Cached enemy routes (geo-coordinate polylines) for debug overlays. */
  getCachedRoutes(): RouteWaypoint[][] {
    return this.cachedRoutes;
  }

  /** Grid cell size in meters (matches original CELL_SIZE) */
  private readonly CELL_SIZE = 2;

  /** Cached inverse cell size for fast multiplication instead of division */
  private readonly INV_CELL_SIZE = 1 / this.CELL_SIZE;

  /** Reused scratch for per-enemy geo→local conversion in getEnemiesInRadius. */
  private readonly _radiusScanScratch = new Vector3();

  /** Reused sample buffer for estimateTerrainY, which runs per enemy per sub-step in unsampled cells. */
  private readonly _estimateScratch: number[] = [];

  /** Integer hash for cell key (avoids string allocation in hot path) */
  private intCellKey(cx: number, cz: number): number {
    return ((cx & 0xFFFF) << 16) | (cz & 0xFFFF);
  }

  /**
   * Grid index of a local coordinate. The one keying rule: cells are created
   * with it, so every lookup has to use it as well. `Math.floor`, not `| 0`:
   * truncation rounds negative coordinates toward zero and lands them in the
   * neighbour cell on the origin side.
   */
  private cellIndex(v: number): number {
    return Math.floor(v * this.INV_CELL_SIZE);
  }

  /** Terrain-Sampling der Cells (`sampleCellY`) mit Proben und Sweep-Zählern. */
  private readonly sampler = new RouteCellSampler((cell) => this.medianOfStableNeighbourY(cell));

  // ── Frame-budgeted terrain-refresh sweep state ──────────────────────
  // `beginTerrainHeightRefresh` snapshots the cell set into this queue;
  // `stepTerrainHeightRefresh` chews through it across rAF ticks within a
  // per-frame time budget. The only sweep implementation there is —
  // `updateTerrainHeights` drains this same queue with an infinite budget.
  // `null` queue = no sweep in flight.
  private terrainSweepQueue: RouteCell[] | null = null;
  private terrainSweepIndex = 0;
  private terrainSweepChanged: RouteCell[] = [];
  private terrainSweepPromoted = 0;
  private terrainSweepRefreshed = 0;
  private terrainSweepSlices = 0;
  private terrainSweepStart = 0;

  /** Coordinate sync for geo <-> local conversions */
  private coordinateSync: CoordinateSync | null = null;

  /** Aggregat-Debug-Viz (`grid` / `gridAir`), liest dieselbe Cell-Map. */
  private readonly aggregateViz = new RouteGridAggregateViz(this.cells, this.CELL_SIZE);

  /**
   * Median `terrainHeight` of the 8 adjacent stable cells. Returns `null`
   * when fewer than 3 stable neighbours exist — not enough signal for a
   * meaningful sanity check. Used by `sampleCellY` to reject hits that
   * diverge wildly from the local terrain.
   */
  private medianOfStableNeighbourY(cell: RouteCell): number | null {
    const gx = this.cellIndex(cell.x);
    const gz = this.cellIndex(cell.z);
    const samples: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const n = this.cells.get(this.intCellKey(gx + dx, gz + dz));
        if (n && n.sample.state === 'stable') samples.push(n.terrainHeight);
      }
    }
    if (samples.length < 3) return null;
    samples.sort((a, b) => a - b);
    return samples[Math.floor(samples.length / 2)];
  }

  /**
   * Best-effort terrain-Y estimate at an arbitrary local (x, z) using
   * the nearest sampled cells. Falls back through 3×3 then 5×5 ring
   * before giving up. Used by visual consumers (air-route tube, future
   * fallback paths) so a single unsampled cell in an otherwise-sampled
   * grid doesn't pull the viz down to `routeAnchorY` (which is often 0).
   */
  estimateTerrainY(x: number, z: number): number | null {
    const gx = this.cellIndex(x);
    const gz = this.cellIndex(z);
    const samples = this._estimateScratch;
    samples.length = 0;
    // 3×3 ring around the target cell (incl. centre).
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const n = this.cells.get(this.intCellKey(gx + dx, gz + dz));
        if (n && n.heightSampled) samples.push(n.terrainHeight);
      }
    }
    if (samples.length === 0) {
      // Expand to 5×5 ring (skip cells already visited).
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) continue;
          const n = this.cells.get(this.intCellKey(gx + dx, gz + dz));
          if (n && n.heightSampled) samples.push(n.terrainHeight);
        }
      }
    }
    if (samples.length === 0) return null;
    samples.sort(ascending);
    return samples[Math.floor(samples.length / 2)];
  }

  /**
   * Initialize the grid with required dependencies.
   * @param columnSampler Vertical terrain probe (ground + tile LOD)
   * @param coordinateSync Coordinate sync for geo <-> local conversions
   * @param terrainPeekLOD Optional cheap LOD probe used to skip re-sampling
   */
  initialize(
    columnSampler: ColumnSampler,
    coordinateSync: CoordinateSync,
    terrainPeekLOD?: TerrainPeekLOD,
  ): void {
    this.sampler.columnSampler = columnSampler;
    this.sampler.terrainPeekLOD = terrainPeekLOD ?? null;
    this.coordinateSync = coordinateSync;
  }

  /**
   * Get the CoordinateSync instance (for DPS profile computation)
   */
  getCoordinateSync(): CoordinateSync | null {
    return this.coordinateSync;
  }

  /**
   * Generate grid cells from enemy routes and sample their terrain height.
   *
   * A cell belongs to the corridor if its centre lies within the half width
   * of a route segment (`corridorHalfWidth` of the segment's start waypoint,
   * see route-corridor.ts). Cell centres therefore stay on the street, at
   * least two cells lie across it, and every point within
   * `lateralLimit(halfWidth)` of the centre line lies in a cell: the cell
   * containing it has its centre at most half a cell diagonal further out.
   * That is how far MovementComponent lets enemies spread, so no enemy walks
   * outside the cells towers look at.
   * @param routes Array of route paths
   */
  generateFromRoutes(routes: RouteWaypoint[][]): void {
    const sync = this.coordinateSync;
    if (!sync || !this.sampler.columnSampler) {
      console.error('[GlobalRouteGrid] Cannot generate - not initialized');
      return;
    }

    this.cells.clear();
    this.enemyCellKeys.clear();
    this.generation = GlobalRouteGrid.nextGeneration++;
    this.cachedRoutes = routes;

    for (const route of routes) {
      if (route.length < 2) continue;

      let start = sync.geoToLocalSimple(route[0].lat, route[0].lon, route[0].height ?? 0);
      for (let i = 0; i < route.length - 1; i++) {
        const endGeo = route[i + 1];
        const end = sync.geoToLocalSimple(endGeo.lat, endGeo.lon, endGeo.height ?? 0);
        this.generateSegmentCells(start, end, segmentHalfWidth(route[i]));
        start = end;
      }
    }
  }

  /**
   * Create the missing cells whose centre lies within `halfWidth` of the
   * segment `start`-`end` (local coordinates; y is the smoothed route
   * height, stored on each new cell as its `routeAnchorY` and as fallback
   * `terrainHeight` until the first sample succeeds).
   */
  private generateSegmentCells(
    start: { x: number; y: number; z: number },
    end: { x: number; y: number; z: number },
    halfWidth: number,
  ): void {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lenSq = dx * dx + dz * dz;
    const halfWidthSq = halfWidth * halfWidth;
    const gx0 = this.cellIndex(Math.min(start.x, end.x) - halfWidth);
    const gx1 = this.cellIndex(Math.max(start.x, end.x) + halfWidth);
    const gz0 = this.cellIndex(Math.min(start.z, end.z) - halfWidth);
    const gz1 = this.cellIndex(Math.max(start.z, end.z) + halfWidth);

    for (let gx = gx0; gx <= gx1; gx++) {
      const cx = (gx + 0.5) * this.CELL_SIZE;
      for (let gz = gz0; gz <= gz1; gz++) {
        const key = this.intCellKey(gx, gz);
        if (this.cells.has(key)) continue;

        // Closest point of the segment to the cell centre.
        const cz = (gz + 0.5) * this.CELL_SIZE;
        const t = lenSq > 0 ? Math.max(0, Math.min(1, ((cx - start.x) * dx + (cz - start.z) * dz) / lenSq)) : 0;
        const ox = start.x + dx * t - cx;
        const oz = start.z + dz * t - cz;
        if (ox * ox + oz * oz > halfWidthSq) continue;

        this.addCell(key, cx, cz, start.y + (end.y - start.y) * t);
      }
    }
  }

  /**
   * Construct a cell in unsampled state with `anchorY` as a temporary
   * terrain-Y fallback (combat-side reads need *some* value). Then funnel it
   * through sampleCellY, the sole writer of terrainHeight, which promotes
   * the cell to `stable` iff the raycast hits.
   */
  private addCell(key: number, x: number, z: number, anchorY: number): void {
    const cell: RouteCell = {
      key,
      x,
      z,
      terrainHeight: anchorY,        // Fallback until sampleCellY succeeds.
      routeAnchorY: anchorY,
      sample: {
        state: 'unsampled',
        sampledAt: 0,
        tileDepth: 0,
        tileGeometricError: Infinity,
      },
      heightSampled: false,
      enemies: new Set(),
      towerVisibility: new Map(),
      airVisibility: new Map(),
    };

    this.cells.set(key, cell);

    // Promote to `stable` if tiles are loaded at this position.
    this.sampler.sampleCellY(cell);
  }

  /**
   * Update terrain heights for all cells in one blocking pass.
   * Call this after terrain tiles have loaded for accurate visualization
   * and for valid air-LOS pre-compute. Uses ABSOLUTE raycast heights.
   *
   * This is NOT a second sweep implementation — it drives the exact same
   * queue as {@link beginTerrainHeightRefresh} / {@link
   * stepTerrainHeightRefresh}, just with an unlimited per-slice budget so it
   * finishes in one call. Used for the initial load, where the stall sits
   * behind the loading screen; the recurring tile-load path uses the
   * frame-budgeted driver so it can't freeze the main thread.
   */
  updateTerrainHeights(): void {
    if (!this.sampler.columnSampler) return;
    this.beginTerrainHeightRefresh();
    this.stepTerrainHeightRefresh(Infinity);
    // The budgeted driver only re-snaps the viz for slices that moved a cell.
    // The blocking path always wants it — cells may have been generated since
    // the last snap, and "cell sticks in ground" on toggle-race lives here.
    this.aggregateViz.refreshPositions();
  }

  /**
   * Begin a frame-budgeted terrain-height refresh over all cells. Snapshots
   * the current cell set into a sweep queue; the caller then drives
   * `stepTerrainHeightRefresh(budgetMs)` once per rAF tick until it reports
   * `done`. This is the non-blocking driver for the tile-load hot path —
   * same work as the blocking `updateTerrainHeights` (promote + LOD-refresh
   * every cell), just spread across frames so a tile-load no longer freezes
   * the main thread for ~900ms.
   *
   * Re-calling while a sweep is already in flight restarts it from scratch
   * (a fresh tile-load means newer LOD is available). The peek-skip fast
   * path in `sampleCellY` makes re-sweeping already-current cells cheap, so
   * restarting is not wasteful.
   */
  beginTerrainHeightRefresh(): void {
    if (!this.sampler.columnSampler) return;
    this.terrainSweepQueue = Array.from(this.cells.values());
    this.terrainSweepIndex = 0;
    this.terrainSweepChanged.length = 0;
    this.terrainSweepPromoted = 0;
    this.terrainSweepRefreshed = 0;
    this.terrainSweepSlices = 0;
    this.terrainSweepStart = performance.now();
    // Reset the skip/raycast diagnostic counters so the aggregated
    // PerfTrace logged at `done` reflects this sweep only.
    this.sampler.peekSkipCount = 0;
    this.sampler.raycastCount = 0;
  }

  /**
   * Process one frame's worth of the terrain-refresh sweep started by
   * `beginTerrainHeightRefresh`. Raycasts cells from the cursor until the
   * `budgetMs` time budget is exhausted (checked every ~32 cells to keep
   * `performance.now()` overhead negligible), then yields. Fires
   * `aggregateViz.refreshPositions` + `emitCellsChanged` for THIS slice's
   * changed cells, so no change is lost when a new tile-load restarts the
   * sweep. Listeners with expensive follow-up work (per-tower LOS, route
   * line) collect the slices and run once the sweep is over.
   *
   * Returns `done=true` once the queue is exhausted (or there is no sweep
   * in flight) — at which point the aggregated `[PerfTrace]` line is logged.
   */
  stepTerrainHeightRefresh(budgetMs: number): { done: boolean; processed: number; changed: number } {
    const queue = this.terrainSweepQueue;
    if (!this.sampler.columnSampler || queue === null) {
      return { done: true, processed: 0, changed: 0 };
    }

    const t0 = performance.now();
    let processed = 0;
    this.terrainSweepSlices++;

    while (this.terrainSweepIndex < queue.length) {
      const cell = queue[this.terrainSweepIndex++];
      const wasUnsampled = !cell.heightSampled;
      if (this.sampler.sampleCellY(cell)) {
        this.terrainSweepChanged.push(cell);
        if (wasUnsampled) {
          this.terrainSweepPromoted++;
        } else {
          this.terrainSweepRefreshed++;
        }
      }
      processed++;
      // Budget check only every 32 cells — peek-skipped cells are so cheap
      // that a per-cell performance.now() would dominate their cost.
      if ((processed & 31) === 0 && performance.now() - t0 >= budgetMs) break;
    }

    const done = this.terrainSweepIndex >= queue.length;

    // Snap viz + drive LOS for this slice's changes, then clear the buffer.
    // `changedThisSlice` is reported back purely as caller diagnostics — the
    // route line / animation subscribe to cells-changed like everyone else
    // and coalesce their (expensive) rebuild to the end of the sweep
    // themselves; nothing here needs to re-snap them.
    const changedThisSlice = this.terrainSweepChanged.length;
    if (changedThisSlice > 0) {
      this.aggregateViz.refreshPositions();
      this.emitCellsChanged(this.terrainSweepChanged.slice());
      this.terrainSweepChanged.length = 0;
    }

    if (done) {
      const total = queue.length;
      const skipped = this.sampler.peekSkipCount;
      const raycasted = this.sampler.raycastCount;
      const skipRatio = total > 0 ? ((skipped / total) * 100).toFixed(1) : '0.0';
      const spanMs = performance.now() - this.terrainSweepStart;
      console.warn(
        `[PerfTrace] updateTerrainHeights: spanMs=${spanMs.toFixed(1)} ` +
        `slices=${this.terrainSweepSlices} | ` +
        `cells=${total} ` +
        `peekSkipped=${skipped} (${skipRatio}%) ` +
        `raycasted=${raycasted} ` +
        `promoted=${this.terrainSweepPromoted} ` +
        `refreshed=${this.terrainSweepRefreshed} ` +
        `peekAvailable=${this.sampler.terrainPeekLOD !== null}`
      );
      logGrid(
        'HEIGHT_UPDATE',
        `cells=${total} promoted=${this.terrainSweepPromoted} ` +
        `refreshed=${this.terrainSweepRefreshed} skipped=${skipped} slices=${this.terrainSweepSlices}`,
      );
      this.terrainSweepQueue = null;
    }

    return { done, processed, changed: changedThisSlice };
  }

  /** True while a budgeted terrain-refresh sweep is in flight. */
  isTerrainRefreshActive(): boolean {
    return this.terrainSweepQueue !== null;
  }

  /**
   * Drop an in-flight sweep without running its remaining cells. Used by
   * `clear()` on a location change — the queued cells belong to the grid that
   * is being torn down.
   */
  private abortTerrainHeightRefresh(): void {
    this.terrainSweepQueue = null;
    this.terrainSweepIndex = 0;
    this.terrainSweepChanged.length = 0;
  }

  /**
   * Subscribe to terrain-sample-change events (promote + refresh).
   *
   * More than one system depends on cell heights and each has to self-heal
   * as tiles stream in: per-tower LOS and its viz, and everything baked off
   * the cells (route line, markers). A list rather than a single slot —
   * the previous single-listener design is what left the route line
   * pinned to the heights it was first built with.
   *
   * @returns unsubscribe
   */
  addCellsChangedListener(listener: (changed: RouteCell[]) => void): () => void {
    this.cellsChangedListeners.push(listener);
    return () => {
      const i = this.cellsChangedListeners.indexOf(listener);
      if (i >= 0) this.cellsChangedListeners.splice(i, 1);
    };
  }

  /** Fan a change batch out to every subscriber. */
  private emitCellsChanged(changed: RouteCell[]): void {
    if (changed.length === 0) return;
    for (const listener of this.cellsChangedListeners) listener(changed);
  }

  /**
   * Retry sampling for cells that have never had a real raycast hit
   * (`state === 'unsampled'`). Cheap — only walks the unsampled subset.
   *
   * Intended to be called from tile-load-end callbacks so cells self-heal
   * as tiles stream in, without re-sampling already-stable cells.
   *
   * Triggers `onCellsChanged` and refreshes the global viz mesh when at
   * least one cell flipped from `unsampled` → `stable`.
   */
  retryUnsampledCells(): { promoted: number } {
    if (!this.sampler.columnSampler) {
      return { promoted: 0 };
    }

    const promoted: RouteCell[] = [];
    let totalUnsampled = 0;

    for (const cell of this.cells.values()) {
      // tiles stream after ground tiles). Retry it for any cell that needs it.

      if (cell.sample.state !== 'unsampled') continue;
      totalUnsampled++;
      if (this.sampler.sampleCellY(cell)) {
        promoted.push(cell);
      }
    }

    logGrid(
      'HEIGHT_UPDATE',
      `retryUnsampled unsampledBefore=${totalUnsampled} promoted=${promoted.length}`,
    );

    if (promoted.length === 0) return { promoted: 0 };

    this.aggregateViz.refreshPositions();
    this.emitCellsChanged(promoted);
    return { promoted: promoted.length };
  }

  /**
   * Schmal-Variante von `refineCellsInRadius`: ruft `sampleCellY` NUR
   * für Cells im Radius, die noch nicht `stable` sind. Skip-Pfad für
   * bereits-gesampelte Cells = kein Raycast.
   *
   * Use case: per-frame Build-Preview-Aufrufe, wo wir Cells in der
   * Cursor-Region zu `stable` bringen müssen damit sie in der Viz
   * erscheinen, aber wir keine LOD-Upgrades für bereits stabile Cells
   * brauchen (Y-Drift durch LOD bewegt sich im Sub-Meter-Bereich, was
   * für die Coverage-Viz und LOS-Raycasts irrelevant ist).
   *
   * Tile-Streaming-getriebene LOD-Upgrades laufen weiterhin über die
   * volle `refineCellsInRadius` aus dem Tile-Load-End-Pfad.
   */
  promoteUnsampledCellsInRadius(x: number, z: number, radius: number): { promoted: number } {
    if (!this.sampler.columnSampler) {
      return { promoted: 0 };
    }
    const rangeSq = radius * radius;
    const promoted: RouteCell[] = [];

    for (const cell of this.cells.values()) {
      if (cell.heightSampled) continue;
      const distSq = (cell.x - x) ** 2 + (cell.z - z) ** 2;
      if (distSq > rangeSq) continue;
      if (this.sampler.sampleCellY(cell)) {
        promoted.push(cell);
      }
    }

    if (promoted.length > 0) {
      this.aggregateViz.refreshPositions();
      this.emitCellsChanged(promoted);
    }

    return { promoted: promoted.length };
  }

  /**
   * Locally refine cell-Y for all cells within `radius` of (x, z). Walks
   * the candidate set, calls `sampleCellY` on each — promoting unsampled
   * cells and refreshing stable cells if the tile-LOD improved.
   *
   * Cheap relative to a full grid sweep: only cells inside the radius
   * are touched. Used right before tower placement / preview so the
   * tower's range gets the freshest possible per-cell heights without
   * waiting for a global tile-load-driven refresh.
   *
   * Returns counts for logging / verification. Triggers viz refresh +
   * the cells-changed listeners when at least one cell changed its sample
   * (promoted or refreshed).
   */
  refineCellsInRadius(x: number, z: number, radius: number): { promoted: number; refreshed: number; inRange: number } {
    if (!this.sampler.columnSampler) {
      return { promoted: 0, refreshed: 0, inRange: 0 };
    }
    const rangeSq = radius * radius;
    const changed: RouteCell[] = [];
    let promoted = 0;
    let inRange = 0;

    for (const cell of this.cells.values()) {
      const distSq = (cell.x - x) ** 2 + (cell.z - z) ** 2;
      if (distSq > rangeSq) continue;
      inRange++;
      const wasUnsampled = !cell.heightSampled;
      if (this.sampler.sampleCellY(cell)) {
        changed.push(cell);
        if (wasUnsampled) promoted++;
      }
    }
    const refreshed = changed.length - promoted;

    logGrid(
      'REFINE',
      `at=(${x.toFixed(1)},${z.toFixed(1)}) r=${radius.toFixed(1)} inRange=${inRange} promoted=${promoted} refreshed=${refreshed}`,
    );

    // A refresh moves terrainHeight just like a promotion. Reporting only
    // promotions left every other tower covering a refreshed cell with LOS
    // against the old height for good: the peek-skip in sampleCellY keeps
    // the next sweep from ever flagging that cell again.
    if (changed.length > 0) {
      this.aggregateViz.refreshPositions();
      this.emitCellsChanged(changed);
    }

    return { promoted, refreshed, inRange };
  }

  /**
   * Iterate only the grid cells whose centre can lie within `range` of
   * (centerX, centerZ), using the integer cell-key index. Replaces a full
   * Map scan (O(total cells), tens of thousands) with O(cells in the
   * bounding box). Callers still do the exact squared-distance check. No
   * margin needed: a cell's centre sits half a cell inside its own index, so
   * a centre within range always has an index inside the floored box.
   *
   * Safe for both registerTower and registerTowerIncremental: tower range is
   * monotonic non-decreasing (range upgrades only grow; terrain-promotion
   * recompute keeps range), so the new range's box always covers every cell
   * that previously held this tower's entry — there are no stale cells
   * outside the box to clean up.
   */
  private *cellsInRange(centerX: number, centerZ: number, range: number): IterableIterator<RouteCell> {
    const gx0 = this.cellIndex(centerX - range);
    const gx1 = this.cellIndex(centerX + range);
    const gz0 = this.cellIndex(centerZ - range);
    const gz1 = this.cellIndex(centerZ + range);
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const cell = this.cells.get(this.intCellKey(gx, gz));
        if (cell) yield cell;
      }
    }
  }

  /**
   * Register a tower and compute LOS for all cells within range.
   * Pre-computes ground LOS and/or air LOS depending on the tower's
   * targeting capabilities. Samples terrain at registration time
   * (tiles are expected to be loaded) for accurate LOS.
   *
   * Visible cells are the UNION of ground- and air-visible cells: a cell
   * counts as visible if the tower can see *something* in it (ground level
   * OR the air sample altitude), so the tower-targeting fast path picks up
   * enemies of either type.
   *
   * @param towerId Tower unique ID
   * @param towerX Tower X position (local coordinates)
   * @param towerZ Tower Z position (local coordinates)
   * @param range Tower targeting range
   * @param ctx GPU-cube resolve context (built by caller via TowerShadowMapper)
   * @param canTargetGround Whether tower targets ground enemies (default true)
   * @param canTargetAir Whether tower targets air enemies (default false)
   * @returns Array of cells visible from this tower (ground or air)
   */
  registerTower(
    towerId: string,
    towerX: number,
    towerZ: number,
    range: number,
    ctx: LosResolveContext,
    canTargetGround = true,
    canTargetAir = false
  ): RouteCell[] {
    const visibleCells: RouteCell[] = [];
    const changed: RouteCell[] = [];
    const rangeSq = range * range;
    const tipX = ctx.referencePos.x;
    const tipY = ctx.referencePos.y;
    const tipZ = ctx.referencePos.z;

    for (const cell of this.cellsInRange(towerX, towerZ, range)) {
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      if (distSq > rangeSq) continue;

      // Try to refresh terrain height from current tile state via the
      // single-source-of-truth sampler. When the raycast fails, the cell
      // keeps its previous terrainHeight (anchor fallback) — register the
      // cell defensively so a later terrain promotion via
      // the cells-changed listeners can recompute LOS for it instead of
      // leaving holes in tower coverage.
      if (this.sampler.sampleCellY(cell)) changed.push(cell);

      const atTower = distSq < 0.01;

      // Ground visibility — GPU-cube sample at cell.terrainHeight + 1.5m
      let groundVisible = false;
      if (canTargetGround) {
        if (atTower) {
          groundVisible = true;
        } else {
          const targetY = cell.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset;
          groundVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx);
        }
        cell.towerVisibility.set(towerId, groundVisible);
      }

      // Air visibility — GPU-cube sample at getAirTargetY(cell) (terrain + 15m)
      let airVisible = false;
      if (canTargetAir) {
        if (atTower) {
          airVisible = true;
        } else {
          const targetY = getAirTargetY(cell);
          airVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx);
        }
        cell.airVisibility.set(towerId, airVisible);
      }

      if (groundVisible || airVisible) {
        visibleCells.push(cell);
      }
    }

    // Tower-reg re-sampled cell.terrainHeight for each visited cell — refresh
    // the global viz so its mesh positions match the new cached values,
    // preventing a visible Y-drift between global overlay and per-tower
    // overlay for the same cells.
    this.aggregateViz.refreshPositions();

    // Other towers covering a moved cell still answer for its old height.
    // Reported only now, after the loop: `ctx` is the shared cubemap, and a
    // listener that re-rendered it would change what the rest of the loop
    // samples. This tower's own answers are current already.
    this.emitCellsChanged(changed);

    return visibleCells;
  }

  /**
   * Re-register a tower after a range change (e.g. range upgrade) without
   * discarding existing LOS data.
   *
   * Behaves like `registerTower`, but for cells already having an entry for
   * this tower (in either visibility map), the cached value is reused — no
   * raycast. Except where the sampling in this very call moved the cell's
   * height: that answer was for the old height and gets re-resolved. Cells
   * outside the new range with a stale entry get cleaned up.
   *
   * This means a range-upgrade only raycasts the *new* cells (the annulus
   * between old and new range), not the entire disc.
   */
  registerTowerIncremental(
    towerId: string,
    towerX: number,
    towerZ: number,
    range: number,
    ctx: LosResolveContext,
    canTargetGround = true,
    canTargetAir = false,
  ): RouteCell[] {
    const visibleCells: RouteCell[] = [];
    const changed: RouteCell[] = [];
    const rangeSq = range * range;
    const tipX = ctx.referencePos.x;
    const tipY = ctx.referencePos.y;
    const tipZ = ctx.referencePos.z;

    for (const cell of this.cellsInRange(towerX, towerZ, range)) {
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      const inRange = distSq <= rangeSq;

      if (!inRange) {
        // In-box but outside the exact circle — clean up any stale entry.
        cell.towerVisibility.delete(towerId);
        cell.airVisibility.delete(towerId);
        continue;
      }

      // Refresh heights via single-source-of-truth sampler. If raycast
      // fails, the cached value is kept and a later promotion via
      // the cells-changed listeners will recompute LOS for this cell.
      // If it moved the height, the cached answers are for the old one.
      if (this.sampler.sampleCellY(cell)) {
        changed.push(cell);
        cell.towerVisibility.delete(towerId);
        cell.airVisibility.delete(towerId);
      }

      const atTower = distSq < 0.01;

      // Ground visibility — reuse cached value if present, otherwise GPU-sample
      let groundVisible = false;
      if (canTargetGround) {
        if (cell.towerVisibility.has(towerId)) {
          groundVisible = cell.towerVisibility.get(towerId)!;
        } else if (atTower) {
          groundVisible = true;
          cell.towerVisibility.set(towerId, groundVisible);
        } else {
          const targetY = cell.terrainHeight + LOS_VIZ_CONFIG.groundSampleYOffset;
          groundVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx);
          cell.towerVisibility.set(towerId, groundVisible);
        }
      } else {
        // Capability removed — drop any stale entry
        cell.towerVisibility.delete(towerId);
      }

      // Air visibility — reuse cached value if present, otherwise GPU-sample
      let airVisible = false;
      if (canTargetAir) {
        if (cell.airVisibility.has(towerId)) {
          airVisible = cell.airVisibility.get(towerId)!;
        } else if (atTower) {
          airVisible = true;
          cell.airVisibility.set(towerId, airVisible);
        } else {
          const targetY = getAirTargetY(cell);
          airVisible = isCubeVisible(tipX, tipY, tipZ, cell.x, targetY, cell.z, ctx);
          cell.airVisibility.set(towerId, airVisible);
        }
      } else {
        cell.airVisibility.delete(towerId);
      }

      if (groundVisible || airVisible) {
        visibleCells.push(cell);
      }
    }

    // Same rationale as in registerTower — incremental re-sampling may have
    // updated cell.terrainHeight, keep the global viz mesh in sync.
    this.aggregateViz.refreshPositions();

    // As in registerTower: report the moved cells once the loop is done.
    this.emitCellsChanged(changed);

    return visibleCells;
  }

  /**
   * Unregister a tower (remove LOS data from all cells)
   * @param towerId Tower ID to unregister
   */
  unregisterTower(towerId: string): void {
    for (const cell of this.cells.values()) {
      cell.towerVisibility.delete(towerId);
      cell.airVisibility.delete(towerId);
    }
  }

  /**
   * Update enemy position in the grid
   * Handles cell transitions efficiently
   * @param enemy Enemy entity
   * @param localX New X position (local coordinates)
   * @param localZ New Z position (local coordinates)
   */
  updateEnemyPosition(enemy: Enemy, localX: number, localZ: number): void {
    const newCellKey = this.intCellKey(this.cellIndex(localX), this.cellIndex(localZ));

    // Same cell as this enemy's last evaluation, same generation: provably a
    // no-op, and the common case (a 2 m cell takes dozens of sub-steps to
    // cross). Inside the corridor enemyCellKeys already holds this key;
    // outside it the cell still does not exist (cells only change with a
    // generation bump) and there is no entry to drop. The memo lives on the
    // enemy, so this costs no string-keyed lookup; for an enemy outside the
    // corridor it replaces three Map probes per sub-step.
    if (enemy.routeCellGen === this.generation && enemy.routeCellKey === newCellKey) return;

    const currentCellKey = this.enemyCellKeys.get(enemy.id);
    const newCell = this.cells.get(newCellKey);

    // If enemy is in same cell, nothing to do
    if (currentCellKey !== newCellKey) {
      // Remove from old cell (key 0 is the valid cell (0,0) — test definedness, not truthiness)
      if (currentCellKey !== undefined) {
        const oldCell = this.cells.get(currentCellKey);
        if (oldCell) {
          oldCell.enemies.delete(enemy);
        }
      }

      // Add to new cell (if cell exists in our grid)
      if (newCell) {
        newCell.enemies.add(enemy);
        this.enemyCellKeys.set(enemy.id, newCellKey);
      } else if (this.enemyCellKeys.has(enemy.id)) {
        // Enemy moved outside tracked corridor cells — no longer targetable by route-grid towers
        this.enemyCellKeys.delete(enemy.id);
      }
    }

    enemy.routeCellGen = this.generation;
    enemy.routeCellKey = newCellKey;
    enemy.routeCell = newCell;
  }

  /**
   * Remove enemy from grid (call when enemy dies or is removed)
   * @param enemy Enemy entity
   */
  removeEnemy(enemy: Enemy): void {
    // Drop the memo as well: a later updateEnemyPosition() must re-add the
    // enemy rather than take the same-cell shortcut.
    enemy.routeCellGen = -1;
    enemy.routeCell = undefined;
    const currentCellKey = this.enemyCellKeys.get(enemy.id);
    if (currentCellKey !== undefined) {
      const cell = this.cells.get(currentCellKey);
      if (cell) {
        cell.enemies.delete(enemy);
      }
      this.enemyCellKeys.delete(enemy.id);
    }
  }

  /**
   * Get enemies for tower targeting (from visible cells)
   * @param visibleCells Array of cells the tower can see
   * @returns Array of alive enemies in those cells
   */
  getEnemiesForTower(visibleCells: RouteCell[], out?: Enemy[]): Enemy[] {
    const enemies = out ?? [];
    if (out) out.length = 0;
    for (const cell of visibleCells) {
      for (const enemy of cell.enemies) {
        if (enemy.alive) {
          enemies.push(enemy);
        }
      }
    }
    return enemies;
  }

  /**
   * Get cell at local coordinates
   * @param localX Local X coordinate
   * @param localZ Local Z coordinate
   * @returns RouteCell or undefined if not in grid
   */
  getCellAt(localX: number, localZ: number): RouteCell | undefined {
    return this.cells.get(this.intCellKey(this.cellIndex(localX), this.cellIndex(localZ)));
  }

  /**
   * Single source of truth for ground terrain Y at an arbitrary local
   * (x, z) position. Used by enemy movement (per-frame), spawn
   * initialization and the red route-line builder so every consumer
   * reads the SAME height the LOS pipeline reads.
   *
   * Resolution chain:
   *   1. Cell at (x,z) with `heightSampled === true` → `cell.terrainHeight`.
   *   2. `estimateTerrainY` (3×3 then 5×5 median of stable neighbours).
   *   3. `null` when no stable neighbour exists at all.
   *
   * Lookup is a single `Map.get` + 2 floors → ~50 ns. Safe to call
   * per-frame for every enemy.
   */
  getGroundLocalYAt(localX: number, localZ: number): number | null {
    const cell = this.cells.get(this.intCellKey(this.cellIndex(localX), this.cellIndex(localZ)));
    if (cell && cell.heightSampled) return cell.terrainHeight;
    return this.estimateTerrainY(localX, localZ);
  }

  /**
   * getGroundLocalYAt() for an enemy whose position was just passed to
   * updateEnemyPosition(): reuses the cell that call looked up instead of
   * probing `cells` again. The memo holds `cells.get(key)` from the current
   * generation, and the cell set does not change within one, so the result
   * is identical. Falls back to the lookup when the memo does not cover
   * this position.
   */
  getGroundLocalYForEnemy(enemy: Enemy, localX: number, localZ: number): number | null {
    if (enemy.routeCellGen === this.generation) {
      if (this.intCellKey(this.cellIndex(localX), this.cellIndex(localZ)) === enemy.routeCellKey) {
        const cell = enemy.routeCell;
        if (cell && cell.heightSampled) return cell.terrainHeight;
        return this.estimateTerrainY(localX, localZ);
      }
    }
    return this.getGroundLocalYAt(localX, localZ);
  }

  /**
   * Get all alive enemies within a radius of a local position
   * Optimized: O(cells_in_radius) instead of O(all_enemies)
   *
   * @param localX Center X position (local coordinates)
   * @param localZ Center Z position (local coordinates)
   * @param radiusMeters Radius in meters
   * @param excludeId Optional enemy ID to exclude (e.g., the primary target)
   * @returns Array of alive enemies within radius
   */
  getEnemiesInRadius(
    localX: number,
    localZ: number,
    radiusMeters: number,
    excludeId?: string,
    out?: Enemy[]
  ): Enemy[] {
    if (out) out.length = 0;
    if (!this.coordinateSync) return out ?? [];

    const enemies = out ?? [];
    const radiusSq = radiusMeters * radiusMeters;

    // Calculate cell range to check
    const cellRadius = Math.ceil(radiusMeters * this.INV_CELL_SIZE);
    const centerCellX = this.cellIndex(localX);
    const centerCellZ = this.cellIndex(localZ);

    // Iterate only over cells within radius
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dz = -cellRadius; dz <= cellRadius; dz++) {
        const cellKey = this.intCellKey(centerCellX + dx, centerCellZ + dz);
        const cell = this.cells.get(cellKey);
        if (!cell) continue;

        // Check each enemy in cell
        for (const enemy of cell.enemies) {
          if (!enemy.alive) continue;
          if (excludeId && enemy.id === excludeId) continue;

          // Convert enemy geo position to local for precise distance check.
          // Use the allocation-free *Into variant with a reused scratch —
          // this runs for every enemy in every scanned cell.
          const enemyLocal = this.coordinateSync.geoToLocalSimpleInto(
            enemy.position.lat,
            enemy.position.lon,
            0,
            this._radiusScanScratch
          );
          const distSq = (enemyLocal.x - localX) ** 2 + (enemyLocal.z - localZ) ** 2;
          if (distSq <= radiusSq) {
            enemies.push(enemy);
          }
        }
      }
    }

    return enemies;
  }

  /**
   * Get all alive enemies within a radius of a geo position
   * Convenience method that converts geo to local coordinates
   *
   * @param center Center point (lat, lon)
   * @param radiusMeters Radius in meters
   * @param excludeId Optional enemy ID to exclude
   * @param out Optional array to fill instead of allocating one
   * @returns Array of alive enemies within radius
   */
  getEnemiesInRadiusGeo(
    center: GeoPosition,
    radiusMeters: number,
    excludeId?: string,
    out?: Enemy[]
  ): Enemy[] {
    if (!this.coordinateSync) {
      console.warn('[GlobalRouteGrid] getEnemiesInRadiusGeo called before initialization');
      if (out) out.length = 0;
      return out ?? [];
    }

    const local = this.coordinateSync.geoToLocalSimple(center.lat, center.lon, center.height ?? 0);
    return this.getEnemiesInRadius(local.x, local.z, radiusMeters, excludeId, out);
  }

  /**
   * Check if position is visible from tower for ground targets (uses pre-computed LOS)
   * @param towerId Tower ID
   * @param localX Target X (local coordinates)
   * @param localZ Target Z (local coordinates)
   * @returns true if visible, false if blocked, undefined if not in grid
   */
  isPositionVisibleFromTower(towerId: string, localX: number, localZ: number): boolean | undefined {
    const cell = this.getCellAt(localX, localZ);
    if (!cell) return undefined;
    return cell.towerVisibility.get(towerId);
  }

  /**
   * Check if position is visible from tower for air targets — pre-computed
   * against {@link getAirTargetY}. Distinct from ground visibility because a
   * tall building can block one altitude but not the other.
   * @returns true if visible, false if blocked, undefined if not in grid /
   *          tower has no air-LOS data registered
   */
  isAirPositionVisibleFromTower(towerId: string, localX: number, localZ: number): boolean | undefined {
    const cell = this.getCellAt(localX, localZ);
    if (!cell) return undefined;
    return cell.airVisibility.get(towerId);
  }


  /**
   * Get grid statistics
   */
  getStats(): { totalCells: number; trackedEnemies: number; occupiedCells: number } {
    let occupiedCells = 0;
    for (const cell of this.cells.values()) {
      if (cell.enemies.size > 0) occupiedCells++;
    }
    return {
      totalCells: this.cells.size,
      trackedEnemies: this.enemyCellKeys.size,
      occupiedCells,
    };
  }

  // ========================================
  // DIAGNOSTICS: __rg.* debug API, see route-grid-diagnostics.ts
  // ========================================

  /** Sample-Zustand aller Cells im Ausschnitt, siehe `collectCellsInBox`. */
  dumpCellsInBox(box: RouteCellBox): RouteCellDump[] {
    return collectCellsInBox(this.cells, box);
  }

  /** Histogramm-Zusammenfassung über alle Cells, siehe `summarizeCellSamples`. */
  dumpStats(): RouteGridSampleStats {
    return summarizeCellSamples(this.cells, this.sampler.sampleFrame);
  }

  /** Cells weit weg von ihrem Route-Anker, siehe `collectHeightOutliers`. */
  dumpOutliers(thresholdM = 20): RouteCellDump[] {
    return collectHeightOutliers(this.cells, thresholdM);
  }

  /** Fallback-Samples zurücksetzen und neu sampeln, siehe `resetFallbackHeights`. */
  resetHeightsAndRetry(): HeightResetResult {
    return resetFallbackHeights(this.cells, this.sampler, () => this.retryUnsampledCells());
  }

  // ========================================
  // VISUALIZATION: aggregate debug meshes, see route-grid-aggregate-viz.ts
  // ========================================

  /**
   * Create visualization mesh (InstancedMesh with shader)
   * Call once, then use updateVisualization() each frame for color updates only
   */
  createVisualization(): InstancedMesh {
    return this.aggregateViz.createVisualization();
  }

  /** Create the air-layer mirror of the global aggregate viz. */
  createAirVisualization(): InstancedMesh {
    return this.aggregateViz.createAirVisualization();
  }

  /**
   * Update visualization colors only (call each frame when visible)
   */
  updateVisualization(): void {
    this.aggregateViz.updateVisualization();
  }

  /**
   * Update animation time (call each frame)
   * @param deltaTime Delta time in milliseconds
   */
  updateAnimation(deltaTime: number): void {
    this.aggregateViz.updateAnimation(deltaTime);
  }

  /** Get visualization mesh */
  getVisualization(): InstancedMesh | null {
    return this.aggregateViz.getVisualization();
  }

  /** Dispose ground visualization resources. */
  disposeVisualization(): void {
    this.aggregateViz.disposeVisualization();
  }

  /** Dispose air-layer aggregate viz. */
  disposeAirVisualization(): void {
    this.aggregateViz.disposeAirVisualization();
  }

  // ========================================
  // CELLS-IN-RANGE QUERY (GPU-LOS-Pipeline)
  // ========================================

  /**
   * Liefert alle Cells deren Center innerhalb `range` von (x, z) liegt
   * UND deren Terrain-Sample stabil ist. Wird von der GPU-LOS-Viz-
   * Pipeline (TowerLosViz / TowerLosLayerBuilder) als Cell-Set genutzt.
   */
  getCellsInRange(x: number, z: number, range: number): RouteCell[] {
    const rangeSq = range * range;
    const result: RouteCell[] = [];
    for (const cell of this.cells.values()) {
      if (!cell.heightSampled) continue;
      const distSq = (cell.x - x) ** 2 + (cell.z - z) ** 2;
      if (distSq <= rangeSq) result.push(cell);
    }
    return result;
  }

  /** Grid-Cell-Size (m). */
  getCellSize(): number {
    return this.CELL_SIZE;
  }


  /**
   * Clear all data
   */
  clear(): void {
    this.cells.clear();
    this.enemyCellKeys.clear();
    this.generation = GlobalRouteGrid.nextGeneration++;
    // Abandon any sweep in flight. Its queue holds hard references to the
    // cells we just dropped, and a driver that keeps stepping would raycast
    // those orphans with the NEW location's sampler and emit cells-changed
    // for cells that are no longer in the grid.
    this.abortTerrainHeightRefresh();
    this.disposeVisualization();
    this.disposeAirVisualization();
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clear();
    this.sampler.columnSampler = null;
    this.sampler.terrainPeekLOD = null;
    this.coordinateSync = null;
  }
}
