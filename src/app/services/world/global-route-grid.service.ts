import { Injectable, inject } from '@angular/core';
import { GlobalRouteGrid, RouteCell } from '../../utils/global-route-grid';
import { buildRouteAltitudeTubes, disposeRouteAltitudeTubes } from '../../utils/route-altitude-tubes';
import { Enemy } from '../../entities/enemy.entity';
import { GeoPosition } from '../../models/game.types';
import { CoordinateSync } from '../../three-engine/renderers';
import { TerrainRaycaster, TerrainSampleRaycaster, TerrainPeekLOD } from '../../three-engine/renderers/three-tower.renderer';
import { LosResolveContext } from '../../utils/gpu-cube-resolve';
import { Group, InstancedMesh, Mesh, MeshBasicMaterial, Scene, SphereGeometry } from 'three';
import { UIStore } from '../../store/ui.store';

/**
 * GlobalRouteGridService - Angular service wrapper for GlobalRouteGrid
 *
 * Provides a singleton instance of GlobalRouteGrid for:
 * - Enemy position tracking
 * - Tower LOS registration
 * - Unified visualization
 */
@Injectable({ providedIn: 'root' })
export class GlobalRouteGridService {
  private readonly uiStore = inject(UIStore);

  private grid: GlobalRouteGrid;
  private initialized = false;

  // Debug: defense reach marker (orange sphere)
  private scene: Scene | null = null;
  private defenseReachMarker: Mesh | null = null;

  // Spatial grid debug visualization mesh (owned by this service)
  private spatialGridVizMesh: InstancedMesh | null = null;

  // Air-cell debug visualization mesh — same cell set as spatialGridVizMesh
  // but elevated to terrainY + airSampleYOffset with stripe pattern.
  private airSpatialGridVizMesh: InstancedMesh | null = null;

  // Air-route tube debug overlay (owned by this service)
  private airRouteTube: Group | null = null;
  private airRouteTubeScene: Scene | null = null;

  constructor() {
    this.grid = new GlobalRouteGrid();
  }

