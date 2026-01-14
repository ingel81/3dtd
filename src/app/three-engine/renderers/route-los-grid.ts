import * as THREE from 'three';
import { CoordinateSync } from './index';
import { GeoPosition } from '../../models/game.types';
import { LineOfSightRaycaster, TerrainRaycaster } from './three-tower.renderer';

/**
 * ShaderMaterial vertex shader with Three.js instancing support
 * KEY: Must use #ifdef USE_INSTANCING pattern like Three.js internal shaders
 */
const LOS_CELL_VERTEX = /* glsl */ `
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

/**
 * ShaderMaterial fragment shader
 */
const LOS_CELL_FRAGMENT = /* glsl */ `
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

  /** Corridor width from route center in meters (covers lateralOffset ±2m + generous safety) */
  private readonly CORRIDOR_WIDTH = 7;

  /** LOS offset from tower center (same as in three-tower.renderer.ts) */
  private readonly LOS_OFFSET = 2.4;

  /** Debug statistics */
  private stats = { totalCells: 0, visibleCells: 0, blockedCells: 0 };

  /** Visualization mesh (InstancedMesh) */
  private visualization: THREE.InstancedMesh | null = null;
  private visualizationMaterial: THREE.ShaderMaterial | null = null;

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

    console.log(`[RouteLosGrid] generateFromRoutes: tower at (${this.towerX.toFixed(1)}, ${this.towerTipY.toFixed(1)}, ${this.towerZ.toFixed(1)}), range=${this.towerRange}`);

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
   * Generate cells in a circular area around a route sample point
   * Uses radial pattern to avoid gaps at route curves
   */
  private generateCorridorCells(
    centerX: number,
    centerZ: number,
    _segStart: { x: number; z: number },
    _segEnd: { x: number; z: number },
    processedCells: Set<string>,
    rangeSquared: number
  ): void {
    // Generate cells in a square area around the sample point, then filter by corridor width
    const corridorWidthSq = this.CORRIDOR_WIDTH * this.CORRIDOR_WIDTH;
    const numCells = Math.ceil(this.CORRIDOR_WIDTH / this.CELL_SIZE);

    for (let dx = -numCells; dx <= numCells; dx++) {
      for (let dz = -numCells; dz <= numCells; dz++) {
        const cellX = centerX + dx * this.CELL_SIZE;
        const cellZ = centerZ + dz * this.CELL_SIZE;

        // Check if within corridor width (circular, not square)
        const distToRouteSq = dx * dx + dz * dz;
        if (distToRouteSq * this.CELL_SIZE * this.CELL_SIZE > corridorWidthSq) continue;

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
   * Create performant visualization using InstancedMesh with custom shader
   * Used for tower selection and build preview
   * Features animated pulsing opacity
   */
  createVisualization(): THREE.InstancedMesh | null {
    if (this.cells.size === 0) return null;

    const cellCount = this.cells.size;
    const cellSize = this.CELL_SIZE * 0.85; // Slight gap between cells

    // Flat box geometry - same as BasicMaterial version
    const geometry = new THREE.BoxGeometry(cellSize, 0.15, cellSize);

    // ShaderMaterial with explicit USE_INSTANCING define
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
      depthTest: false,   // Don't test against depth buffer - always render
      depthWrite: false,  // Don't write to depth buffer
      side: THREE.DoubleSide,
    });

    // Create instanced mesh
    const mesh = new THREE.InstancedMesh(geometry, this.visualizationMaterial, cellCount);
    mesh.renderOrder = 3;

    // Build instance matrices and blocked state attribute
    const isBlockedArray = new Float32Array(cellCount);
    const matrix = new THREE.Matrix4();

    let index = 0;
    for (const [key, visible] of this.cells) {
      const parts = key.split('_');
      const cellKeyX = parseInt(parts[0], 10);
      const cellKeyZ = parseInt(parts[1], 10);

      const cellCenterX = (cellKeyX + 0.5) * this.CELL_SIZE;
      const cellCenterZ = (cellKeyZ + 0.5) * this.CELL_SIZE;

      const terrainY = this.terrainRaycaster(cellCenterX, cellCenterZ);
      const y = terrainY !== null ? terrainY + 0.3 : this.towerTipY;

      matrix.setPosition(cellCenterX, y, cellCenterZ);
      mesh.setMatrixAt(index, matrix);

      // 0 = visible (green), 1 = blocked (red)
      isBlockedArray[index] = visible ? 0 : 1;
      index++;
    }

    // Add aIsBlocked as instanced attribute BEFORE setting needsUpdate
    geometry.setAttribute(
      'aIsBlocked',
      new THREE.InstancedBufferAttribute(isBlockedArray, 1)
    );

    mesh.instanceMatrix.needsUpdate = true;

    // CRITICAL: Disable frustum culling - instances can be culled incorrectly
    mesh.frustumCulled = false;

    // DEBUG: Log shader creation
    console.log('[RouteLosGrid] Shader visualization created:', {
      cellCount,
      hasGeometry: !!geometry,
      hasAttribute: !!geometry.getAttribute('aIsBlocked'),
      attributeCount: (geometry.getAttribute('aIsBlocked') as THREE.BufferAttribute)?.count,
      material: this.visualizationMaterial?.type,
      uniforms: Object.keys(this.visualizationMaterial?.uniforms || {}),
      frustumCulled: mesh.frustumCulled,
      visible: mesh.visible,
      renderOrder: mesh.renderOrder,
    });

    this.visualization = mesh;
    return mesh;
  }

  /**
   * Fallback: Non-shader version using MeshBasicMaterial
   * Use this if shader version has issues
   */
  createVisualizationBasic(): THREE.InstancedMesh | null {
    if (this.cells.size === 0) return null;

    const cellCount = this.cells.size;
    const cellSize = this.CELL_SIZE * 0.85;

    const geometry = new THREE.BoxGeometry(cellSize, 0.15, cellSize);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });

    const mesh = new THREE.InstancedMesh(geometry, material, cellCount);
    mesh.renderOrder = 3;

    const matrix = new THREE.Matrix4();
    const greenColor = new THREE.Color(0x22c55e);
    const redColor = new THREE.Color(0xdc2626);

    let index = 0;
    for (const [key, visible] of this.cells) {
      const parts = key.split('_');
      const cellKeyX = parseInt(parts[0], 10);
      const cellKeyZ = parseInt(parts[1], 10);

      const cellCenterX = (cellKeyX + 0.5) * this.CELL_SIZE;
      const cellCenterZ = (cellKeyZ + 0.5) * this.CELL_SIZE;

      const terrainY = this.terrainRaycaster(cellCenterX, cellCenterZ);
      const y = terrainY !== null ? terrainY + 0.3 : this.towerTipY;

      matrix.setPosition(cellCenterX, y, cellCenterZ);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, visible ? greenColor : redColor);
      index++;
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.visualization = mesh;
    return mesh;
  }

  /**
   * Update animation time (call each frame)
   * @param time Time in seconds
   */
  updateAnimation(time: number): void {
    if (this.visualizationMaterial?.uniforms?.['uTime']) {
      this.visualizationMaterial.uniforms['uTime'].value = time;
    }
  }

  /**
   * Get the visualization mesh
   */
  getVisualization(): THREE.InstancedMesh | null {
    return this.visualization;
  }

  /**
   * Create debug visualization showing all grid cells
   * Green cubes = visible, Red cubes = blocked
   * @deprecated Use createVisualization() instead
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

    if (this.visualization) {
      this.visualization.geometry.dispose();
      if (this.visualizationMaterial) {
        this.visualizationMaterial.dispose();
      }
      this.visualization = null;
      this.visualizationMaterial = null;
    }
  }
}
