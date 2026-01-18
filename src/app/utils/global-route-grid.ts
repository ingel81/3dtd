import * as THREE from 'three';
import { Enemy } from '../entities/enemy.entity';
import { GeoPosition } from '../models/game.types';
import { CoordinateSync } from '../three-engine/renderers';
import { TerrainRaycaster, LineOfSightRaycaster } from '../three-engine/renderers/three-tower.renderer';

/**
 * RouteCell - Single cell in the global route grid
 *
 * Contains:
 * - Position (cell center in local coordinates)
 * - Terrain height at cell center
 * - Set of enemies currently in this cell
 * - Map of tower visibility (LOS check results per tower)
 */
export interface RouteCell {
  /** Unique cell key (format: "cellKeyX_cellKeyZ") */
  key: string;
  /** Cell center X in local coordinates */
  x: number;
  /** Cell center Z in local coordinates */
  z: number;
  /** Terrain height at cell center (local Y coordinate) */
  terrainHeight: number;
  /** Set of enemies currently in this cell */
  enemies: Set<Enemy>;
  /** Map of tower ID -> visibility (true = can see this cell) */
  towerVisibility: Map<string, boolean>;
}

/**
 * Shader for LOS cell visualization with multi-color support
 */
const LOS_CELL_VERTEX = /* glsl */ `
attribute float aCellState;
varying float vCellState;

void main() {
  vCellState = aCellState;

  vec4 mvPosition = vec4(position, 1.0);

  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif

  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
}
`;

/**
 * Fragment shader with multi-color support
 * States: 0 = gray (no tower), 1 = green (visible), 2 = red (blocked), 3 = blue (enemy), 4 = yellow (enemy + visible)
 */
const LOS_CELL_FRAGMENT = /* glsl */ `
uniform float uTime;
varying float vCellState;

void main() {
  vec3 color;
  float alpha;

  // Gray: No tower sees this cell
  if (vCellState < 0.5) {
    color = vec3(0.5, 0.5, 0.5);
    alpha = 0.3;
  }
  // Green: At least one tower can see this cell
  else if (vCellState < 1.5) {
    color = vec3(0.133, 0.773, 0.369);
    alpha = 0.6;
  }
  // Red: All towers blocked
  else if (vCellState < 2.5) {
    color = vec3(0.863, 0.149, 0.149);
    alpha = 0.6;
  }
  // Blue: Enemy in cell
  else if (vCellState < 3.5) {
    color = vec3(0.0, 0.5, 1.0);
    alpha = 0.7;
  }
  // Yellow: Enemy + tower can see = active target
  else {
    color = vec3(1.0, 0.9, 0.0);
    alpha = 0.85;
  }

  float pulse = sin(uTime * 3.0) * 0.15 + 0.85;
  gl_FragColor = vec4(color, alpha * pulse);
}
`;

/**
 * Per-tower LOS visualization shader (simple green/red)
 */
const TOWER_LOS_VERTEX = /* glsl */ `
attribute float aIsBlocked;
varying float vIsBlocked;

void main() {
  vIsBlocked = aIsBlocked;

  vec4 mvPosition = vec4(position, 1.0);

  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif

  mvPosition = modelViewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;
}
`;

