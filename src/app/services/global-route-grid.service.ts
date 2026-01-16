import { Injectable } from '@angular/core';
import { GlobalRouteGrid, RouteCell } from '../utils/global-route-grid';
import { Enemy } from '../entities/enemy.entity';
import { GeoPosition } from '../models/game.types';
import { CoordinateSync } from '../three-engine/renderers';
import { TerrainRaycaster, LineOfSightRaycaster } from '../three-engine/renderers/three-tower.renderer';
import * as THREE from 'three';

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
  private grid: GlobalRouteGrid;
  private initialized = false;

  constructor() {
    this.grid = new GlobalRouteGrid();
  }

  /**
   * Initialize the grid with required dependencies
   * @param terrainRaycaster Function to sample terrain height at local coordinates
   * @param coordinateSync Coordinate sync for geo <-> local conversions
   */
  initialize(terrainRaycaster: TerrainRaycaster, coordinateSync: CoordinateSync): void {
    this.grid.initialize(terrainRaycaster, coordinateSync);
    this.initialized = true;
  }

  /**
   * Check if grid is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Generate grid cells from enemy routes
   * @param routes Array of route paths (each path is GeoPosition[])
   */
  generateFromRoutes(routes: GeoPosition[][]): void {
    this.grid.generateFromRoutes(routes);
  }

  /**
   * Register a tower and compute LOS for all cells within range
   * @param towerId Tower unique ID
   * @param towerX Tower X position (local coordinates)
   * @param towerZ Tower Z position (local coordinates)
   * @param tipY Tower tip Y position (for LOS origin)
   * @param range Tower targeting range
   * @param losRaycaster LOS raycaster function
   * @returns Array of cells visible from this tower
   */
  registerTower(
    towerId: string,
    towerX: number,
    towerZ: number,
    tipY: number,
    range: number,
    losRaycaster: LineOfSightRaycaster
  ): RouteCell[] {
    return this.grid.registerTower(towerId, towerX, towerZ, tipY, range, losRaycaster);
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
   * Check if position is visible from tower
   */
  isPositionVisibleFromTower(towerId: string, localX: number, localZ: number): boolean | undefined {
    return this.grid.isPositionVisibleFromTower(towerId, localX, localZ);
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
  createVisualization(): THREE.InstancedMesh {
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
  getVisualization(): THREE.InstancedMesh | null {
    return this.grid.getVisualization();
  }

  /**
   * Dispose visualization
   */
  disposeVisualization(): void {
    this.grid.disposeVisualization();
  }

  // ========================================
  // PER-TOWER VISUALIZATION
  // ========================================

  /**
   * Create visualization for a specific tower's LOS coverage
   * Shows all cells within range: green = visible, red = blocked
   * @param towerId Tower ID
   * @param towerX Tower X position (local coordinates)
   * @param towerZ Tower Z position (local coordinates)
   * @param range Tower targeting range
   * @returns InstancedMesh visualization or null if no cells
   */
  createTowerVisualization(
    towerId: string,
    towerX: number,
    towerZ: number,
    range: number
  ): THREE.InstancedMesh | null {
    return this.grid.createTowerVisualization(towerId, towerX, towerZ, range);
  }

  /**
   * Update tower visualization animation time
   */
  updateTowerVisualizationTime(mesh: THREE.InstancedMesh): void {
    this.grid.updateTowerVisualizationTime(mesh);
  }

  /**
   * Update terrain heights for all cells
   * Call this after terrain tiles have loaded
   */
  updateTerrainHeights(): void {
    this.grid.updateTerrainHeights();
  }

  /**
   * Clear all data (for location change / reset)
   */
  clear(): void {
    this.grid.clear();
    this.initialized = false;
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.grid.dispose();
    this.initialized = false;
  }
}
