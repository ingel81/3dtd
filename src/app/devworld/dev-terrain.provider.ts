import * as THREE from 'three';
import { TerrainProvider } from '../interfaces/terrain-provider.interface';
import { DevWorldService, DEV_WORLD_SIZE, DEV_WORLD_MAX_HEIGHT, DEV_WORLD_HEIGHTMAP_SIZE } from './devworld.service';
import { TerrainGenerator, TerrainPreset } from './generators/terrain-generator';
import { BuildingConfig, BuildingDensity } from './generators/building-generator';
import { StreetSegment, SpawnPoint } from './generators/street-generator';
import type { DevWorldWorkerMessage, DevWorldWorkerResponse, DevWorldWorkerConfig } from './devworld-worker.types';

/**
 * DevTerrainProvider
 *
 * Implements TerrainProvider for DevWorld using:
 * - Runtime terrain generation (no PNG files!)
 * - Runtime building placement
 * - Grid shader for visual appearance
 *
 * Features:
 * - Seeded reproducibility (same seed = same world)
 * - Live regeneration via regenerate() method
 */
/** Road width in meters */
const ROAD_WIDTH = 6;
/** Road thickness (height) in meters */
const ROAD_THICKNESS = 0.3;
/** Road height offset above terrain */
const ROAD_HEIGHT_OFFSET = 0.5;

export class DevTerrainProvider implements TerrainProvider {
  private scene: THREE.Scene | null = null;
  private terrainMesh: THREE.Mesh | null = null;
  private terrainSkirt: THREE.Mesh | null = null; // Side walls for terrain depth
  private terrainGroup: THREE.Group = new THREE.Group();
  private buildings: THREE.Mesh[] = []; // For raycasting only (not added to scene)
  private buildingInstancedMesh: THREE.InstancedMesh | null = null; // For rendering (1 draw call!)
  private roadMesh: THREE.Mesh | null = null; // Asphalt road surface
  private heightData: Float32Array | null = null;
  private heightmapSize = DEV_WORLD_HEIGHTMAP_SIZE;
  private ready = false;

  // Web Worker for off-main-thread generation
  private worker: Worker | null = null;

  // TerrainGenerator kept for height sampling after generation
  private terrainGenerator: TerrainGenerator | null = null;

  // Generated data
  private streetSegments: StreetSegment[] = [];
  private spawnPoints: SpawnPoint[] = [];

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

  // Shared building material (MeshLambertMaterial for better performance)
  private buildingMaterial: THREE.MeshLambertMaterial | null = null;

  // Callback for street refresh (notifies DevStreetProvider)
  private onStreetRefreshCallback: ((segments: StreetSegment[], spawns: SpawnPoint[]) => void) | null = null;

  // Building color palette for visual variety
  private static readonly BUILDING_COLORS = [
    0x555566, // Default gray-blue
    0x665555, // Gray-red (brick)
    0x556655, // Gray-green
    0x606070, // Lighter gray-blue
    0x504540, // Dark brown
    0x606060, // Neutral gray
    0x4a5a6a, // Steel blue
    0x5a5a50, // Olive gray
  ];

  constructor(private devWorld: DevWorldService) {}

  async initialize(scene: THREE.Scene): Promise<void> {
    this.scene = scene;

    console.log('[DevTerrain] Initializing with runtime generation...');
    const startTime = performance.now();

    // Generate everything from seed
    await this.regenerate();

    // Add to scene
    scene.add(this.terrainGroup);

    this.ready = true;
    console.log(`[DevTerrain] Initialized in ${(performance.now() - startTime).toFixed(0)}ms`);
  }

  /**
   * Set callback for street refresh notifications.
   * Called when streets are regenerated.
   */
  setStreetRefreshCallback(callback: (segments: StreetSegment[], spawns: SpawnPoint[]) => void): void {
    this.onStreetRefreshCallback = callback;
  }

