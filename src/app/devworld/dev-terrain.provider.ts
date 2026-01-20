import * as THREE from 'three';
import { TerrainProvider } from '../interfaces/terrain-provider.interface';
import { DevWorldService, DEV_WORLD_SIZE, DEV_WORLD_MAX_HEIGHT } from './devworld.service';
import { getBuildingPreset, BuildingConfig } from './configs/building-presets.config';

/**
 * DevTerrainProvider
 *
 * Implements TerrainProvider for DevWorld using:
 * - Heightmap-based terrain (PlaneGeometry with vertex displacement)
 * - Box meshes for buildings (LOS blockers)
 * - Grid shader for visual appearance
 */
export class DevTerrainProvider implements TerrainProvider {
  private scene: THREE.Scene | null = null;
  private terrainMesh: THREE.Mesh | null = null;
  private terrainGroup: THREE.Group = new THREE.Group();
  private buildings: THREE.Mesh[] = [];
  private heightData: Float32Array | null = null;
  private heightmapSize = 1024;
  private ready = false;

  // Raycaster for terrain queries
  private raycaster = new THREE.Raycaster();
  private downDirection = new THREE.Vector3(0, -1, 0);
  private ndcCoords = new THREE.Vector2(); // Reusable for screen raycast

  // Reusable vectors for LOS raycasting (avoid GC pressure)
  private losOrigin = new THREE.Vector3();
  private losTarget = new THREE.Vector3();
  private losDirection = new THREE.Vector3();
  private rayDownOrigin = new THREE.Vector3(); // For raycastDown

  // Cached raycast targets (terrain + buildings) - updated when buildings change
  private raycastTargets: THREE.Object3D[] = [];

  // Height cache for performance
  private heightCache = new Map<string, number>();
  private readonly CACHE_PRECISION = 5; // decimal places

  constructor(private devWorld: DevWorldService) {}

  async initialize(scene: THREE.Scene): Promise<void> {
    this.scene = scene;

    console.log('[DevTerrain] Initializing...');
    const startTime = performance.now();

    // Load heightmap
    await this.loadHeightmap();

    // Create terrain mesh
    this.createTerrainMesh();

    // Add buildings
    this.createBuildings();

    // Build cached raycast targets (for LOS checks)
    this.rebuildRaycastTargets();

    // Add to scene
    scene.add(this.terrainGroup);

    this.ready = true;
    console.log(`[DevTerrain] Initialized in ${(performance.now() - startTime).toFixed(0)}ms`);
  }

  private async loadHeightmap(): Promise<void> {
    const preset = this.devWorld.config.terrain;
    const url = `/assets/devworld/heightmaps/${preset}.png`;

    try {
      const image = await this.loadImage(url);
      this.heightData = this.extractHeightData(image);
      this.heightmapSize = image.width;
      console.log(`[DevTerrain] Loaded heightmap: ${preset} (${this.heightmapSize}x${this.heightmapSize})`);
    } catch {
      console.warn(`[DevTerrain] Failed to load heightmap ${url}, generating flat terrain`);
      this.generateFlatHeightmap();
    }
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  private extractHeightData(image: HTMLImageElement): Float32Array {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);

    const imageData = ctx.getImageData(0, 0, image.width, image.height);
    const data = new Float32Array(image.width * image.height);

    for (let i = 0; i < data.length; i++) {
      // Use red channel (grayscale), normalize to 0-1, then scale to max height
      const value = imageData.data[i * 4] / 255;
      data[i] = value * DEV_WORLD_MAX_HEIGHT;
    }

    return data;
  }

  private generateFlatHeightmap(): void {
    this.heightmapSize = 1024;
    this.heightData = new Float32Array(this.heightmapSize * this.heightmapSize);
    // All zeros = flat terrain
  }

  private createTerrainMesh(): void {
    const size = DEV_WORLD_SIZE;
    // Use LOW segment count for fast raycasting (64x64 = 4096 vertices vs 512x512 = 262144!)
    // Height sampling uses heightmap directly, not mesh vertices
    const segments = 64;

    // Create plane geometry
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2); // Make horizontal

    // Apply heightmap to vertices
    this.applyHeightmapToGeometry(geometry);

    // Compute normals for proper lighting
    geometry.computeVertexNormals();

    // Create grid shader material
    const material = this.createGridMaterial();

    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.name = 'DevWorldTerrain';
    this.terrainMesh.receiveShadow = true;

