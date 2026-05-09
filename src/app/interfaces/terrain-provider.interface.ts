import * as THREE from 'three';

/**
 * TerrainProvider Interface
 *
 * Abstracts terrain operations for both real Google 3D Tiles and DevWorld fake terrain.
 * All terrain-dependent code should use this interface instead of direct TilesRenderer access.
 */
export interface TerrainProvider {
  /**
   * Initialize the terrain provider.
   * For real tiles: loads Google 3D Tiles
   * For DevWorld: creates heightmap-based terrain + buildings
   */
  initialize(scene: THREE.Scene): Promise<void>;

  /**
   * Get terrain height at geographic coordinates.
   * @returns Height in meters, or null if not available
   */
  getHeightAtGeo(lat: number, lon: number): number | null;

  /**
   * Get terrain height at local scene coordinates.
   * @returns Height in meters, or null if not available
   */
  getHeightAtLocal(x: number, z: number): number | null;

  /**
   * Get the local skyline Y at (x, z) — i.e. the highest hit (terrain or
   * building roof) in a small neighbourhood. Used by air-LOS pre-compute
   * and skyline-adaptive air enemy flight altitude.
   * @returns Skyline height in meters (local Y), or null if not available
   */
  getSkylineHeightAtLocal(x: number, z: number, sampleRadius?: number): number | null;

  /**
   * Raycast from screen coordinates to terrain.
   * Used for mouse picking / tower placement.
   * @returns World position of hit, or null if no hit
   */
  raycastFromScreen(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer
  ): THREE.Vector3 | null;

  /**
   * Raycast straight down from a position.
   * @returns World position of hit, or null if no hit
   */
  raycastDown(x: number, z: number, fromHeight?: number): THREE.Vector3 | null;

  /**
   * Check line of sight between two 3D points.
   * @returns true if LOS is BLOCKED (hit terrain/building), false if clear
   */
  hasLineOfSightBlocked(
    originX: number,
    originY: number,
    originZ: number,
    targetX: number,
    targetY: number,
    targetZ: number
  ): boolean;

  /**
   * Get terrain meshes for external raycasting.
   * Used by tower range indicators etc.
   */
  getTerrainMeshes(): THREE.Object3D[];

  /**
   * Get building meshes for LOS checks.
   */
  getBuildingMeshes(): THREE.Object3D[];

  /**
   * Clear height cache (called when terrain updates).
   */
  clearHeightCache(): void;

  /**
   * Update terrain (for animated tiles etc.).
   */
  update?(deltaTime: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer): void;

  /**
   * Check if terrain is ready/loaded.
   */
  isReady(): boolean;

  /**
   * Cleanup resources.
   */
  dispose(): void;
}

/**
 * Configuration for coordinate transformation.
 * DevWorld uses a fixed fake origin, real world uses actual GPS.
 */
export interface TerrainOrigin {
  lat: number;
  lon: number;
  height: number;
}