  /**
   * Regenerate entire world with current config.
   * Called on init AND on debug panel "Regenerate" button.
   *
   * Uses Web Worker for off-main-thread generation:
   * 1. Worker generates terrain, streets, buildings DATA
   * 2. Main thread creates THREE.js meshes from data
   */
  async regenerate(): Promise<void> {
    const { terrain, seed, buildings } = this.devWorld.config;

    console.log(`[DevTerrain] Regenerating via Worker: preset=${terrain}, seed=${seed}, buildings=${buildings}`);
    const startTime = performance.now();

    // Clear existing
    this.clearWorld();

    // Map buildings preset to density
    const buildingDensity = this.mapBuildingPresetToDensity(buildings);

    // Create worker config
    const workerConfig: DevWorldWorkerConfig = {
      seed,
      worldSize: DEV_WORLD_SIZE,
      heightmapSize: DEV_WORLD_HEIGHTMAP_SIZE,
      maxHeight: DEV_WORLD_MAX_HEIGHT,
      terrainPreset: terrain as TerrainPreset,
      buildingDensity,
      hqPosition: { x: 0, z: 0 },
    };

    // Run generation in Web Worker
    const result = await this.runWorkerGeneration(workerConfig);

    // Store generated data
    this.heightData = result.heightData;
    this.streetSegments = result.streetSegments;
    this.spawnPoints = result.spawnPoints;

    // Create TerrainGenerator for height sampling (reuses heightData)
    this.terrainGenerator = new TerrainGenerator({
      preset: terrain as TerrainPreset,
      seed,
      size: DEV_WORLD_HEIGHTMAP_SIZE,
      worldSize: DEV_WORLD_SIZE,
      maxHeight: DEV_WORLD_MAX_HEIGHT,
    });

    // Create meshes on main thread (requires THREE.js / DOM)
    this.createTerrainMesh();
    this.createRoadMesh();
    this.createBuildings(result.buildingConfigs);

    // Rebuild raycast targets
    this.rebuildRaycastTargets();

    // Clear height cache
    this.heightCache.clear();

    // Notify street provider
    if (this.onStreetRefreshCallback) {
      this.onStreetRefreshCallback(this.streetSegments, this.spawnPoints);
    }

    const meshTime = performance.now() - startTime - result.timing.total;
    console.log(
      `[DevTerrain] Regenerated: Worker=${result.timing.total.toFixed(0)}ms ` +
      `(terrain=${result.timing.terrain.toFixed(0)}ms, streets=${result.timing.streets.toFixed(0)}ms, ` +
      `buildings=${result.timing.buildings.toFixed(0)}ms), Meshes=${meshTime.toFixed(0)}ms`
    );
  }

  /**
   * Run generation in Web Worker and return results.
   */
  private runWorkerGeneration(config: DevWorldWorkerConfig): Promise<{
    heightData: Float32Array;
    streetSegments: StreetSegment[];
    spawnPoints: SpawnPoint[];
    buildingConfigs: BuildingConfig[];
    timing: { terrain: number; streets: number; buildings: number; total: number };
  }> {
    return new Promise((resolve, reject) => {
      // Create worker lazily
      if (!this.worker) {
        this.worker = new Worker(new URL('./devworld.worker', import.meta.url), { type: 'module' });
      }

      const handleMessage = (event: MessageEvent<DevWorldWorkerResponse>) => {
        const response = event.data;

        switch (response.type) {
          case 'progress':
            console.log(`[DevTerrain] Worker progress: ${response.phase} ${response.progress}%`);
            break;

          case 'result':
            this.worker?.removeEventListener('message', handleMessage);
            resolve({
              heightData: response.heightData,
              streetSegments: response.streetSegments,
              spawnPoints: response.spawnPoints,
              buildingConfigs: response.buildingConfigs,
              timing: response.timing,
            });
            break;

          case 'error':
            this.worker?.removeEventListener('message', handleMessage);
            reject(new Error(response.error));
            break;
        }
      };

      this.worker.addEventListener('message', handleMessage);

      // Send generation request to worker
      const message: DevWorldWorkerMessage = { type: 'generate', config };
      this.worker.postMessage(message);
    });
  }

  /**
   * Get generated street segments.
   */
  getStreetSegments(): StreetSegment[] {
    return this.streetSegments;
  }

  /**
   * Get generated spawn points.
   */
  getSpawnPoints(): SpawnPoint[] {
    return this.spawnPoints;
  }

  private mapBuildingPresetToDensity(preset: string): BuildingDensity {
    switch (preset) {
      case 'none':
        return 'none';
      case 'sparse':
        return 'sparse';
      case 'dense':
        return 'dense';
      case 'maze':
        return 'maze';
      default:
        return 'medium';
    }
  }