    this.terrainGroup.add(this.terrainMesh);
  }

  private applyHeightmapToGeometry(geometry: THREE.PlaneGeometry): void {
    if (!this.heightData) return;

    const positions = geometry.attributes['position'];
    const halfSize = DEV_WORLD_SIZE / 2;

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);

      // Map world coords to heightmap coords
      const u = (x + halfSize) / DEV_WORLD_SIZE;
      const v = (z + halfSize) / DEV_WORLD_SIZE;

      const height = this.sampleHeightmap(u, v);
      positions.setY(i, height);
    }

    positions.needsUpdate = true;
  }

  /**
   * Sample heightmap with bilinear interpolation
   */
  private sampleHeightmap(u: number, v: number): number {
    if (!this.heightData) return 0;

    // Clamp UV
    u = Math.max(0, Math.min(1, u));
    v = Math.max(0, Math.min(1, v));

    const size = this.heightmapSize;
    const fx = u * (size - 1);
    const fz = v * (size - 1);

    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const x1 = Math.min(x0 + 1, size - 1);
    const z1 = Math.min(z0 + 1, size - 1);

    const tx = fx - x0;
    const tz = fz - z0;

    // Sample 4 corners
    const h00 = this.heightData[z0 * size + x0];
    const h10 = this.heightData[z0 * size + x1];
    const h01 = this.heightData[z1 * size + x0];
    const h11 = this.heightData[z1 * size + x1];

    // Bilinear interpolation
    const h0 = h00 * (1 - tx) + h10 * tx;
    const h1 = h01 * (1 - tx) + h11 * tx;
    return h0 * (1 - tz) + h1 * tz;
  }

  private createGridMaterial(): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        baseColor: { value: new THREE.Color(0x2a3a2a) }, // Dark green
        gridColor: { value: new THREE.Color(0x4a5a4a) }, // Lighter green
        majorGridColor: { value: new THREE.Color(0x6a7a6a) }, // Even lighter
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        varying vec3 vNormal;

        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 baseColor;
        uniform vec3 gridColor;
        uniform vec3 majorGridColor;

        varying vec3 vWorldPosition;
        varying vec3 vNormal;

        void main() {
          // Grid lines at 10m intervals
          float grid10 = step(0.92, fract(vWorldPosition.x / 10.0)) +
                         step(0.92, fract(vWorldPosition.z / 10.0));
          grid10 = clamp(grid10, 0.0, 1.0);

          // Major grid lines at 50m intervals
          float grid50 = step(0.96, fract(vWorldPosition.x / 50.0)) +
                         step(0.96, fract(vWorldPosition.z / 50.0));
          grid50 = clamp(grid50, 0.0, 1.0);

          // Simple directional lighting
          vec3 lightDir = normalize(vec3(0.5, 1.0, 0.3));
          float diffuse = max(dot(vNormal, lightDir), 0.0) * 0.5 + 0.5;

          // Combine colors
          vec3 color = baseColor;
          color = mix(color, gridColor, grid10 * 0.4);
          color = mix(color, majorGridColor, grid50 * 0.6);
          color *= diffuse;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
  }

  private createBuildings(): void {
    const preset = this.devWorld.config.buildings;
    const buildingConfigs = getBuildingPreset(preset);

    const material = new THREE.MeshStandardMaterial({
      color: 0x555566,
      roughness: 0.8,
      metalness: 0.1,
    });

    for (const config of buildingConfigs) {
      const building = this.createBuilding(config, material);
      this.buildings.push(building);
      this.terrainGroup.add(building);
    }

    console.log(`[DevTerrain] Created ${this.buildings.length} buildings (preset: ${preset})`);
  }

  private createBuilding(config: BuildingConfig, material: THREE.Material): THREE.Mesh {
    const { width, height, depth } = config.size;
    const geometry = new THREE.BoxGeometry(width, height, depth);

    // Get terrain height at building position
    const terrainHeight = this.getHeightAtLocal(config.position.x, config.position.z) || 0;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      config.position.x,
      terrainHeight + height / 2, // Place on top of terrain
      config.position.z
    );

    if (config.rotation) {
      mesh.rotation.y = config.rotation;
    }

    mesh.name = `Building_${config.id}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    return mesh;
  }

  /**
   * Rebuild cached raycast targets array (terrain + buildings)
   * Call after terrain or buildings change
   */
  private rebuildRaycastTargets(): void {
    this.raycastTargets = [];
    if (this.terrainMesh) {
      this.raycastTargets.push(this.terrainMesh);
    }
    this.raycastTargets.push(...this.buildings);
  }

  // ========================================
  // TerrainProvider Interface Implementation
  // ========================================

  getHeightAtGeo(lat: number, lon: number): number | null {
    const local = this.devWorld.geoToLocal(lat, lon);
    return this.getHeightAtLocal(local.x, local.z);
  }

  getHeightAtLocal(x: number, z: number): number | null {
    if (!this.heightData) return null;

    // Check cache
    const cacheKey = `${x.toFixed(this.CACHE_PRECISION)}_${z.toFixed(this.CACHE_PRECISION)}`;
    const cached = this.heightCache.get(cacheKey);
    if (cached !== undefined) return cached;

    // Check bounds
    const halfSize = DEV_WORLD_SIZE / 2;
    if (Math.abs(x) > halfSize || Math.abs(z) > halfSize) {
      return null;
    }

    // Map to UV coordinates
    const u = (x + halfSize) / DEV_WORLD_SIZE;
    const v = (z + halfSize) / DEV_WORLD_SIZE;

    const height = this.sampleHeightmap(u, v);

    // Cache result
    this.heightCache.set(cacheKey, height);
    return height;
  }

  raycastFromScreen(
    screenX: number,
    screenY: number,
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer
  ): THREE.Vector3 | null {
    if (!this.terrainMesh) {
      console.log('[DevTerrain] raycastFromScreen: no terrainMesh');
      return null;
    }

    // Convert screen coords to normalized device coordinates (reuse vector)
    const rect = renderer.domElement.getBoundingClientRect();
    this.ndcCoords.set(
      ((screenX - rect.left) / rect.width) * 2 - 1,
      -((screenY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(this.ndcCoords, camera);

    // IMPORTANT: Reset raycaster range - hasLineOfSightBlocked modifies .far
    this.raycaster.near = 0;
    this.raycaster.far = Infinity;

    // Ensure world matrices are updated for raycasting
    this.terrainGroup.updateMatrixWorld(true);

    // Raycast against terrain group (includes terrain and buildings)
    const intersects = this.raycaster.intersectObject(this.terrainGroup, true);

    if (intersects.length > 0) {
      return intersects[0].point.clone();
    }
    return null;
  }

  raycastDown(x: number, z: number, fromHeight = 10000): THREE.Vector3 | null {
    if (!this.terrainMesh) return null;

    // Reuse vector to avoid GC pressure
    this.rayDownOrigin.set(x, fromHeight, z);
    this.raycaster.set(this.rayDownOrigin, this.downDirection);

    // Reset raycaster range (hasLineOfSightBlocked modifies .far)
    this.raycaster.near = 0;
    this.raycaster.far = Infinity;

    const intersects = this.raycaster.intersectObject(this.terrainMesh, false);
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
    if (!this.terrainMesh) return false;

    // Reuse vectors to avoid GC pressure during tower placement
    this.losOrigin.set(originX, originY, originZ);
    this.losTarget.set(targetX, targetY, targetZ);
    this.losDirection.copy(this.losTarget).sub(this.losOrigin).normalize();
    const distance = this.losOrigin.distanceTo(this.losTarget);

    this.raycaster.set(this.losOrigin, this.losDirection);
    this.raycaster.far = distance;

    // Check against cached terrain and buildings array
    const intersects = this.raycaster.intersectObjects(this.raycastTargets, false);

    // LOS is blocked if we hit something before reaching target
    for (const hit of intersects) {
      if (hit.distance < distance - 0.1) {
        return true; // Blocked
      }
    }

    return false; // Clear LOS
  }

  getTerrainMeshes(): THREE.Object3D[] {
    return this.terrainMesh ? [this.terrainMesh] : [];
  }

  getBuildingMeshes(): THREE.Object3D[] {
    return [...this.buildings];
  }

  clearHeightCache(): void {
    this.heightCache.clear();
  }

  update(_deltaTime: number, _camera: THREE.Camera, _renderer: THREE.WebGLRenderer): void {
    // DevWorld terrain is static, no update needed
  }

  isReady(): boolean {
    return this.ready;
  }

  dispose(): void {
    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }

    for (const building of this.buildings) {
      building.geometry.dispose();
    }

    if (this.scene && this.terrainGroup.parent === this.scene) {
      this.scene.remove(this.terrainGroup);
    }

    this.heightData = null;
    this.heightCache.clear();
    this.ready = false;
  }
}
