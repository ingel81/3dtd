import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { TerrainProvider } from '../interfaces/terrain-provider.interface';
import { EllipsoidSync } from '../three-engine/ellipsoid-sync';

/**
 * TilesTerrainProvider
 *
 * Wrapper around the existing TilesRenderer code to implement TerrainProvider interface.
 * This allows the same interface to be used for both real Google 3D Tiles and DevWorld.
 *
 * Note: This provider delegates to the TilesRenderer and EllipsoidSync that are
 * already initialized by ThreeTilesEngine. It does not own these resources.
 */
export class TilesTerrainProvider implements TerrainProvider {
  private ready = false;
  private raycaster = new THREE.Raycaster();
  private heightCache = new Map<string, number>();
  private readonly CACHE_PRECISION = 5;

  constructor(
    private tilesRenderer: TilesRenderer,
    private sync: EllipsoidSync
  ) {}

  async initialize(_scene: THREE.Scene): Promise<void> {
    // TilesRenderer is already initialized by ThreeTilesEngine
    // We just mark ourselves as ready
    this.ready = true;
  }

  getHeightAtGeo(lat: number, lon: number): number | null {
    // Check cache first
    const cacheKey = this.getHeightCacheKey(lat, lon);
    if (this.heightCache.has(cacheKey)) {
      return this.heightCache.get(cacheKey)!;
    }

    // Get local position
    const localPos = this.sync.geoToLocalSimple(lat, lon, 0);

    // Do the raycast
    const height = this.raycastTerrainHeight(localPos.x, localPos.z);

    // Cache the result
    if (height !== null) {
      this.heightCache.set(cacheKey, height);
    }

    return height;
  }

  getHeightAtLocal(x: number, z: number): number | null {
    return this.raycastTerrainHeight(x, z);
  }

  private raycastTerrainHeight(localX: number, localZ: number): number | null {
    if (!this.tilesRenderer) return null;

    // Check if tiles are loaded
    let meshCount = 0;
    this.tilesRenderer.group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) meshCount++;
    });

    if (meshCount === 0) {
      return null;
    }

    // Raycast from high above straight down
    const rayOrigin = new THREE.Vector3(localX, 10000, localZ);
    const direction = new THREE.Vector3(0, -1, 0);

    this.raycaster.set(rayOrigin, direction);
    this.raycaster.far = 20000;

    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

    if (results.length > 0) {
      return results[0].point.y;
    }

    return null;
  }

  raycastFromScreen(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer
  ): THREE.Vector3 | null {
    if (!this.tilesRenderer) return null;

    // Convert screen coords to normalized device coordinates
    const rect = renderer.domElement.getBoundingClientRect();
    const ndcX = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((screenY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

    const intersects = this.raycaster.intersectObject(this.tilesRenderer.group, true);

    if (intersects.length > 0) {
      return intersects[0].point.clone();
    }
    return null;
  }

  raycastDown(x: number, z: number, fromHeight = 10000): THREE.Vector3 | null {
    if (!this.tilesRenderer) return null;

    const origin = new THREE.Vector3(x, fromHeight, z);
    const direction = new THREE.Vector3(0, -1, 0);
    this.raycaster.set(origin, direction);

    const intersects = this.raycaster.intersectObject(this.tilesRenderer.group, true);
    if (intersects.length > 0) {
      return intersects[0].point.clone();
    }
    return null;
  }

  hasLineOfSightBlocked(
    originX: number,
    originY: number,
    originZ: number,
    targetX: number,
    targetY: number,
    targetZ: number
  ): boolean {
    if (!this.tilesRenderer) return false;

    const origin = new THREE.Vector3(originX, originY, originZ);
    const target = new THREE.Vector3(targetX, targetY, targetZ);
    const direction = target.clone().sub(origin);
    const distance = direction.length();
    direction.normalize();

    this.raycaster.set(origin, direction);
    this.raycaster.far = distance - 0.5; // Stop slightly before target

    const results = this.raycaster.intersectObject(this.tilesRenderer.group, true);

    return results.length > 0;
  }

  getTerrainMeshes(): THREE.Object3D[] {
    if (!this.tilesRenderer) return [];
    return [this.tilesRenderer.group];
  }

  getBuildingMeshes(): THREE.Object3D[] {
    // Buildings are part of the tiles, not separate
    return [];
  }

  clearHeightCache(): void {
    this.heightCache.clear();
  }

  update(deltaTime: number, camera: THREE.Camera, renderer: THREE.WebGLRenderer): void {
    if (this.tilesRenderer) {
      this.tilesRenderer.update();
      this.tilesRenderer.setCamera(camera);
      this.tilesRenderer.setResolutionFromRenderer(camera, renderer);
    }
  }

  isReady(): boolean {
    return this.ready && this.tilesRenderer !== null;
  }

  dispose(): void {
    // We don't own the TilesRenderer, so we don't dispose it
    this.heightCache.clear();
    this.ready = false;
  }

  private getHeightCacheKey(lat: number, lon: number): string {
    return `${lat.toFixed(this.CACHE_PRECISION)}_${lon.toFixed(this.CACHE_PRECISION)}`;
  }
}