  private clearWorld(): void {
    // Remove terrain mesh
    if (this.terrainMesh) {
      this.terrainGroup.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh = null;
    }

    // Remove terrain skirt
    if (this.terrainSkirt) {
      this.terrainGroup.remove(this.terrainSkirt);
      this.terrainSkirt.geometry.dispose();
      (this.terrainSkirt.material as THREE.Material).dispose();
      this.terrainSkirt = null;
    }

    // Remove road mesh
    if (this.roadMesh) {
      this.terrainGroup.remove(this.roadMesh);
      this.roadMesh.geometry.dispose();
      (this.roadMesh.material as THREE.Material).dispose();
      this.roadMesh = null;
    }

    // Remove instanced building mesh (for rendering)
    if (this.buildingInstancedMesh) {
      this.terrainGroup.remove(this.buildingInstancedMesh);
      this.buildingInstancedMesh.geometry.dispose();
      this.buildingInstancedMesh = null;
    }

    // Dispose raycast-only building meshes (not in scene)
    for (const building of this.buildings) {
      building.geometry.dispose();
    }
    this.buildings = [];

    // Clear data
    this.heightData = null;
    this.streetSegments = [];
    this.spawnPoints = [];
    this.raycastTargets = [];
  }

  /**
   * Direct height sampling (before mesh is created, for terrain generation)
   */
  private getHeightAtLocalDirect(x: number, z: number): number {
    if (!this.heightData) return 0;

    const halfSize = DEV_WORLD_SIZE / 2;
    const u = (x + halfSize) / DEV_WORLD_SIZE;
    const v = (z + halfSize) / DEV_WORLD_SIZE;

    return this.sampleHeightmap(u, v);
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

    // Create terrain skirt (side walls for depth)
    this.createTerrainSkirt(segments);
  }

  /**
   * Create side walls around the terrain edge for visual depth.
   * Creates 4 walls (N, S, E, W) that extend from terrain surface down.
   */
  private createTerrainSkirt(segments: number): void {
    const halfSize = DEV_WORLD_SIZE / 2;
    const skirtDepth = 100; // How far down the skirt extends
    const skirtBottom = -50; // Bottom Y position

    const vertices: number[] = [];
    const indices: number[] = [];
    const normals: number[] = [];

    // Helper to add a quad (2 triangles)
    const addQuad = (
      x1: number, y1: number, z1: number,
      x2: number, y2: number, z2: number,
      x3: number, y3: number, z3: number,
      x4: number, y4: number, z4: number,
      nx: number, ny: number, nz: number
    ) => {
      const baseIdx = vertices.length / 3;

      // 4 vertices
      vertices.push(x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4);

      // 4 normals (same for flat shading)
      for (let i = 0; i < 4; i++) {
        normals.push(nx, ny, nz);
      }

      // 2 triangles
      indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
      indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
    };

    // Sample edge heights and create walls
    for (let i = 0; i < segments; i++) {
      const t1 = i / segments;
      const t2 = (i + 1) / segments;

      // North edge (z = +halfSize)
      const nx1 = -halfSize + t1 * DEV_WORLD_SIZE;
      const nx2 = -halfSize + t2 * DEV_WORLD_SIZE;
      const nh1 = this.getHeightAtLocalDirect(nx1, halfSize);
      const nh2 = this.getHeightAtLocalDirect(nx2, halfSize);
      addQuad(
        nx1, nh1, halfSize,
        nx2, nh2, halfSize,
        nx2, skirtBottom, halfSize,
        nx1, skirtBottom, halfSize,
        0, 0, 1 // Normal facing north
      );

      // South edge (z = -halfSize)
      const sx1 = -halfSize + t1 * DEV_WORLD_SIZE;
      const sx2 = -halfSize + t2 * DEV_WORLD_SIZE;
      const sh1 = this.getHeightAtLocalDirect(sx1, -halfSize);
      const sh2 = this.getHeightAtLocalDirect(sx2, -halfSize);
      addQuad(
        sx2, sh2, -halfSize,
        sx1, sh1, -halfSize,
        sx1, skirtBottom, -halfSize,
        sx2, skirtBottom, -halfSize,
        0, 0, -1 // Normal facing south
      );

      // East edge (x = +halfSize)
      const ez1 = -halfSize + t1 * DEV_WORLD_SIZE;
      const ez2 = -halfSize + t2 * DEV_WORLD_SIZE;
      const eh1 = this.getHeightAtLocalDirect(halfSize, ez1);
      const eh2 = this.getHeightAtLocalDirect(halfSize, ez2);
      addQuad(
        halfSize, eh2, ez2,
        halfSize, eh1, ez1,
        halfSize, skirtBottom, ez1,
        halfSize, skirtBottom, ez2,
        1, 0, 0 // Normal facing east
      );

      // West edge (x = -halfSize)
      const wz1 = -halfSize + t1 * DEV_WORLD_SIZE;
      const wz2 = -halfSize + t2 * DEV_WORLD_SIZE;
      const wh1 = this.getHeightAtLocalDirect(-halfSize, wz1);
      const wh2 = this.getHeightAtLocalDirect(-halfSize, wz2);
      addQuad(
        -halfSize, wh1, wz1,
        -halfSize, wh2, wz2,
        -halfSize, skirtBottom, wz2,
        -halfSize, skirtBottom, wz1,
        -1, 0, 0 // Normal facing west
      );
    }

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);

