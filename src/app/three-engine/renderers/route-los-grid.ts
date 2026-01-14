import * as THREE from 'three';
import { CoordinateSync } from './index';
import { GeoPosition } from '../../models/game.types';
import { LineOfSightRaycaster, TerrainRaycaster } from './three-tower.renderer';

/**
 * RouteLosGrid - Pre-computed Line-of-Sight grid along enemy routes
 *
 * Optimizes LOS checks from O(raycast) to O(1) lookup by pre-computing
 * visibility for cells along the route corridor at tower placement time.
 *
 * Design:
 * - 2m quad grid cells (finer than 8m hex visualization grid)
 * - Only covers route corridor (±5m from route center)
 * - Only cells within tower range
 * - Computed once at tower placement, reused for all runtime LOS checks
 */
export class RouteLosGrid {
  /** Map of grid cell keys to visibility (true = visible from tower) */
  private cells = new Map<string, boolean>();

  /** Grid cell size in meters */
  private readonly CELL_SIZE = 2;

  /** Corridor width from route center in meters (covers lateralOffset ±2m + safety) */
  private readonly CORRIDOR_WIDTH = 5;

  /** LOS offset from tower center (same as in three-tower.renderer.ts) */
  private readonly LOS_OFFSET = 2.4;

  /** Debug statistics */
  private stats = { totalCells: 0, visibleCells: 0, blockedCells: 0 };

  constructor(
    private towerX: number,
    private towerZ: number,
    private towerTipY: number,
    private towerRange: number,
    private losRaycaster: LineOfSightRaycaster,
    private terrainRaycaster: TerrainRaycaster
  ) {}

  /**
   * Generate LOS grid from all enemy routes
   * @param routes Array of route paths (each path is GeoPosition[])
   * @param sync Coordinate sync for geo→local conversion
   */
  generateFromRoutes(routes: GeoPosition[][], sync: CoordinateSync): void {
    this.cells.clear();
    this.stats = { totalCells: 0, visibleCells: 0, blockedCells: 0 };

    const processedCells = new Set<string>();
    const rangeSquared = this.towerRange * this.towerRange;

    for (const route of routes) {
      if (route.length < 2) continue;

      // Process each segment of the route
      for (let i = 0; i < route.length - 1; i++) {
        const startGeo = route[i];
        const endGeo = route[i + 1];

        // Convert to local coordinates
        const startLocal = sync.geoToLocalSimple(startGeo.lat, startGeo.lon, startGeo.height ?? 0);
        const endLocal = sync.geoToLocalSimple(endGeo.lat, endGeo.lon, endGeo.height ?? 0);

        // Sample points along this segment
        const segmentLength = Math.sqrt(
          Math.pow(endLocal.x - startLocal.x, 2) + Math.pow(endLocal.z - startLocal.z, 2)
        );
        const numSamples = Math.max(2, Math.ceil(segmentLength / this.CELL_SIZE));

        for (let s = 0; s <= numSamples; s++) {
          const t = s / numSamples;
          const sampleX = startLocal.x + (endLocal.x - startLocal.x) * t;
          const sampleZ = startLocal.z + (endLocal.z - startLocal.z) * t;

          // Generate cells in corridor around this sample point
          this.generateCorridorCells(
            sampleX,
            sampleZ,
            startLocal,
            endLocal,
            processedCells,
            rangeSquared
          );
        }
      }
    }
  }