const TOWER_LOS_FRAGMENT = /* glsl */ `
uniform float uTime;
varying float vIsBlocked;

void main() {
  vec3 greenColor = vec3(0.133, 0.773, 0.369);
  vec3 redColor = vec3(0.863, 0.149, 0.149);
  vec3 color = mix(greenColor, redColor, vIsBlocked);

  float pulse = sin(uTime * 3.0) * 0.15 + 0.6;

  gl_FragColor = vec4(color, pulse);
}
`;

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
  private cells = new Map<string, RouteCell>();

  /** Map of enemy ID to current cell key (for fast cell transitions) */
  private enemyCellKeys = new Map<string, string>();

  /** Grid cell size in meters (matches original CELL_SIZE) */
  private readonly CELL_SIZE = 2;

  /** Corridor width from route center in meters */
  private readonly CORRIDOR_WIDTH = 7;

  /** LOS offset from tower center (raycast starts from tower edge) */
  private readonly LOS_OFFSET = 2.4;

  /** Terrain raycaster for height sampling */
  private terrainRaycaster: TerrainRaycaster | null = null;

  /** Coordinate sync for geo <-> local conversions */
  private coordinateSync: CoordinateSync | null = null;

  /** Visualization mesh */
  private visualization: THREE.InstancedMesh | null = null;
  private visualizationMaterial: THREE.ShaderMaterial | null = null;
  private cellStateAttribute: THREE.InstancedBufferAttribute | null = null;

  /** Animation time accumulator */
  private animationTime = 0;

  /** Maximum cells for visualization (pre-allocated) */
  private readonly MAX_VIZ_CELLS = 5000;

  /**
   * Initialize the grid with required dependencies
   * @param terrainRaycaster Function to sample terrain height at local coordinates
   * @param coordinateSync Coordinate sync for geo <-> local conversions
   */
  initialize(terrainRaycaster: TerrainRaycaster, coordinateSync: CoordinateSync): void {
    this.terrainRaycaster = terrainRaycaster;
    this.coordinateSync = coordinateSync;
  }

  /**
   * Generate grid cells from enemy routes
   * Creates cells along the route corridor and samples terrain height at each
   * @param routes Array of route paths (each path is GeoPosition[])
   */
  generateFromRoutes(routes: GeoPosition[][]): void {
    if (!this.coordinateSync || !this.terrainRaycaster) {
      console.error('[GlobalRouteGrid] Cannot generate - not initialized');
      return;
    }

    this.cells.clear();
    this.enemyCellKeys.clear();

    const processedCells = new Set<string>();

    for (const route of routes) {
      if (route.length < 2) continue;

      // Process each segment of the route
      for (let i = 0; i < route.length - 1; i++) {
        const startGeo = route[i];
        const endGeo = route[i + 1];

        // Convert to local coordinates
        const startLocal = this.coordinateSync.geoToLocalSimple(startGeo.lat, startGeo.lon, startGeo.height ?? 0);
        const endLocal = this.coordinateSync.geoToLocalSimple(endGeo.lat, endGeo.lon, endGeo.height ?? 0);

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
          this.generateCorridorCells(sampleX, sampleZ, processedCells);
        }
      }
    }
  }

  /**
   * Generate cells in a circular corridor around a route sample point
   */
  private generateCorridorCells(
    centerX: number,
    centerZ: number,
    processedCells: Set<string>
  ): number {
    const corridorWidthSq = this.CORRIDOR_WIDTH * this.CORRIDOR_WIDTH;
    const numCells = Math.ceil(this.CORRIDOR_WIDTH / this.CELL_SIZE);
    let newCells = 0;

    for (let dx = -numCells; dx <= numCells; dx++) {
      for (let dz = -numCells; dz <= numCells; dz++) {
        const cellX = centerX + dx * this.CELL_SIZE;
        const cellZ = centerZ + dz * this.CELL_SIZE;

        // Check if within corridor width (circular)
        const distSq = (dx * this.CELL_SIZE) ** 2 + (dz * this.CELL_SIZE) ** 2;
        if (distSq > corridorWidthSq) continue;

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
        const terrainY = this.terrainRaycaster!(cellCenterX, cellCenterZ);

        // Use fallback height of 0 if terrain not yet loaded
        // Height will be updated when terrain loads (via updateTerrainHeights)
        const height = terrainY ?? 0;

        // Create cell
        const cell: RouteCell = {
          key,
          x: cellCenterX,
          z: cellCenterZ,
          terrainHeight: height,
          enemies: new Set(),
          towerVisibility: new Map(),
        };

        this.cells.set(key, cell);
        newCells++;
      }
    }

    return newCells;
  }

  /**
   * Update terrain heights for all cells
   * Call this after terrain tiles have loaded for accurate visualization
   * Uses ABSOLUTE raycast heights (for correct scene positioning)
   */
  updateTerrainHeights(): void {
    if (!this.terrainRaycaster) return;

    for (const cell of this.cells.values()) {
      const terrainY = this.terrainRaycaster(cell.x, cell.z);
      if (terrainY !== null && terrainY !== cell.terrainHeight) {
        cell.terrainHeight = terrainY;
      }
    }
  }

  /**
   * Register a tower and compute LOS for all cells within range
   * Samples terrain height at registration time (like old RouteLosGrid) for accurate LOS
   *
   * @param towerId Tower unique ID
   * @param towerX Tower X position (local coordinates)
   * @param towerZ Tower Z position (local coordinates)
   * @param tipY Tower tip Y position (for LOS origin)
   * @param range Tower targeting range
   * @param losRaycaster LOS raycaster function
   * @param isPureAirTower If true, skip LOS checks (air enemies are always visible)
   * @returns Array of cells visible from this tower
   */
  registerTower(
    towerId: string,
    towerX: number,
    towerZ: number,
    tipY: number,
    range: number,
    losRaycaster: LineOfSightRaycaster,
    isPureAirTower = false
  ): RouteCell[] {
    const visibleCells: RouteCell[] = [];
    const rangeSq = range * range;

    for (const cell of this.cells.values()) {
      // Check if cell is within tower range
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      if (distSq > rangeSq) continue;

      // Sample terrain height at tower placement time (tiles should be loaded)
      const terrainY = this.terrainRaycaster ? this.terrainRaycaster(cell.x, cell.z) : null;
      if (terrainY === null) continue;

      // Update cell terrain height
      cell.terrainHeight = terrainY;

      // Calculate LOS origin (offset from tower center towards cell)
      const dirX = cell.x - towerX;
      const dirZ = cell.z - towerZ;
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);

      let isVisible: boolean;
      if (isPureAirTower) {
        // Air towers can always see all cells in range (no LOS needed)
        isVisible = true;
      } else if (dirLen < 0.1) {
        // Cell is at tower center, always visible
        isVisible = true;
      } else {
        const originX = towerX + (dirX / dirLen) * this.LOS_OFFSET;
        const originZ = towerZ + (dirZ / dirLen) * this.LOS_OFFSET;

        // Target Y is slightly above terrain (enemy eye height ~1.5m)
        const targetY = terrainY + 1.5;

        // Raycast - returns true if BLOCKED
        const isBlocked = losRaycaster(
          originX, tipY, originZ,
          cell.x, targetY, cell.z
        );
        isVisible = !isBlocked;
      }

      // Store visibility result
      cell.towerVisibility.set(towerId, isVisible);

      if (isVisible) {
        visibleCells.push(cell);
      }
    }

    return visibleCells;
  }

  /**
   * Unregister a tower (remove LOS data from all cells)
   * @param towerId Tower ID to unregister
   */
  unregisterTower(towerId: string): void {
    for (const cell of this.cells.values()) {
      cell.towerVisibility.delete(towerId);
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
    const cellKeyX = Math.floor(localX / this.CELL_SIZE);
    const cellKeyZ = Math.floor(localZ / this.CELL_SIZE);
    const newCellKey = `${cellKeyX}_${cellKeyZ}`;

    const currentCellKey = this.enemyCellKeys.get(enemy.id);

    // If enemy is in same cell, nothing to do
    if (currentCellKey === newCellKey) return;

    // Remove from old cell
    if (currentCellKey) {
      const oldCell = this.cells.get(currentCellKey);
      if (oldCell) {
        oldCell.enemies.delete(enemy);
      }
    }

    // Add to new cell (if cell exists in our grid)
    const newCell = this.cells.get(newCellKey);
    if (newCell) {
      newCell.enemies.add(enemy);
      this.enemyCellKeys.set(enemy.id, newCellKey);
    } else {
      // Enemy moved outside tracked cells - remove from tracking
      this.enemyCellKeys.delete(enemy.id);
    }
  }

  /**
   * Remove enemy from grid (call when enemy dies or is removed)
   * @param enemy Enemy entity
   */
  removeEnemy(enemy: Enemy): void {
    const currentCellKey = this.enemyCellKeys.get(enemy.id);
    if (currentCellKey) {
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
  getEnemiesForTower(visibleCells: RouteCell[]): Enemy[] {
    const enemies: Enemy[] = [];
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
    const cellKeyX = Math.floor(localX / this.CELL_SIZE);
    const cellKeyZ = Math.floor(localZ / this.CELL_SIZE);
    return this.cells.get(`${cellKeyX}_${cellKeyZ}`);
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
    excludeId?: string
  ): Enemy[] {
    if (!this.coordinateSync) return [];

    const enemies: Enemy[] = [];
    const radiusSq = radiusMeters * radiusMeters;

    // Calculate cell range to check
    const cellRadius = Math.ceil(radiusMeters / this.CELL_SIZE);
    const centerCellX = Math.floor(localX / this.CELL_SIZE);
    const centerCellZ = Math.floor(localZ / this.CELL_SIZE);

    // Iterate only over cells within radius
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dz = -cellRadius; dz <= cellRadius; dz++) {
        const cellKey = `${centerCellX + dx}_${centerCellZ + dz}`;
        const cell = this.cells.get(cellKey);
        if (!cell) continue;

        // Check each enemy in cell
        for (const enemy of cell.enemies) {
          if (!enemy.alive) continue;
          if (excludeId && enemy.id === excludeId) continue;

          // Convert enemy geo position to local for precise distance check
          const enemyLocal = this.coordinateSync.geoToLocalSimple(
            enemy.position.lat,
            enemy.position.lon,
            0
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
   * @returns Array of alive enemies within radius
   */
  getEnemiesInRadiusGeo(
    center: GeoPosition,
    radiusMeters: number,
    excludeId?: string
  ): Enemy[] {
    if (!this.coordinateSync) {
      console.warn('[GlobalRouteGrid] getEnemiesInRadiusGeo called before initialization');
      return [];
    }

    const local = this.coordinateSync.geoToLocalSimple(center.lat, center.lon, center.height ?? 0);
    return this.getEnemiesInRadius(local.x, local.z, radiusMeters, excludeId);
  }

  /**
   * Check if position is visible from tower (uses pre-computed LOS)
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
  // VISUALIZATION
  // ========================================

  /** Map cell key to instance index for fast state updates */
  private cellIndexMap = new Map<string, number>();

  /**
   * Create visualization mesh (InstancedMesh with shader)
   * Call once, then use updateVisualization() each frame for color updates only
   */
  createVisualization(): THREE.InstancedMesh {
    this.disposeVisualization();

    const cellSize = this.CELL_SIZE * 0.85;
    const geometry = new THREE.BoxGeometry(cellSize, 0.15, cellSize);

    this.visualizationMaterial = new THREE.ShaderMaterial({
      vertexShader: LOS_CELL_VERTEX,
      fragmentShader: LOS_CELL_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const maxCells = Math.min(this.cells.size, this.MAX_VIZ_CELLS);
    this.visualization = new THREE.InstancedMesh(geometry, this.visualizationMaterial, maxCells);
    this.visualization.frustumCulled = false;
    this.visualization.renderOrder = 3;
    // Static usage - positions set once and don't change
    this.visualization.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    // Create cell state attribute (updated each frame for colors)
    const stateArray = new Float32Array(maxCells);
    this.cellStateAttribute = new THREE.InstancedBufferAttribute(stateArray, 1);
    this.cellStateAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aCellState', this.cellStateAttribute);

    // Initialize positions ONCE with live terrain sampling
    this.initializePositions();

    // Initial state update
    this.updateVisualization();

    return this.visualization;
  }

  /**
   * Initialize cell positions (called once when visualization is created)
   * Samples terrain heights live for accurate positioning
   */
  private initializePositions(): void {
    if (!this.visualization) return;

    const matrix = new THREE.Matrix4();
    let index = 0;
    this.cellIndexMap.clear();

    for (const cell of this.cells.values()) {
      if (index >= this.visualization.count) break;

      // Sample terrain height LIVE for accurate positioning
      const liveTerrainY = this.terrainRaycaster ? this.terrainRaycaster(cell.x, cell.z) : null;
      const y = (liveTerrainY ?? cell.terrainHeight) + 0.5;
      matrix.setPosition(cell.x, y, cell.z);
      this.visualization.setMatrixAt(index, matrix);

      // Store mapping for fast state updates
      this.cellIndexMap.set(cell.key, index);
      index++;
    }

    this.visualization.count = index;
    this.visualization.instanceMatrix.needsUpdate = true;
  }

  /**
   * Update visualization colors only (call each frame when visible)
   * FAST: Only updates state attribute, no terrain sampling or matrix updates
   */
  updateVisualization(): void {
    if (!this.visualization || !this.cellStateAttribute) return;

    let index = 0;
    for (const cell of this.cells.values()) {
      if (index >= this.visualization.count) break;

      // Determine cell state for coloring (no expensive operations)
      let state: number;
      const hasEnemies = cell.enemies.size > 0;
      const visibleByAnyTower = this.isVisibleByAnyTower(cell);

      if (hasEnemies && visibleByAnyTower) {
        state = 4; // Yellow: Enemy + visible = target
      } else if (hasEnemies) {
        state = 3; // Blue: Enemy in cell
      } else if (cell.towerVisibility.size === 0) {
        state = 0; // Gray: No tower registered
      } else if (visibleByAnyTower) {
        state = 1; // Green: Visible by at least one tower
      } else {
        state = 2; // Red: All towers blocked
      }

      this.cellStateAttribute.setX(index, state);
      index++;
    }

    this.cellStateAttribute.needsUpdate = true;
  }

  /**
   * Check if cell is visible by any registered tower
   */
  private isVisibleByAnyTower(cell: RouteCell): boolean {
    for (const visible of cell.towerVisibility.values()) {
      if (visible) return true;
    }
    return false;
  }

  /**
   * Update animation time (call each frame)
   * @param deltaTime Delta time in milliseconds
   */
  updateAnimation(deltaTime: number): void {
    this.animationTime += deltaTime * 0.001;
    // Wrap animation time to avoid floating point precision issues over time
    // 2*PI ensures seamless looping of sin() based animations
    if (this.animationTime > Math.PI * 2000) {
      this.animationTime = this.animationTime % (Math.PI * 2);
    }
    if (this.visualizationMaterial?.uniforms?.['uTime']) {
      this.visualizationMaterial.uniforms['uTime'].value = this.animationTime;
    }
  }

  /**
   * Get visualization mesh
   */
  getVisualization(): THREE.InstancedMesh | null {
    return this.visualization;
  }

  /**
   * Dispose visualization resources
   */
  disposeVisualization(): void {
    if (this.visualization) {
      this.visualization.geometry.dispose();
      this.visualization = null;
    }
    if (this.visualizationMaterial) {
      this.visualizationMaterial.dispose();
      this.visualizationMaterial = null;
    }
    this.cellStateAttribute = null;
    this.cellIndexMap.clear();
  }

  // ========================================
  // PER-TOWER VISUALIZATION
  // ========================================

  /**
   * Create visualization for a specific tower's LOS coverage
   * Shows all cells within range: green = visible, red = blocked
   * Used when tower is selected (always visible, not just debug mode)
   *
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
    const rangeSq = range * range;
    const cellsInRange: { cell: RouteCell; isVisible: boolean }[] = [];

    // Collect all cells within tower range that have visibility data
    // Only include cells that were processed in registerTower (have towerVisibility set)
    for (const cell of this.cells.values()) {
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      if (distSq <= rangeSq) {
        // Only include cells that have visibility data for this tower
        // Cells without data were skipped in registerTower (no terrain loaded)
        if (cell.towerVisibility.has(towerId)) {
          const isVisible = cell.towerVisibility.get(towerId)!;
          cellsInRange.push({ cell, isVisible });
        }
      }
    }

    if (cellsInRange.length === 0) return null;

    const cellSize = this.CELL_SIZE * 0.85;
    const geometry = new THREE.BoxGeometry(cellSize, 0.15, cellSize);

    const material = new THREE.ShaderMaterial({
      vertexShader: TOWER_LOS_VERTEX,
      fragmentShader: TOWER_LOS_FRAGMENT,
      uniforms: {
        uTime: { value: this.animationTime },
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, cellsInRange.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;

    // Build instance matrices and blocked state attribute
    const isBlockedArray = new Float32Array(cellsInRange.length);
    const matrix = new THREE.Matrix4();

    for (let i = 0; i < cellsInRange.length; i++) {
      const { cell, isVisible } = cellsInRange[i];
      const y = cell.terrainHeight + 0.5;
      matrix.setPosition(cell.x, y, cell.z);
      mesh.setMatrixAt(i, matrix);

      // 0 = visible (green), 1 = blocked (red)
      isBlockedArray[i] = isVisible ? 0 : 1;
    }

    // Add aIsBlocked as instanced attribute
    geometry.setAttribute(
      'aIsBlocked',
      new THREE.InstancedBufferAttribute(isBlockedArray, 1)
    );

    mesh.instanceMatrix.needsUpdate = true;

    return mesh;
  }

  /**
   * Update tower visualization animation time
   * Call this each frame for selected tower's visualization
   */
  updateTowerVisualizationTime(mesh: THREE.InstancedMesh): void {
    const material = mesh.material as THREE.ShaderMaterial;
    if (material?.uniforms?.['uTime']) {
      material.uniforms['uTime'].value = this.animationTime;
    }
  }

  // ========================================
  // PROGRESSIVE PLACEMENT PREVIEW
  // ========================================

  /** State for progressive preview building */
  private previewState: {
    mesh: THREE.InstancedMesh;
    cells: RouteCell[];
    towerX: number;
    towerZ: number;
    tipY: number;
    losRaycaster: LineOfSightRaycaster;
    isBlockedArray: Float32Array;
    currentIndex: number;
    batchSize: number;
    isPureAirTower: boolean;
  } | null = null;

  /**
   * Start progressive placement preview (for build mode)
   * Returns mesh immediately, call continuePreviewBuild() each frame to populate
   *
   * @param towerX Tower X position (local coordinates)
   * @param towerZ Tower Z position (local coordinates)
   * @param tipY Tower tip Y position (for LOS origin)
   * @param range Tower targeting range
   * @param losRaycaster LOS raycaster function
   * @param isPureAirTower If true, skip LOS checks (all cells visible)
   * @returns InstancedMesh (empty initially) or null if no cells
   */
  createPlacementPreview(
    towerX: number,
    towerZ: number,
    tipY: number,
    range: number,
    losRaycaster: LineOfSightRaycaster,
    isPureAirTower = false
  ): THREE.InstancedMesh | null {
    // Cancel any ongoing preview build
    this.previewState = null;

    const rangeSq = range * range;
    const cellsInRange: RouteCell[] = [];

    // Collect cells in range (no LOS computation yet)
    for (const cell of this.cells.values()) {
      const distSq = (cell.x - towerX) ** 2 + (cell.z - towerZ) ** 2;
      if (distSq <= rangeSq) {
        cellsInRange.push(cell);
      }
    }

    if (cellsInRange.length === 0) return null;

    // Sort by distance from tower (radiates outward from center)
    cellsInRange.sort((a, b) => {
      const distA = (a.x - towerX) ** 2 + (a.z - towerZ) ** 2;
      const distB = (b.x - towerX) ** 2 + (b.z - towerZ) ** 2;
      return distA - distB;
    });

    // Create mesh with full capacity but count=0
    const cellSize = this.CELL_SIZE * 0.85;
    const geometry = new THREE.BoxGeometry(cellSize, 0.15, cellSize);

    const material = new THREE.ShaderMaterial({
      vertexShader: TOWER_LOS_VERTEX,
      fragmentShader: TOWER_LOS_FRAGMENT,
      uniforms: {
        uTime: { value: this.animationTime },
      },
      defines: {
        USE_INSTANCING: '',
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, cellsInRange.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.count = 0; // Start empty

    // Pre-allocate attribute array
    const isBlockedArray = new Float32Array(cellsInRange.length);
    geometry.setAttribute('aIsBlocked', new THREE.InstancedBufferAttribute(isBlockedArray, 1));
    (geometry.getAttribute('aIsBlocked') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);

    // Store state for progressive building
    this.previewState = {
      mesh,
      cells: cellsInRange,
      towerX,
      towerZ,
      tipY,
      losRaycaster,
      isBlockedArray,
      currentIndex: 0,
      batchSize: 25, // Process 25 cells per frame (~60fps = ~400 cells/sec)
      isPureAirTower,
    };

    return mesh;
  }

  /**
   * Continue building the placement preview
   * Call each frame until it returns true (complete)
   * @returns true when preview is fully built
   */
  continuePreviewBuild(): boolean {
    if (!this.previewState) return true;

    const { mesh, cells, towerX, towerZ, tipY, losRaycaster, isBlockedArray, batchSize, currentIndex, isPureAirTower } = this.previewState;

    const matrix = new THREE.Matrix4();
    const endIndex = Math.min(currentIndex + batchSize, cells.length);

    for (let i = currentIndex; i < endIndex; i++) {
      const cell = cells[i];

      // Sample terrain height
      const terrainY = this.terrainRaycaster ? this.terrainRaycaster(cell.x, cell.z) : null;
      if (terrainY === null) continue;

      // Calculate LOS (skip for air towers - they can see everything)
      let isVisible: boolean;
      if (isPureAirTower) {
        isVisible = true;
      } else {
        const dirX = cell.x - towerX;
        const dirZ = cell.z - towerZ;
        const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);

        if (dirLen < 0.1) {
          isVisible = true;
        } else {
          const originX = towerX + (dirX / dirLen) * this.LOS_OFFSET;
          const originZ = towerZ + (dirZ / dirLen) * this.LOS_OFFSET;
          const targetY = terrainY + 1.5;
          isVisible = !losRaycaster(originX, tipY, originZ, cell.x, targetY, cell.z);
        }
      }

      // Set matrix and attribute
      matrix.setPosition(cell.x, terrainY + 0.5, cell.z);
      mesh.setMatrixAt(i, matrix);
      isBlockedArray[i] = isVisible ? 0 : 1;
    }

    // Update mesh
    mesh.count = endIndex;
    mesh.instanceMatrix.needsUpdate = true;
    (mesh.geometry.getAttribute('aIsBlocked') as THREE.BufferAttribute).needsUpdate = true;

    this.previewState.currentIndex = endIndex;

    // Check if complete
    if (endIndex >= cells.length) {
      this.previewState = null;
      return true;
    }

    return false;
  }

  /**
   * Cancel ongoing preview build
   */
  cancelPreviewBuild(): void {
    this.previewState = null;
  }

  /**
   * Dispose a placement preview mesh
   */
  disposePlacementPreview(mesh: THREE.InstancedMesh): void {
    this.previewState = null;
    mesh.geometry.dispose();
    (mesh.material as THREE.ShaderMaterial).dispose();
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.cells.clear();
    this.enemyCellKeys.clear();
    this.disposeVisualization();
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clear();
    this.terrainRaycaster = null;
    this.coordinateSync = null;
  }
}