    // Dark rock material for the skirt (visible from both sides)
    const material = new THREE.MeshLambertMaterial({
      color: 0x3a3530, // Dark brown/rock
      side: THREE.DoubleSide,
    });

    this.terrainSkirt = new THREE.Mesh(geometry, material);
    this.terrainSkirt.name = 'DevWorldTerrainSkirt';
    this.terrainGroup.add(this.terrainSkirt);

    console.log(`[DevTerrain] Created terrain skirt: ${indices.length / 3} triangles`);
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
   * Create road mesh from street segments using InstancedMesh.
   * Each road "stamp" is an instance of a circle - 1 draw call for all roads!
   */
  private createRoadMesh(): void {
    if (this.streetSegments.length === 0) return;

    // Remove existing road mesh if any
    if (this.roadMesh) {
      this.terrainGroup.remove(this.roadMesh);
      this.roadMesh.geometry.dispose();
      (this.roadMesh.material as THREE.Material).dispose();
      this.roadMesh = null;
    }

    const radius = ROAD_WIDTH / 2;
    const subdivisionLength = 3; // Sample every 3m (was 1m)
    const circleSegments = 6; // Hexagon (was 8)

    // Collect all road points
    const roadPoints: { x: number; z: number; y: number }[] = [];

    // Raycaster for terrain height
    const rayOrigin = new THREE.Vector3();
    const rayDir = new THREE.Vector3(0, -1, 0);
    const raycaster = new THREE.Raycaster();

    for (const segment of this.streetSegments) {
      const x1 = segment.from[0];
      const z1 = segment.from[1];
      const x2 = segment.to[0];
      const z2 = segment.to[1];

      const dx = x2 - x1;
      const dz = z2 - z1;
      const segmentLength = Math.sqrt(dx * dx + dz * dz);
      if (segmentLength < 0.5) continue;

      const numPoints = Math.max(2, Math.ceil(segmentLength / subdivisionLength));
      for (let i = 0; i <= numPoints; i++) {
        const t = i / numPoints;
        const x = x1 + dx * t;
        const z = z1 + dz * t;

        // Get terrain height via raycast
        rayOrigin.set(x, 500, z);
        raycaster.set(rayOrigin, rayDir);
        let y = ROAD_HEIGHT_OFFSET;
        if (this.terrainMesh) {
          const hits = raycaster.intersectObject(this.terrainMesh);
          if (hits.length > 0) {
            y = hits[0].point.y + ROAD_HEIGHT_OFFSET;
          }
        }

        roadPoints.push({ x, z, y });
      }
    }

    if (roadPoints.length === 0) return;

    // Create single circle geometry (shared by all instances)
    const circleGeom = new THREE.CircleGeometry(radius, circleSegments);
    circleGeom.rotateX(-Math.PI / 2); // Make horizontal

    // Asphalt material
    const material = new THREE.MeshBasicMaterial({
      color: 0x3a3a3a,
      side: THREE.DoubleSide,
    });

    // Create InstancedMesh
    const instancedRoads = new THREE.InstancedMesh(circleGeom, material, roadPoints.length);
    instancedRoads.name = 'DevWorldRoads';

    // Set instance transforms
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < roadPoints.length; i++) {
      const p = roadPoints[i];
      matrix.makeTranslation(p.x, p.y, p.z);
      instancedRoads.setMatrixAt(i, matrix);
    }
    instancedRoads.instanceMatrix.needsUpdate = true;

    // Store as roadMesh (it's actually an InstancedMesh but compatible)
    this.roadMesh = instancedRoads as unknown as THREE.Mesh;
    this.roadMesh.renderOrder = 1;
    this.terrainGroup.add(this.roadMesh);

