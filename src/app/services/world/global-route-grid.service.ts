import { Injectable } from '@angular/core';
import { GlobalRouteGrid } from '../../utils/global-route-grid';
import { RouteCell } from '../../utils/route-cell';
import { Enemy } from '../../entities/enemy.entity';
import { GeoPosition, RouteWaypoint } from '../../models/game.types';
import { CoordinateSync } from '../../three-engine/renderers';
import type { ColumnSampler, TerrainPeekLOD } from '../../three-engine/column-sample';
import { LosResolveContext } from '../../utils/gpu-cube-resolve';
import type { SightCount } from '../../utils/route-grid-los';
import type { LosMask } from '../../utils/los-mask';
import { Vector3 } from 'three';

/** What happened to the cells, see GlobalRouteGridService.onCellsChanged */
export type RouteGridChange = 'generated' | 'cleared';

/**
 * GlobalRouteGridService - Angular service wrapper for GlobalRouteGrid
 *
 * Provides an instance of GlobalRouteGrid for:
 * - Enemy position tracking
 * - Tower LOS registration
 *
 * The simulation has one of its own (built from the world, no tiles, no
 * scene); the main thread has one for line of sight, the ground of the
 * renderers and the debug overlays (RouteGridVizService).
 */
@Injectable({ providedIn: 'root' })
export class GlobalRouteGridService {
  private grid: GlobalRouteGrid;
  private initialized = false;
  private readonly changeListeners = new Set<(change: RouteGridChange) => void>();

  constructor() {
    this.grid = new GlobalRouteGrid();
  }

