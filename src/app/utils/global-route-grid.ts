import { InstancedMesh, Vector3 } from 'three';
import { Enemy } from '../entities/enemy.entity';
import { GeoPosition, RouteWaypoint } from '../models/game.types';
import { CoordinateSync } from '../three-engine/renderers';
import type { ColumnSample, ColumnSampler, TerrainPeekLOD } from '../three-engine/column-sample';
import { LosResolveContext } from './gpu-cube-resolve';
import { RouteCell } from './route-cell';
import { resolveTowerLos, resolveTowerLosIncremental } from './route-grid-los';
import { RouteCellLattice, claimRouteCells } from './route-grid-builder';
import {
  HeightResetResult,
  RouteCellBox,
  RouteCellDump,
  RouteCellProbe,
  RouteCellSpot,
  RouteGridSampleStats,
  RouteGridView,
  TowerRangeReport,
  collectCellsInBox,
  collectCentreLineCells,
  collectHeightOutliers,
  findCorridorHoles,
  probeCellsAround,
  resetFallbackHeights,
  summarizeCellSamples,
  summarizeTowerRange,
} from './route-grid-diagnostics';
import { RouteGridAggregateViz } from './route-grid-aggregate-viz';
import { RouteCellSampler } from './route-cell-sampler';
import { WalkGround, cellWalkable, judgeWalk, portalGround } from './corridor-walk';
import type { BandStation } from './corridor-band';
import { logGrid } from './route-grid-log';
import { corridorTrace } from './corridor-trace';
import type { RouteBodyContact } from './route-body';

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

  /**
   * Cell size and keying rule for route-grid-builder, which creates the
   * cells: the intCellKey / cellIndex every lookup here uses as well.
   */
  private readonly lattice: RouteCellLattice = {
    cellSize: this.CELL_SIZE,
    index: (v) => this.cellIndex(v),
    key: (gx, gz) => this.intCellKey(gx, gz),
  };

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

  /**
   * Terrain-Sampling der Cells (`sampleCellY`) mit Proben und Sweep-Zählern.
   * A tunnel portal takes the backbone of the band station there instead of
   * a hit on a roof over the street (portalGround).
   */
  private readonly sampler = new RouteCellSampler(
    (cell, minDepth) => this.medianOfStableNeighbourY(cell, minDepth),
    (x, z, y) => portalGround(x, z, y, this.walkGround),
  );

  /**
   * The band station nearest to a local point, set by PathAndRouteService
   * once it has built the band of the routes in use (setBand); null before
   * that, and while the routes are being replaced.
   */
  private bandStation: ((x: number, z: number) => BandStation | null) | null = null;

  /**
   * What the walk check reads off this grid (corridor-walk.ts): the
   * sampler's column probe, beside a seam as well, and the band of the
   * routes in use.
   */
  private readonly walkGround: WalkGround = {
    column: (x, z) => this.sampler.columnNear(x, z),
    station: (x, z) => this.bandStation?.(x, z) ?? null,
  };

  /**
   * Where the walkable band of the routes in use stands: its station
   * nearest to a local point (PathAndRouteService.bandStationAt). The cells
   * of a tunnel portal and the diagnosis of `__corridor.pick()` read it;
   * null takes the band away again.
   */
  setBand(stationAt: ((x: number, z: number) => BandStation | null) | null): void {
    this.bandStation = stationAt;
  }

  /**
   * The column at local (x, z) as the cells and the walk check read it: the
   * engine's cached column probe, half a metre beside it on a seam. Null
   * before initialize() and where no tile is. The walkable band of the
   * routes is built on these columns (PathAndRouteService.buildBands,
   * corridor-band.ts).
   */
  columnNear(x: number, z: number): ColumnSample | null {
    return this.sampler.columnNear(x, z);
  }

  /** cellWalkable for one cell of this grid, for the diagnostics. */
  private readonly walkable = (cell: RouteCell) => cellWalkable(cell, this.walkGround);

  /** judgeWalk for one cell of this grid, for `__corridor.pick()`. */
  private readonly walkJudgement = (cell: RouteCell) => judgeWalk(cell, this.walkGround);

  /** Coordinate sync for geo <-> local conversions */
  private coordinateSync: CoordinateSync | null = null;

  /** Aggregat-Debug-Viz (`grid` / `gridAir`), liest dieselbe Cell-Map. */
  private readonly aggregateViz = new RouteGridAggregateViz(this.cells, this.CELL_SIZE, (cell) => this.overlayHeight(cell));

  /**
   * Height the overlay draws a cell at: its sample, or for a cell without
   * one the median of its sampled neighbours, so it shows beside the others
   * instead of at the route anchor, which can be far off.
   */
  private overlayHeight(cell: RouteCell): number {
    if (cell.heightSampled) return cell.terrainHeight;
    return this.estimateTerrainY(cell.x, cell.z) ?? cell.terrainHeight;
  }

  /** Reused sample buffer for medianOfStableNeighbourY. */
  private readonly _medianScratch: number[] = [];

  /**
   * Median `terrainHeight` of the 8 adjacent stable cells of the same
   * surface sampled from a tile at least `minDepth` deep. Returns `null`
   * when fewer than 3 such neighbours exist: not enough signal for a
   * meaningful sanity check. Used by `sampleCellY` to reject hits that
   * diverge wildly from the local terrain. Same surface: a street under a
   * bridge lies a deck height below the deck cells around it.
   */
  private medianOfStableNeighbourY(cell: RouteCell, minDepth = 0): number | null {
    const gx = this.cellIndex(cell.x);
    const gz = this.cellIndex(cell.z);
    const samples = this._medianScratch;
    samples.length = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        const n = this.cells.get(this.intCellKey(gx + dx, gz + dz));
        if (n && n.sample.state === 'stable' && n.surface === cell.surface && n.sample.tileDepth >= minDepth) {
          samples.push(n.terrainHeight);
        }
      }
    }
    if (samples.length < 3) return null;
    samples.sort(ascending);
    return samples[Math.floor(samples.length / 2)];
  }

  /** Opposite neighbours fillGaps interpolates between: west-east, south-north and the two diagonals. */
  private static readonly FILL_PAIRS: readonly (readonly [number, number])[] = [[1, 0], [0, 1], [1, 1], [1, -1]];

  /**
   * Heights for the cells among `cells` without a usable sample of their
   * own: an unsampled cell, or a stable one more than
   * RouteCellSampler.OUTLIER_M off the median of its neighbours sampled at
   * least as deep (a hit that got in before those neighbours had one).
   *
   * - Between stable cells of its surface on opposite sides, such a cell
   *   takes the mean over those pairs and is `filled`
   *   (RouteCellSampler.fill): a seam between two tile meshes that no
   *   column near the cell got past.
   * - Without such a pair, where at least three stable cells of its surface
   *   touch it, it takes their median and is `filled` as well: a cell at the
   *   edge of the corridor whose columns meet nothing, under the eaves of an
   *   arcade or a jetty, where a column from above meets only the underside
   *   of the mesh (playtest 2026-09-16, Rothenburg, seven cells before the
   *   Laubengang of the town hall). The band reached the cells beside it on
   *   the ground and passed over this one (corridor-band.ts, walkSide), and
   *   the fallback level found no column there either. Three measured cells
   *   around it bound its height as a pair does: along the edge the middle
   *   one, across it the cell next to it.
   * - Only stable cells count, so a fill never spreads from one filled cell
   *   to the next.
   * - A stable one with neither loses its sample.
   * - Tunnel cells take their height from the portals and are left alone.
   *
   * O(cells given), eight neighbour lookups each.
   * @returns the cells whose height changed
   */
  private fillGaps(cells: Iterable<RouteCell>): RouteCell[] {
    const changed: RouteCell[] = [];
    for (const cell of cells) {
      if (cell.surface === 'tunnel') continue;
      if (cell.sample.state === 'stable') {
        const median = this.medianOfStableNeighbourY(cell, cell.sample.tileDepth);
        if (median === null || Math.abs(cell.terrainHeight - median) <= RouteCellSampler.OUTLIER_M) continue;
      }
      const y = this.heightBetweenNeighbours(cell) ?? this.medianOfStableNeighbourY(cell);
      if (y !== null) {
        if (this.sampler.fill(cell, y)) changed.push(cell);
      } else if (cell.sample.state === 'stable') {
        this.sampler.resetToUnsampled(cell);
        changed.push(cell);
      }
    }
    return changed;
  }

  /** Mean over the opposite pairs of stable neighbours of `cell`'s surface around it, null without such a pair. */
  private heightBetweenNeighbours(cell: RouteCell): number | null {
    const gx = this.cellIndex(cell.x);
    const gz = this.cellIndex(cell.z);
    let sum = 0;
    let pairs = 0;
    for (const [dx, dz] of GlobalRouteGrid.FILL_PAIRS) {
      const a = this.cells.get(this.intCellKey(gx + dx, gz + dz));
      const b = this.cells.get(this.intCellKey(gx - dx, gz - dz));
      if (!a || !b || a.sample.state !== 'stable' || b.sample.state !== 'stable') continue;
      if (a.surface !== cell.surface || b.surface !== cell.surface) continue;
      sum += (a.terrainHeight + b.terrainHeight) / 2;
      pairs++;
    }
    return pairs > 0 ? sum / pairs : null;
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
   * Height per cell key, NaN for a cell without one: the cells a rebuild
   * starts from and ends with, for the corridor trace (cellDelta).
   */
  snapshotHeights(): Map<number, number> {
    const heights = new Map<number, number>();
    for (const cell of this.cells.values()) heights.set(cell.key, cell.heightSampled ? cell.terrainHeight : NaN);
    return heights;
  }

  /** Cells without a height, neither a sample of their own nor one filled in from their neighbours (fillGaps). */
  cellsWithoutHeight(): number {
    let count = 0;
    for (const cell of this.cells.values()) if (!cell.heightSampled) count++;
    return count;
  }

  /**
   * Generate grid cells from enemy routes and sample their terrain height.
   *
   * A cell belongs to the corridor if its centre lies within the half width
   * of a route segment on its side (`corridorLeft` / `corridorRight` of the
   * segment's start waypoint, see route-corridor.ts). Cell centres therefore
   * stay on the free street, the cells the centre line runs through belong
   * to it at any width, and every
   * point within `lateralLimit(halfWidth)` of the centre line on that side
   * lies in a cell: the cell containing it has its centre at most half a
   * cell diagonal further out. That is how far MovementComponent lets
   * enemies spread, so no enemy walks outside the cells towers look at.
   *
   * Cells of a segment on a bridge (`onBridge`) sample the deck, the top of
   * the column, instead of the ground under the bridge. A cell holds one
   * height: where the bridge and its approach meet, a cell takes the
   * surface of the segment it lies along, not of the one that reaches it
   * only with a round end; a cell both reach along their length (a street
   * under the bridge) stays on the ground (claimSegmentCells). Cells of the
   * route off a bridge end, up to DECK_APPROACH_M past it, take the hit of
   * their column nearest to the height the route carries there from the
   * bridge end (`approach`, deck-approach.ts).
   *
   * Cells of a segment in a tunnel or covered passage (`inTunnel`) take their
   * height between the ground just outside the two mouths of the stretch,
   * since their own column sees only the hill or the building above. A cell
   * a tunnel segment reaches is a tunnel cell, whatever else reaches it.
   * @param routes Array of route paths
   */
  generateFromRoutes(routes: RouteWaypoint[][]): void {
    const sync = this.coordinateSync;
    if (!sync || !this.sampler.columnSampler) {
      console.error('[GlobalRouteGrid] Cannot generate - not initialized');
      return;
    }

    const t0 = performance.now();
    this.cells.clear();
    this.enemyCellKeys.clear();
    this.generation = GlobalRouteGrid.nextGeneration++;
    this.cachedRoutes = routes;

    const alongClaims = new Set<number>();
    for (const route of routes) {
      if (route.length < 2) continue;
      const points = route.map((p) => sync.geoToLocalSimple(p.lat, p.lon, p.height ?? 0));
      claimRouteCells(this.cells, this.lattice, route, points, alongClaims);
    }

    // Sampled only once every segment has claimed its cells: which surface
    // a cell samples depends on all segments that reach it. Then the gaps
    // between sampled cells, see fillGaps.
    for (const cell of this.cells.values()) this.sampler.sampleCellY(cell);
    this.fillGaps(this.cells.values());

    const ms = performance.now() - t0;
    corridorTrace.log('grid.generate', { cells: this.cells.size, routes: routes.length, ms });
    corridorTrace.cost('grid.generate', ms);
  }

  /**
   * Retry sampling for cells that have no sample of their own
   * (`unsampled` or `filled`). Cheap: only walks that subset. A promotion
   * may close a gap next to a cell still waiting, see fillGaps.
   *
   * The corridor build calls it on the fallback level for the cells the
   * finest level gave no column (CorridorBuild); nothing else samples cells
   * after a build.
   */
  retryUnsampledCells(): { promoted: number } {
    if (!this.sampler.columnSampler) {
      return { promoted: 0 };
    }

    const promoted: RouteCell[] = [];
    const waiting: RouteCell[] = [];
    let totalUnsampled = 0;

    for (const cell of this.cells.values()) {
      // A filled cell has a height but no sample of its own: retried as well.
      if (cell.sample.state === 'stable') continue;
      totalUnsampled++;
      if (this.sampler.sampleCellY(cell)) {
        promoted.push(cell);
      } else {
        waiting.push(cell);
      }
    }

    logGrid(
      'HEIGHT_UPDATE',
      `retryUnsampled unsampledBefore=${totalUnsampled} promoted=${promoted.length}`,
    );

    if (promoted.length === 0) return { promoted: 0 };

    // The new samples may close gaps around the cells still waiting.
    this.fillGaps(waiting);
    this.aggregateViz.refreshPositions();
    return { promoted: promoted.length };
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
    return resolveTowerLos(
      this.cellsInRange(towerX, towerZ, range), towerId, towerX, towerZ, range, ctx, canTargetGround, canTargetAir,
    );
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
    return resolveTowerLosIncremental(
      this.cellsInRange(towerX, towerZ, range), towerId, towerX, towerZ, range, ctx, canTargetGround, canTargetAir,
    );
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

  // ========================================
  // BODIES ALONG THE ROUTE (Enemy.body, the ooze, see utils/route-body.ts)
  // ========================================

  /**
   * Enemies whose body lies along the route. They are in no cell: a body
   * covers dozens of them. Radius queries test the body instead
   * (getEnemiesInRadius), and TowerCombatService adds them to every tower's
   * candidates and aims at the nearest body point (BodyAim).
   */
  private readonly bodyEnemies: Enemy[] = [];
  private readonly _bodyContact: RouteBodyContact = { station: 0, offset: 0, distance: 0 };

  /** Track an enemy with a body (EnemyManager at its spawn). */
  addBodyEnemy(enemy: Enemy): void {
    if (enemy.body && !this.bodyEnemies.includes(enemy)) this.bodyEnemies.push(enemy);
  }

  removeBodyEnemy(enemy: Enemy): void {
    const i = this.bodyEnemies.indexOf(enemy);
    if (i >= 0) this.bodyEnemies.splice(i, 1);
  }

  /** The tracked enemies with a body, dead ones included until they are removed. */
  getBodyEnemies(): readonly Enemy[] {
    return this.bodyEnemies;
  }

  /** Whether a living body reaches within `radius` of local (x, z). */
  hasBodyWithin(x: number, z: number, radius: number): boolean {
    for (const enemy of this.bodyEnemies) {
      if (enemy.alive && enemy.body!.touches(x, z, radius, this._bodyContact)) return true;
    }
    return false;
  }

  /**
   * Bumped whenever the cells are rebuilt or dropped. Whoever keeps cells
   * across frames (BodyAim) compares it to know they are still the grid's.
   */
  getGeneration(): number {
    return this.generation;
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
   * The cell whose centre lies nearest to (localX, localZ) and no further
   * than `maxDistanceM`, or undefined when there is none. Scans the square of
   * grid spots around the point, O((maxDistance / cell size)²) lookups rather
   * than O(cells). Equal distances keep the first cell in scan order, so the
   * answer does not depend on how the cells were inserted.
   */
  findNearestCell(localX: number, localZ: number, maxDistanceM: number): RouteCell | undefined {
    const reach = Math.ceil(maxDistanceM * this.INV_CELL_SIZE);
    const centerX = this.cellIndex(localX);
    const centerZ = this.cellIndex(localZ);
    const maxSq = maxDistanceM * maxDistanceM;
    let best: RouteCell | undefined;
    let bestSq = Infinity;
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const cell = this.cells.get(this.intCellKey(centerX + dx, centerZ + dz));
        if (!cell) continue;
        const distSq = (cell.x - localX) ** 2 + (cell.z - localZ) ** 2;
        if (distSq <= maxSq && distSq < bestSq) {
          best = cell;
          bestSq = distSq;
        }
      }
    }
    return best;
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
   * getGroundLocalYAt() with the tile error behind it: a sampled cell's
   * height and the geometric error of the tile it came from, or the
   * neighbour estimate with an infinite error. For callers that have to tell
   * a fine-tile height from a coarse one (the overview frame).
   */
  getGroundSampleAt(localX: number, localZ: number): { y: number; tileError: number } | null {
    const cell = this.cells.get(this.intCellKey(this.cellIndex(localX), this.cellIndex(localZ)));
    if (cell && cell.heightSampled) return { y: cell.terrainHeight, tileError: cell.sample.tileGeometricError };
    const y = this.estimateTerrainY(localX, localZ);
    return y === null ? null : { y, tileError: Infinity };
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

    // A body along the route that reaches into the circle is in it, once.
    // Its hit goes on the point it reaches in with, so the splash or strike
    // that asked lands there (RouteBody.hit, hitDistanceM for the falloff).
    for (const enemy of this.bodyEnemies) {
      if (!enemy.alive || (excludeId && enemy.id === excludeId)) continue;
      const body = enemy.body!;
      const contact = this._bodyContact;
      if (!body.touches(localX, localZ, radiusMeters, contact)) continue;
      const st = body.stations;
      const k = contact.station;
      const groundY = this.getGroundLocalYAt(
        st.x[k] + st.rightX[k] * contact.offset,
        st.z[k] + st.rightZ[k] * contact.offset,
      ) ?? enemy.transform.terrainHeight - st.originHeight;
      body.setHit(k, contact.offset, groundY);
      body.hitDistanceM = contact.distance;
      enemies.push(enemy);
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

  /**
   * Grid positions within `range` of (x, z) that have no cell while the four
   * positions next to them along the axes all have one: holes in the
   * corridor, which the LOS display would show as gaps in the street. Every
   * segment claims a convex region of cells, so there should be none.
   */
  findHolesInRange(x: number, z: number, range: number): RouteCellSpot[] {
    return findCorridorHoles(this.view, x, z, range);
  }

  /** What the grid holds in a tower's range, see `summarizeTowerRange`. */
  describeTowerRange(towerId: string, x: number, z: number, range: number): TowerRangeReport {
    const rangeSq = range * range;
    const inRange: RouteCell[] = [];
    for (const cell of this.cellsInRange(x, z, range)) {
      if ((cell.x - x) ** 2 + (cell.z - z) ** 2 <= rangeSq) inRange.push(cell);
    }
    return summarizeTowerRange(
      inRange, towerId, this.findHolesInRange(x, z, range), (cell) => this.medianOfStableNeighbourY(cell), this.walkable,
    );
  }

  /**
   * The cells the route centre lines run through within `range` of (x, z),
   * probed every half metre along each segment, and the spots on a centre
   * line without a cell. A row missing along the red line shows up here.
   */
  centreLineCells(x: number, z: number, range: number): { cells: RouteCell[]; missing: RouteCellSpot[] } {
    return collectCentreLineCells(this.view, x, z, range);
  }

  /** `describeTowerRange` for the centre line cells only; `holes` lists every centre spot without a cell. */
  describeCentreLine(towerId: string, x: number, z: number, range: number): TowerRangeReport {
    const { cells, missing } = this.centreLineCells(x, z, range);
    return summarizeTowerRange(cells, towerId, missing, (cell) => this.medianOfStableNeighbourY(cell), this.walkable);
  }

  /**
   * Every grid spot within `radius` of (x, z) and what the grid holds there,
   * nearest to the route line first, for `__corridor.pick()`. `towerId`
   * adds that tower's answers.
   */
  describeCellsAround(x: number, z: number, radius: number, towerId: string | null): RouteCellProbe[] {
    return probeCellsAround(this.view, x, z, radius, towerId, (cell) => this.medianOfStableNeighbourY(cell), this.walkJudgement);
  }

  /** The grid as the spatial probes in route-grid-diagnostics read it. Diagnostics only. */
  private get view(): RouteGridView {
    return { cells: this.cells, lattice: this.lattice, routes: this.cachedRoutes, sync: this.coordinateSync };
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
    this.bodyEnemies.length = 0;
    this.generation = GlobalRouteGrid.nextGeneration++;
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