    console.log(`[DevTerrain] Created instanced road mesh: ${roadPoints.length} instances (1 draw call)`);
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
        maxHeight: { value: DEV_WORLD_MAX_HEIGHT },
        // Height-based colors
        grassColor: { value: new THREE.Color(0x3d6b3d) },    // Dark green grass
        dirtColor: { value: new THREE.Color(0x6b5a3d) },     // Brown dirt
        rockColor: { value: new THREE.Color(0x6a6a6a) },     // Gray rock
        snowColor: { value: new THREE.Color(0xdedede) },     // Light snow/peak
        // Grid colors (subtle)
        gridColor: { value: new THREE.Color(0x4a5a4a) },
      },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>

        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying float vHeight;

        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          vHeight = position.y; // Local Y = height
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * viewMatrix * worldPos;

          #include <logdepthbuf_vertex>
        }
      `,
      fragmentShader: `
        #include <logdepthbuf_pars_fragment>

        uniform float maxHeight;
        uniform vec3 grassColor;
        uniform vec3 dirtColor;
        uniform vec3 rockColor;
        uniform vec3 snowColor;
        uniform vec3 gridColor;

        varying vec3 vWorldPosition;
        varying vec3 vNormal;
        varying float vHeight;

        void main() {
          // Normalize height to 0-1 range
          float h = clamp(vHeight / maxHeight, 0.0, 1.0);

          // Height-based color blending with smooth transitions
          vec3 terrainColor;
          if (h < 0.25) {
            // Low: grass
            terrainColor = grassColor;
          } else if (h < 0.45) {
            // Transition: grass to dirt
            float t = (h - 0.25) / 0.2;
            terrainColor = mix(grassColor, dirtColor, t);
          } else if (h < 0.65) {
            // Mid: dirt
            terrainColor = dirtColor;
          } else if (h < 0.85) {
            // Transition: dirt to rock
            float t = (h - 0.65) / 0.2;
            terrainColor = mix(dirtColor, rockColor, t);
          } else {
            // High: rock to snow
            float t = (h - 0.85) / 0.15;
            terrainColor = mix(rockColor, snowColor, min(t, 1.0));
          }

          // Slope-based variation (steeper = more rock)
          float slope = 1.0 - abs(vNormal.y);
          terrainColor = mix(terrainColor, rockColor, slope * 0.5);

          // Subtle grid overlay (50m major lines only)
          float grid50 = step(0.97, fract(vWorldPosition.x / 50.0)) +
                         step(0.97, fract(vWorldPosition.z / 50.0));
          grid50 = clamp(grid50, 0.0, 1.0);
          terrainColor = mix(terrainColor, gridColor, grid50 * 0.3);

          // Lighting: sun + ambient
          vec3 lightDir = normalize(vec3(0.4, 0.8, 0.3));
          float NdotL = max(dot(vNormal, lightDir), 0.0);
          float diffuse = NdotL * 0.6 + 0.4; // 40% ambient

          // Slight fog/atmosphere at distance (optional depth cue)
          float fogFactor = smoothstep(800.0, 1500.0, length(vWorldPosition.xz));
          vec3 fogColor = vec3(0.7, 0.75, 0.8);

          vec3 finalColor = terrainColor * diffuse;
          finalColor = mix(finalColor, fogColor, fogFactor * 0.3);

          gl_FragColor = vec4(finalColor, 1.0);

          #include <logdepthbuf_fragment>
        }
      `,
    });
  }

  /**
   * Create buildings using InstancedMesh for minimal draw calls.
   * Creates:
   * 1. An InstancedMesh for rendering (1 draw call for ALL buildings!)
   * 2. Individual Meshes for raycasting (not added to scene)
   */
  private createBuildings(buildingConfigs: BuildingConfig[]): void {
    if (buildingConfigs.length === 0) return;

    // Create shared material if needed (use MeshLambertMaterial for better performance)
    // Note: Instance colors are automatically applied by Three.js when using setColorAt()
    // The material color (white) is multiplied with the instance color
    if (!this.buildingMaterial) {
      this.buildingMaterial = new THREE.MeshLambertMaterial({
        color: 0xffffff, // White base, instance colors will tint this
      });
    }

    // Unit box geometry - we scale each instance via matrix
    const unitBox = new THREE.BoxGeometry(1, 1, 1);

    // Create InstancedMesh
    this.buildingInstancedMesh = new THREE.InstancedMesh(
      unitBox,
      this.buildingMaterial,
      buildingConfigs.length
    );
    this.buildingInstancedMesh.name = 'DevWorldBuildings';
    // Disable shadows for better performance
    this.buildingInstancedMesh.castShadow = false;
    this.buildingInstancedMesh.receiveShadow = false;

    // Reusable objects for matrix construction
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const color = new THREE.Color();

    // Process each building
    for (let i = 0; i < buildingConfigs.length; i++) {
      const config = buildingConfigs[i];
      const { width, height, depth } = config.size;

      // Get terrain height
      const terrainHeight = this.getHeightAtLocalDirect(config.position.x, config.position.z);

      // Set position (center of building)
      position.set(
        config.position.x,
        terrainHeight + height / 2,
        config.position.z
      );

      // Set rotation
      if (config.rotation !== undefined) {
        quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), config.rotation);
      } else {
        quaternion.identity();
      }

      // Set scale (the unit box gets scaled to actual building size)
      scale.set(width, height, depth);

      // Compose transformation matrix
      matrix.compose(position, quaternion, scale);
      this.buildingInstancedMesh.setMatrixAt(i, matrix);

      // Set per-instance color for visual variety
      const colorIndex = (config.id.charCodeAt(0) + i) % DevTerrainProvider.BUILDING_COLORS.length;
      color.setHex(DevTerrainProvider.BUILDING_COLORS[colorIndex]);
      this.buildingInstancedMesh.setColorAt(i, color);

      // Create raycast-only mesh (NOT added to scene, only for collision detection)
      const raycastGeometry = new THREE.BoxGeometry(width, height, depth);
      const raycastMesh = new THREE.Mesh(raycastGeometry);
      raycastMesh.position.copy(position);
      if (config.rotation !== undefined) {
        raycastMesh.rotation.y = config.rotation;
      }
      raycastMesh.name = `Building_${config.id}`;
      raycastMesh.updateMatrixWorld(true);
      this.buildings.push(raycastMesh);
    }

    // Notify Three.js that matrices/colors have been updated
    this.buildingInstancedMesh.instanceMatrix.needsUpdate = true;
    if (this.buildingInstancedMesh.instanceColor) {
      this.buildingInstancedMesh.instanceColor.needsUpdate = true;
    }

    // Add to scene
    this.terrainGroup.add(this.buildingInstancedMesh);

    console.log(`[DevTerrain] Created ${buildingConfigs.length} buildings (1 instanced mesh, ${buildingConfigs.length} raycast meshes)`);
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
    if (!this.terrainMesh) return null;

    // Check cache
    const cacheKey = `${x.toFixed(this.CACHE_PRECISION)}_${z.toFixed(this.CACHE_PRECISION)}`;
    const cached = this.heightCache.get(cacheKey);
    if (cached !== undefined) return cached;

    // Check bounds
    const halfSize = DEV_WORLD_SIZE / 2;
    if (Math.abs(x) > halfSize || Math.abs(z) > halfSize) {
      return null;
    }

    // Use raycast against terrain mesh for accurate mesh surface height
    // This avoids mismatch between heightmap interpolation and mesh triangles
    const rayResult = this.raycastDown(x, z);
    if (rayResult) {
      const height = rayResult.y;
      this.heightCache.set(cacheKey, height);
      return height;
    }

    // Fallback to heightmap sampling if raycast misses (shouldn't happen)
    if (this.heightData) {
      const u = (x + halfSize) / DEV_WORLD_SIZE;
      const v = (z + halfSize) / DEV_WORLD_SIZE;
      const height = this.sampleHeightmap(u, v);
      this.heightCache.set(cacheKey, height);
      return height;
    }

    return null;
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

    // Raycast against terrain AND buildings - allows tower placement on rooftops
    const intersects = this.raycaster.intersectObjects(this.raycastTargets, false);
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
    // Terminate worker
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }

    if (this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      (this.terrainMesh.material as THREE.Material).dispose();
    }

    // Dispose instanced building mesh
    if (this.buildingInstancedMesh) {
      this.buildingInstancedMesh.geometry.dispose();
      this.buildingInstancedMesh = null;
    }

    // Dispose raycast-only building meshes
    for (const building of this.buildings) {
      building.geometry.dispose();
    }
    this.buildings = [];

    if (this.buildingMaterial) {
      this.buildingMaterial.dispose();
      this.buildingMaterial = null;
    }

    if (this.scene && this.terrainGroup.parent === this.scene) {
      this.scene.remove(this.terrainGroup);
    }

    this.heightData = null;
    this.heightCache.clear();
    this.ready = false;
  }
}