  /**
   * Generate cells in the corridor around a route sample point
   */
  private generateCorridorCells(
    centerX: number,
    centerZ: number,
    segStart: { x: number; z: number },
    segEnd: { x: number; z: number },
    processedCells: Set<string>,
    rangeSquared: number
  ): void {
    // Calculate perpendicular direction to segment
    const dx = segEnd.x - segStart.x;
    const dz = segEnd.z - segStart.z;
    const len = Math.sqrt(dx * dx + dz * dz);

    if (len < 0.001) return;

    // Perpendicular vector (rotated 90 degrees)
    const perpX = -dz / len;
    const perpZ = dx / len;

    // Generate cells across the corridor width
    const numCellsAcross = Math.ceil(this.CORRIDOR_WIDTH / this.CELL_SIZE) * 2 + 1;
    const halfWidth = this.CORRIDOR_WIDTH;

    for (let c = 0; c < numCellsAcross; c++) {
      const offset = -halfWidth + (c * this.CELL_SIZE);
      const cellX = centerX + perpX * offset;
      const cellZ = centerZ + perpZ * offset;

      // Check if within tower range
      const distToTowerSq =
        Math.pow(cellX - this.towerX, 2) + Math.pow(cellZ - this.towerZ, 2);
      if (distToTowerSq > rangeSquared) continue;

      // Create cell key (quantized to grid)
      const cellKeyX = Math.floor(cellX / this.CELL_SIZE);
      const cellKeyZ = Math.floor(cellZ / this.CELL_SIZE);
      const key = `${cellKeyX}_${cellKeyZ}`;

      // Skip if already processed
      if (processedCells.has(key)) continue;
      processedCells.add(key);

      // Get terrain height at cell center
      const cellCenterX = (cellKeyX + 0.5) * this.CELL_SIZE;
      const cellCenterZ = (cellKeyZ + 0.5) * this.CELL_SIZE;
      const terrainY = this.terrainRaycaster(cellCenterX, cellCenterZ);

      if (terrainY === null) continue;

      // Calculate LOS origin (offset from tower center towards cell)
      const dirX = cellCenterX - this.towerX;
      const dirZ = cellCenterZ - this.towerZ;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);

      if (dirLen < 0.1) {
        // Cell is at tower center, always visible
        this.cells.set(key, true);
        this.stats.totalCells++;
        this.stats.visibleCells++;
        continue;
      }

      const originX = this.towerX + (dirX / dirLen) * this.LOS_OFFSET;
      const originZ = this.towerZ + (dirZ / dirLen) * this.LOS_OFFSET;

      // Target Y is slightly above terrain (enemy eye height ~1.5m)
      const targetY = terrainY + 1.5;

      // Raycast to check visibility
      const isBlocked = this.losRaycaster(
        originX,
        this.towerTipY,
        originZ,
        cellCenterX,
        targetY,
        cellCenterZ
      );

      this.cells.set(key, !isBlocked);
      this.stats.totalCells++;
      if (isBlocked) {
        this.stats.blockedCells++;
      } else {
        this.stats.visibleCells++;
      }
    }
  }

  /**
   * Check if a position is visible from the tower (O(1) lookup)
   * @param localX Local X coordinate
   * @param localZ Local Z coordinate
   * @returns true if visible, false if blocked, undefined if not in grid
   */
  isPositionVisible(localX: number, localZ: number): boolean | undefined {
    const cellKeyX = Math.floor(localX / this.CELL_SIZE);
    const cellKeyZ = Math.floor(localZ / this.CELL_SIZE);
    const key = `${cellKeyX}_${cellKeyZ}`;

    return this.cells.get(key);
  }

  /**
   * Check if grid has any cells (was populated successfully)
   */
  hasData(): boolean {
    return this.cells.size > 0;
  }

  /**
   * Get grid statistics
   */
  getStats(): { totalCells: number; visibleCells: number; blockedCells: number } {
    return { ...this.stats };
  }

  /**
   * Create debug visualization showing all grid cells
   * Green cubes = visible, Red cubes = blocked
   */
  createDebugVisualization(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'routeLosDebug';

    const cubeSize = this.CELL_SIZE * 0.4; // Slightly smaller than cell for gaps
    const geometry = new THREE.BoxGeometry(cubeSize, cubeSize * 0.5, cubeSize);

    const greenMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
    });

    const redMaterial = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
    });

    for (const [key, visible] of this.cells) {
      const parts = key.split('_');
      const cellKeyX = parseInt(parts[0], 10);
      const cellKeyZ = parseInt(parts[1], 10);

      const cellCenterX = (cellKeyX + 0.5) * this.CELL_SIZE;
      const cellCenterZ = (cellKeyZ + 0.5) * this.CELL_SIZE;

      // Get terrain height for Y position
      const terrainY = this.terrainRaycaster(cellCenterX, cellCenterZ);
      const y = terrainY !== null ? terrainY + 1.0 : this.towerTipY;

      const mesh = new THREE.Mesh(geometry, visible ? greenMaterial : redMaterial);
      mesh.position.set(cellCenterX, y, cellCenterZ);
      mesh.renderOrder = 900;
      group.add(mesh);
    }

    group.visible = false; // Start hidden
    return group;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.cells.clear();
  }
}