  /**
   * Initialize the grid with required dependencies
   * @param terrainRaycaster Function to sample terrain height at local coordinates
   * @param coordinateSync Coordinate sync for geo <-> local conversions
   * @param skylineRaycaster Optional top-down sampler for skyline (terrain + buildings)
   */
  initialize(
    terrainRaycaster: TerrainRaycaster,
    coordinateSync: CoordinateSync,
    skylineRaycaster?: TerrainRaycaster,
    terrainSampleRaycaster?: TerrainSampleRaycaster,
    terrainPeekLOD?: TerrainPeekLOD,
  ): void {
    this.grid.initialize(terrainRaycaster, coordinateSync, skylineRaycaster, terrainSampleRaycaster, terrainPeekLOD);
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
   * Locally refine cells in `radius` around (x, z) via sampleCellY.
   * Promotes unsampled and refreshes stable cells when LOD improved.
   * Call before tower placement / preview to ensure fresh heights in
   * the affected region.
   */
  refineCellsInRadius(x: number, z: number, radius: number): { promoted: number; refreshed: number; inRange: number } {
    return this.grid.refineCellsInRadius(x, z, radius);
  }

  /**
   * Schmal-Variante: promoviert nur unsampled Cells im Radius, lässt
   * bereits stabile Cells in Ruhe. Für den Build-Preview-Pfad gedacht,
   * wo wir per Mouse-Move keine LOD-Upgrades ausführen wollen.
   */
  promoteUnsampledCellsInRadius(x: number, z: number, radius: number): { promoted: number } {
    return this.grid.promoteUnsampledCellsInRadius(x, z, radius);
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
  generateFromRoutes(routes: GeoPosition[][]): void {
    this.grid.generateFromRoutes(routes);
    // Routes changed → existing tube geometry is stale, rebuild if shown
    if (this.airRouteTube) {
      this.rebuildAirRouteLayer();
    }
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
   * Drop the visibility cache for one tower. Used by the tile-streaming
   * staleness fix — recomputeAllTowersGroundLOS in TowerManager invalidates
   * each tower's cache before re-resolving against the freshly streamed
   * tile geometry.
   */
  clearGroundVisibilityForTower(towerId: string): void {
    this.grid.clearGroundVisibilityForTower(towerId);
  }

  /**
   * Liefert alle Cells deren Center innerhalb \`range\` von (x, z) liegt
   * UND deren Terrain-Sample stabil ist. Wird von der GPU-LOS-Viz-
   * Pipeline (TowerLosViz / TowerLosLayerBuilder) als Cell-Set genutzt.
   */
  getCellsInRange(x: number, z: number, range: number): RouteCell[] {
    return this.grid.getCellsInRange(x, z, range);
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

  /**
   * Get enemies for tower targeting (from visible cells)
   * @param visibleCells Array of cells the tower can see
   * @returns Array of alive enemies in those cells
   */
  getEnemiesForTower(visibleCells: RouteCell[]): Enemy[] {
    return this.grid.getEnemiesForTower(visibleCells);
  }

  /**
   * Get cell at local coordinates
   */
  getCellAt(localX: number, localZ: number): RouteCell | undefined {
    return this.grid.getCellAt(localX, localZ);
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

  /**
   * Check if position is visible from tower (ground LOS)
   */
  isPositionVisibleFromTower(towerId: string, localX: number, localZ: number): boolean | undefined {
    return this.grid.isPositionVisibleFromTower(towerId, localX, localZ);
  }

  /**
   * Check if position is visible from tower for air targets (raycast against
   * cell skyline + clearance — distinct from ground because tall buildings
   * may block one altitude but not the other).
   */
  isAirPositionVisibleFromTower(towerId: string, localX: number, localZ: number): boolean | undefined {
    return this.grid.isAirPositionVisibleFromTower(towerId, localX, localZ);
  }

  /**
   * Get cell skyline height at a local position (local Y of highest geometry
   * around the cell). Used to lift air-enemy flight altitude above local
   * rooftops.
   */
  getSkylineHeightAt(localX: number, localZ: number): number | null {
    return this.grid.getSkylineHeightAt(localX, localZ);
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
  getEnemiesInRadius(localX: number, localZ: number, radiusMeters: number, excludeId?: string): Enemy[] {
    return this.grid.getEnemiesInRadius(localX, localZ, radiusMeters, excludeId);
  }

  /**
   * Get all alive enemies within a radius of a geo position
   * Convenience method that converts geo to local coordinates
   *
   * @param center Center point (lat, lon)
   * @param radiusMeters Radius in meters
   * @param excludeId Optional enemy ID to exclude
   * @returns Array of alive enemies within radius
   */
  getEnemiesInRadiusGeo(center: GeoPosition, radiusMeters: number, excludeId?: string): Enemy[] {
    return this.grid.getEnemiesInRadiusGeo(center, radiusMeters, excludeId);
  }

  /**
   * Get grid statistics
   */
  getStats(): { totalCells: number; trackedEnemies: number; occupiedCells: number } {
    return this.grid.getStats();
  }

  /**
   * Create visualization mesh
   */
  createVisualization(): InstancedMesh {
    return this.grid.createVisualization();
  }

  /**
   * Update visualization
   */
  updateVisualization(): void {
    this.grid.updateVisualization();
  }

  /**
   * Update animation time
   */
  updateAnimation(deltaTime: number): void {
    this.grid.updateAnimation(deltaTime);
  }

  /**
   * Get visualization mesh
   */
  getVisualization(): InstancedMesh | null {
    return this.grid.getVisualization();
  }

  /**
   * Dispose visualization
   */
  disposeVisualization(): void {
    this.grid.disposeVisualization();
  }

  /**
   * Update terrain heights for all cells
   * Call this after terrain tiles have loaded
   */
  updateTerrainHeights(): void {
    this.grid.updateTerrainHeights();
  }

  /**
   * Subscribe to cell promotion events (heightSampled false → true).
   * Consumers can use the promoted cell list to recompute per-tower LOS
   * + viz meshes so the system self-heals as tiles stream in.
   */
  setCellsPromotedListener(listener: (promoted: RouteCell[]) => void): void {
    this.grid.setCellsPromotedListener(listener);
  }

  // ========================================
  // SPATIAL GRID DEBUG VISUALIZATION
  // ========================================

  /**
   * Toggle spatial grid debug visualization.
   * Toggles UI state and updates visualization accordingly.
   */
  toggleSpatialGridDebug(): void {
    this.uiStore.toggleSpatialGridDebug();
    this.updateSpatialGridVisualization();
  }

  /**
   * Initialize spatial grid visualization if persisted state was enabled.
   * Called after grid is initialized to restore persisted visibility.
   */
  initSpatialGridVisualizationIfEnabled(): void {
    if (this.uiStore.spatialGridDebugVisible()) {
      this.updateSpatialGridVisualization();
    }
  }

  /**
   * Update spatial grid visualization based on current UI state.
   * Creates mesh on first show, toggles visibility thereafter.
   */
  updateSpatialGridVisualization(): void {
    const visible = this.uiStore.spatialGridDebugVisible();

    if (visible) {
      // Create and add visualization mesh to scene
      if (!this.spatialGridVizMesh && this.scene && this.initialized) {
        this.spatialGridVizMesh = this.grid.createVisualization();
        this.scene.add(this.spatialGridVizMesh);
      }
      if (this.spatialGridVizMesh) {
        this.spatialGridVizMesh.visible = true;
      }
    } else {
      // Hide visualization (don't dispose - may toggle again)
      if (this.spatialGridVizMesh) {
        this.spatialGridVizMesh.visible = false;
      }
    }
  }

  /**
   * Check if the spatial grid viz mesh is active and visible
   * (used by game loop for per-frame visualization updates)
   */
  isSpatialGridVizVisible(): boolean {
    return this.uiStore.spatialGridDebugVisible() && this.spatialGridVizMesh !== null;
  }

  /**
   * Cleanup spatial grid visualization mesh.
   * Removes from scene and disposes resources.
   */
  cleanupSpatialGridVisualization(): void {
    if (this.spatialGridVizMesh) {
      if (this.scene) {
        this.scene.remove(this.spatialGridVizMesh);
      }
      this.grid.disposeVisualization();
      this.spatialGridVizMesh = null;
    }
  }

  // ========================================
  // AIR-CELL DEBUG (mirror of spatial-grid-debug at air altitude)
  // ========================================

  /** Toggle the air-cell debug overlay. Persisted via UIStore. */
  toggleAirSpatialGridDebug(): void {
    this.uiStore.toggleAirSpatialGridDebug();
    this.updateAirSpatialGridVisualization();
  }

  /** Restore from persisted state. Call after grid init. */
  initAirSpatialGridVisualizationIfEnabled(): void {
    if (this.uiStore.airSpatialGridDebugVisible()) {
      this.updateAirSpatialGridVisualization();
    }
  }

  /**
   * Reflect the current UIStore state on the scene — show or hide.
   * Idempotent; manages create/dispose lifecycle internally.
   */
  updateAirSpatialGridVisualization(): void {
    const visible = this.uiStore.airSpatialGridDebugVisible();

    if (visible) {
      if (!this.airSpatialGridVizMesh && this.scene && this.initialized) {
        this.airSpatialGridVizMesh = this.grid.createAirVisualization();
        this.scene.add(this.airSpatialGridVizMesh);
      }
      if (this.airSpatialGridVizMesh) {
        this.airSpatialGridVizMesh.visible = true;
      }
    } else {
      if (this.airSpatialGridVizMesh) {
        this.airSpatialGridVizMesh.visible = false;
      }
    }
  }

  /** True if the air-cell-mesh is built and currently visible. */
  isAirSpatialGridVizVisible(): boolean {
    return this.uiStore.airSpatialGridDebugVisible() && this.airSpatialGridVizMesh !== null;
  }

  /** Dispose the air-cell-mesh — invoked on grid clear / dispose. */
  cleanupAirSpatialGridVisualization(): void {
    if (this.airSpatialGridVizMesh) {
      if (this.scene) {
        this.scene.remove(this.airSpatialGridVizMesh);
      }
      this.grid.disposeAirVisualization();
      this.airSpatialGridVizMesh = null;
    }
  }

  // ========================================
  // AIR-ROUTE TUBE (Quick-Actions toggle)
  // ========================================

  /** Toggle the air-route tube overlay. Persisted via UIStore. */
  toggleAirRouteLayer(): void {
    this.uiStore.toggleAirRoute();
    this.updateAirRouteLayer();
  }

  /** Re-instantiate the tube if the persisted state was enabled. */
  initAirRouteLayerIfEnabled(): void {
    if (this.uiStore.airRouteVisible()) {
      this.updateAirRouteLayer();
    }
  }

  /**
   * Reflect the current UIStore state on the scene — show or hide.
   * Idempotent; calls into the show/hide methods which manage their
   * own create/dispose lifecycle.
   */
  updateAirRouteLayer(): void {
    if (!this.scene) return;
    if (this.uiStore.airRouteVisible()) {
      this.showAirRouteLayer(this.scene);
    } else {
      this.hideAirRouteLayer();
    }
  }

  /** Build (lazy) and show the tube. Idempotent. */
  private showAirRouteLayer(scene: Scene): void {
    if (!this.airRouteTube) {
      this.airRouteTube = buildRouteAltitudeTubes(this.grid);
    }
    if (this.airRouteTubeScene !== scene) {
      this.airRouteTube.removeFromParent();
      scene.add(this.airRouteTube);
      this.airRouteTubeScene = scene;
    }
    this.airRouteTube.visible = true;
  }

  /** Hide without disposing. Idempotent. */
  private hideAirRouteLayer(): void {
    if (this.airRouteTube) {
      this.airRouteTube.visible = false;
    }
  }

  /**
   * Force re-build of the tube — used after a location switch or new
   * route generation where the polyline geometry has changed.
   */
  rebuildAirRouteLayer(): void {
    if (!this.airRouteTube) return;
    const wasVisible = this.airRouteTube.visible;
    const scene = this.airRouteTubeScene;
    disposeRouteAltitudeTubes(this.airRouteTube);
    this.airRouteTube = null;
    this.airRouteTubeScene = null;
    if (wasVisible && scene) {
      this.showAirRouteLayer(scene);
    }
  }

  /** Disposes the cached tube — invoked on full grid clear. */
  cleanupAirRouteLayer(): void {
    if (this.airRouteTube) {
      disposeRouteAltitudeTubes(this.airRouteTube);
      this.airRouteTube = null;
      this.airRouteTubeScene = null;
    }
  }

  // ========================================
  // DEFENSE REACH
  // ========================================

  /**
   * Initialize debug visualization with a Three.js scene reference.
   * Must be called before getDefenseReachPercent() can show the orange marker.
   */
  initDebugViz(scene: Scene): void {
    this.scene = scene;
  }

  /**
   * Calculate defense reach percent using GlobalRouteGrid LOS data.
   * Returns the furthest point on the path (0-1, distance-based) where
   * at least one tower has line-of-sight visibility.
   * Matches MovementComponent.getPathProgress() distance calculation.
   * Also updates the orange debug marker position.
   *
   * @param routes Array of route paths (GeoPosition[][])
   * @returns Defense reach as fraction 0..1
   */
  getDefenseReachPercent(routes: GeoPosition[][]): number {
    const sync = this.grid.getCoordinateSync();
    if (!this.initialized || !sync) return 0;

    if (routes.length === 0) return 0;
    const path = routes[0];
    if (path.length < 2) return 0;

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

    if (totalLength === 0) return 0;

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

    if (lastVisibleIndex < 0) {
      this.hideDefenseReachMarker();
      return 0;
    }

    // Update orange debug marker at last visible waypoint
    const markerPos = localPositions[lastVisibleIndex];
    this.updateDefenseReachMarker(markerPos.x, markerPos.y + 3, markerPos.z);

    return cumulativeDistances[lastVisibleIndex] / totalLength;
  }

  private updateDefenseReachMarker(x: number, y: number, z: number): void {
    if (!this.scene) return;

    if (!this.defenseReachMarker) {
      const geo = new SphereGeometry(1.5, 8, 6);
      const mat = new MeshBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.85 });
      this.defenseReachMarker = new Mesh(geo, mat);
      this.defenseReachMarker.renderOrder = 10;
      this.scene.add(this.defenseReachMarker);
    }

    this.defenseReachMarker.position.set(x, y, z);
    this.defenseReachMarker.visible = true;
  }

  private hideDefenseReachMarker(): void {
    if (this.defenseReachMarker) {
      this.defenseReachMarker.visible = false;
    }
  }

  /**
   * Clear all data (for location change / reset)
   */
  clear(): void {
    this.cleanupSpatialGridVisualization();
    this.cleanupAirSpatialGridVisualization();
    this.cleanupAirRouteLayer();
    this.grid.clear();
    this.initialized = false;
    this.hideDefenseReachMarker();
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.cleanupSpatialGridVisualization();
    this.cleanupAirSpatialGridVisualization();
    this.cleanupAirRouteLayer();
    this.grid.dispose();
    this.initialized = false;
    if (this.defenseReachMarker) {
      if (this.scene) this.scene.remove(this.defenseReachMarker);
      this.defenseReachMarker.geometry.dispose();
      (this.defenseReachMarker.material as MeshBasicMaterial).dispose();
      this.defenseReachMarker = null;
    }
    this.scene = null;
  }
}