  /** Hear when the cells are generated anew or dropped; returns the unsubscribe. */
  onCellsChanged(listener: (change: RouteGridChange) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private changed(change: RouteGridChange): void {
    for (const listener of this.changeListeners) listener(change);
  }

  /**
   * Initialize the grid with required dependencies
   * @param columnSampler Vertical terrain probe (ground + tile LOD)
   * @param coordinateSync Coordinate sync for geo <-> local conversions
   * @param terrainPeekLOD Optional cheap LOD probe used to skip re-sampling
   */
  initialize(
    columnSampler: ColumnSampler,
    coordinateSync: CoordinateSync,
    terrainPeekLOD?: TerrainPeekLOD,
  ): void {
    this.grid.initialize(columnSampler, coordinateSync, terrainPeekLOD);
    this.initialized = true;

    // Diagnose-API für Route-Grid-Höhen-Anomalien
    // (plans/wir-wollen-einen-engine-typed-cray.md).
    // In DevTools aufrufbar als `__rg.dumpStats()` /
    // `__rg.dumpCellsInBox({xMin,xMax,zMin,zMax})` /
    // `__rg.resetHeightsAndRetry()`.
    (globalThis as Record<string, unknown>)['__rg'] = {
      dumpStats: () => this.grid.dumpStats(),
      dumpCellsInBox: (box: { xMin: number; xMax: number; zMin: number; zMax: number }) =>
        this.grid.dumpCellsInBox(box),
      resetHeightsAndRetry: () => this.grid.resetHeightsAndRetry(),
      grid: this.grid,
    };
  }

  /**
   * Retry sampling for cells that have never had a real raycast hit.
   * Cheap — only walks unsampled cells. Call from tile-load-end events.
   * Returns the number of cells promoted in this pass so a convergence
   * loop can stop when nothing changes.
   */
  retryUnsampledCells(): { promoted: number } {
    return this.grid.retryUnsampledCells();
  }

  /**
   * Best-effort terrain-Y at a local position via neighbour interpolation.
   * Used by visual consumers (e.g. air-route tube) to avoid reading
   * `cell.terrainHeight` from unsampled cells (which equals `routeAnchorY`
   * and is often 0 on height-less routes — would yield a 165m downward
   * kink on flat maps).
   */
  estimateTerrainY(x: number, z: number): number | null {
    return this.grid.estimateTerrainY(x, z);
  }

  /**
   * Check if grid is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get the underlying GlobalRouteGrid instance (for DPS profile computation)
   */
  getGrid(): GlobalRouteGrid {
    return this.grid;
  }

  /**
   * Get the CoordinateSync instance used by the grid
   */
  getCoordinateSync(): CoordinateSync | null {
    return this.grid.getCoordinateSync();
  }

  /**
   * Generate grid cells from enemy routes
   * @param routes Array of route paths (each path is GeoPosition[])
   */
  generateFromRoutes(routes: RouteWaypoint[][]): void {
    this.grid.generateFromRoutes(routes);
    this.changed('generated');
  }

  /**
   * Register a tower and compute LOS for all cells within range.
   * Pre-computes ground and/or air visibility based on the tower's
   * targeting flags.
   * @returns Array of cells visible from this tower (ground OR air)
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
    return this.grid.registerTower(towerId, towerX, towerZ, range, ctx, canTargetGround, canTargetAir);
  }

  /** What a tower at (towerX, towerZ) would see, without booking it into the cells (GlobalRouteGrid.sightFrom) */
  sightFrom(
    towerX: number,
    towerZ: number,
    range: number,
    ctx: LosResolveContext,
    canTargetGround: boolean,
    canTargetAir: boolean,
  ): SightCount {
    return this.grid.sightFrom(towerX, towerZ, range, ctx, canTargetGround, canTargetAir);
  }

  /**
   * Re-register a tower with a new range, preserving cached LoS for cells
   * already registered. Only the cells in the annulus (new range minus old)
   * need fresh raycasts.
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
    return this.grid.registerTowerIncremental(
      towerId, towerX, towerZ, range, ctx,
      canTargetGround, canTargetAir,
    );
  }

  /**
   * Die Cells in Reichweite eines Towers (Fläche schneidet die Reichweite
   * an) mit Höhe. Wird von der GPU-LOS-Viz-Pipeline (TowerLosViz /
   * TowerLosLayerBuilder) als Cell-Set genutzt.
   */
  getCellsInRange(x: number, z: number, range: number): RouteCell[] {
    return this.grid.getCellsInRange(x, z, range);
  }

  /** A tower's answers as a LosMask, see GlobalRouteGrid.encodeLosMask. */
  encodeLosMask(
    towerId: string,
    towerX: number,
    towerZ: number,
    range: number,
    canTargetGround: boolean,
    canTargetAir: boolean,
  ): LosMask {
    return this.grid.encodeLosMask(towerId, towerX, towerZ, range, canTargetGround, canTargetAir);
  }

  /** Write a LosMask into the cells, no GPU work; returns the visible cells. See GlobalRouteGrid.applyLosMask. */
  applyLosMask(towerId: string, towerX: number, towerZ: number, mask: LosMask): RouteCell[] {
    return this.grid.applyLosMask(towerId, towerX, towerZ, mask);
  }

  /** Grid-Cell-Size in Metern. */
  getCellSize(): number {
    return this.grid.getCellSize();
  }

  /**
   * Unregister a tower
   * @param towerId Tower ID to unregister
   */
  unregisterTower(towerId: string): void {
    this.grid.unregisterTower(towerId);
  }

  /**
   * Update enemy position in the grid
   * @param enemy Enemy entity
   * @param localX New X position (local coordinates)
   * @param localZ New Z position (local coordinates)
   */
  updateEnemyPosition(enemy: Enemy, localX: number, localZ: number): void {
    this.grid.updateEnemyPosition(enemy, localX, localZ);
  }

  /**
   * Remove enemy from grid
   * @param enemy Enemy entity
   */
  removeEnemy(enemy: Enemy): void {
    this.grid.removeEnemy(enemy);
  }

  /** See GlobalRouteGrid.captureEnemyCells */
  captureEnemyCells(): [number, string[]][] {
    return this.grid.captureEnemyCells();
  }

  /** See GlobalRouteGrid.restoreEnemyCells */
  restoreEnemyCells(cells: readonly (readonly [number, readonly string[]])[], byId: (id: string) => Enemy | null): void {
    this.grid.restoreEnemyCells(cells, byId);
  }

  /** See GlobalRouteGrid.enemyMemoCurrent */
  enemyMemoCurrent(enemy: Enemy): boolean {
    return this.grid.enemyMemoCurrent(enemy);
  }

  /** See GlobalRouteGrid.restoreEnemyMemo */
  restoreEnemyMemo(enemy: Enemy, current: boolean): void {
    this.grid.restoreEnemyMemo(enemy, current);
  }

  /**
   * Get enemies for tower targeting (from visible cells)
   * @param visibleCells Array of cells the tower can see
   * @returns Array of alive enemies in those cells
   */
  getEnemiesForTower(visibleCells: RouteCell[], out?: Enemy[]): Enemy[] {
    return this.grid.getEnemiesForTower(visibleCells, out);
  }

  /** Track an enemy whose body lies along the route (the ooze), see GlobalRouteGrid.getBodyEnemies. */
  addBodyEnemy(enemy: Enemy): void {
    this.grid.addBodyEnemy(enemy);
  }

  removeBodyEnemy(enemy: Enemy): void {
    this.grid.removeBodyEnemy(enemy);
  }

  /** Enemies whose body lies along the route; they are in no cell. */
  getBodyEnemies(): readonly Enemy[] {
    return this.grid.getBodyEnemies();
  }

  /** Whether a living body reaches within `radius` of local (x, z). */
  hasBodyWithin(x: number, z: number, radius: number): boolean {
    return this.grid.hasBodyWithin(x, z, radius);
  }

  /** Bumped whenever the cells are rebuilt or dropped. */
  getGeneration(): number {
    return this.grid.getGeneration();
  }

  /**
   * Get cell at local coordinates
   */
  getCellAt(localX: number, localZ: number): RouteCell | undefined {
    return this.grid.getCellAt(localX, localZ);
  }

  /**
   * Centre of the route cell nearest to `target` within `maxDistanceM`, on
   * the cell's ground, or null when no cell is that close. Where abilities
   * land: a click hits a roof, the enemies walk on the street.
   */
  snapToRouteCell(target: GeoPosition, maxDistanceM: number): GeoPosition | null {
    const sync = this.grid.getCoordinateSync();
    // The engine's sync always converts back; the optional member is for test doubles
    if (!this.initialized || !sync?.localToGeo) return null;
    const local = sync.geoToLocalSimple(target.lat, target.lon, 0);
    const cell = this.grid.findNearestCell(local.x, local.z, maxDistanceM);
    if (!cell) return null;
    const groundY = this.grid.getGroundLocalYAt(cell.x, cell.z) ?? cell.terrainHeight;
    const geo = sync.localToGeo(new Vector3(cell.x, groundY, cell.z));
    return { lat: geo.lat, lon: geo.lon, height: geo.height };
  }

  /**
   * Resolve ground terrain-Y (local frame) at an arbitrary local (x, z)
   * position. Cell-first, falls back to neighbour median. Returns `null`
   * when no stable neighbour exists yet (very early bootstrap or cells
   * not yet initialized). Single source of truth for enemy heights, the
   * red route line, and spawn initialization.
   */
  getGroundLocalYAt(localX: number, localZ: number): number | null {
    return this.grid.getGroundLocalYAt(localX, localZ);
  }

  /** getGroundLocalYAt() reusing the cell updateEnemyPosition() just resolved for this enemy. */
  getGroundLocalYForEnemy(enemy: Enemy, localX: number, localZ: number): number | null {
    return this.grid.getGroundLocalYForEnemy(enemy, localX, localZ);
  }

  /**
   * Whether the tower sees a ground target at the position (ground LOS of
   * the cell there); no answer counts as not visible.
   */
  isPositionVisibleFromTower(towerId: string, localX: number, localZ: number): boolean {
    return this.grid.isPositionVisibleFromTower(towerId, localX, localZ);
  }

  /**
   * isPositionVisibleFromTower for air targets (air LOS of the cell there,
   * distinct from ground because tall buildings may block one altitude but
   * not the other).
   */
  isAirPositionVisibleFromTower(towerId: string, localX: number, localZ: number): boolean {
    return this.grid.isAirPositionVisibleFromTower(towerId, localX, localZ);
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
  getEnemiesInRadius(localX: number, localZ: number, radiusMeters: number, excludeId?: string, out?: Enemy[]): Enemy[] {
    return this.grid.getEnemiesInRadius(localX, localZ, radiusMeters, excludeId, out);
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
  getEnemiesInRadiusGeo(center: GeoPosition, radiusMeters: number, excludeId?: string, out?: Enemy[]): Enemy[] {
    return this.grid.getEnemiesInRadiusGeo(center, radiusMeters, excludeId, out);
  }

  /**
   * Get grid statistics
   */
  getStats(): { totalCells: number; trackedEnemies: number; occupiedCells: number } {
    return this.grid.getStats();
  }

  /** Height per cell key, see GlobalRouteGrid.snapshotHeights. */
  snapshotHeights(): Map<number, number> {
    return this.grid.snapshotHeights();
  }

  /** Heights of every cell that has one, see GlobalRouteGrid.exportHeights. */
  exportHeights(): [number, number, number][] {
    return this.grid.exportHeights();
  }

  /** Take exported heights over, see GlobalRouteGrid.restoreHeights. */
  restoreHeights(heights: readonly (readonly [number, number, number])[]): number[] {
    return this.grid.restoreHeights(heights);
  }

  /** Cells without a height, see GlobalRouteGrid.cellsWithoutHeight. */
  cellsWithoutHeight(): number {
    return this.grid.cellsWithoutHeight();
  }

  /** Why the cells without a height have none and where they stand, see GlobalRouteGrid.describeCellsWithoutHeight. */
  describeCellsWithoutHeight(): { why: string; at: string } {
    return this.grid.describeCellsWithoutHeight();
  }

  /**
   * The defense reach of the first route using the towers' LOS data: the
   * furthest point on the path (0-1, distance-based) where at least one
   * tower sees the ground, and that waypoint (local, 3 m up) for a marker,
   * null when no tower sees any. Matches MovementComponent.getPathProgress()
   * distance calculation.
   */
  defenseReach(routes: GeoPosition[][]): { fraction: number; marker: { x: number; y: number; z: number } | null } {
    const none = { fraction: 0, marker: null };
    const sync = this.grid.getCoordinateSync();
    if (!this.initialized || !sync) return none;

    if (routes.length === 0) return none;
    const path = routes[0];
    if (path.length < 2) return none;

    // Convert all waypoints to local coordinates
    const localPositions = path.map(p => sync.geoToLocalSimple(p.lat, p.lon, p.height ?? 0));

    // Calculate segment lengths
    let totalLength = 0;
    const cumulativeDistances: number[] = [0];

    for (let i = 0; i < localPositions.length - 1; i++) {
      const a = localPositions[i];
      const b = localPositions[i + 1];
      const segLen = Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
      totalLength += segLen;
      cumulativeDistances.push(totalLength);
    }

    if (totalLength === 0) return none;

    // Find last waypoint visible by any tower
    let lastVisibleIndex = -1;

    for (let i = 0; i < localPositions.length; i++) {
      const local = localPositions[i];
      const cell = this.grid.getCellAt(local.x, local.z);
      if (cell) {
        for (const visible of cell.towerVisibility.values()) {
          if (visible) {
            lastVisibleIndex = i;
            break;
          }
        }
      }
    }

    if (lastVisibleIndex < 0) return none;
    const at = localPositions[lastVisibleIndex];
    return {
      fraction: cumulativeDistances[lastVisibleIndex] / totalLength,
      marker: { x: at.x, y: at.y + 3, z: at.z },
    };
  }

  /**
   * Metres of route each tower can shoot at, ground and air, averaged over the
   * routes (each coop lane walks its own). The route is walked in steps of
   * half a cell; a step counts for every tower that sees its cell, the same
   * LOS data targeting uses. A tower's damage times its metres over an
   * enemy's speed is what that tower deals to the enemy walking past
   * (docs/WAVE_RUN_PLAN.md, decision on the time under fire).
   *
   * Deterministic in coop: routes come with the world package and the LOS
   * masks from the host.
   */
  metersUnderFire(routes: GeoPosition[][]): { byTower: Map<string, { ground: number; air: number }>; any: { ground: number; air: number } } {
    const out = new Map<string, { ground: number; air: number }>();
    const any = { ground: 0, air: 0 };
    const sync = this.grid.getCoordinateSync();
    const usable = routes.filter((path) => path.length >= 2);
    if (!this.initialized || !sync || usable.length === 0) return { byTower: out, any };

    const add = (visibility: Map<string, boolean>, side: 'ground' | 'air', metres: number) => {
      let seen = false;
      for (const [towerId, visible] of visibility) {
        if (!visible) continue;
        seen = true;
        let entry = out.get(towerId);
        if (!entry) out.set(towerId, entry = { ground: 0, air: 0 });
        entry[side] += metres / usable.length;
      }
      if (seen) any[side] += metres / usable.length;
    };
    for (const path of usable) {
      const points = path.map((p) => sync.geoToLocalSimple(p.lat, p.lon, p.height ?? 0));
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i];
        const b = points[i + 1];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.sqrt(dx * dx + dz * dz);
        const steps = Math.max(1, Math.round(length));
        const each = length / steps;
        for (let k = 0; k < steps; k++) {
          const t = (k + 0.5) / steps;
          const cell = this.grid.getCellAt(a.x + dx * t, a.z + dz * t);
          if (!cell) continue;
          add(cell.towerVisibility, 'ground', each);
          add(cell.airVisibility, 'air', each);
        }
      }
    }
    return { byTower: out, any };
  }

  /**
   * Clear all data (for location change / reset)
   */
  clear(): void {
    this.grid.clear();
    this.initialized = false;
    this.changed('cleared');
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.grid.dispose();
    this.initialized = false;
    this.changed('cleared');
  }
}
