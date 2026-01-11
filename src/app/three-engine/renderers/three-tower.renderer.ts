import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CoordinateSync } from './index';
import { TowerTypeConfig, TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { LOS_HATCHING_VERTEX, LOS_HATCHING_FRAGMENT } from '../../game/tower-defense/shaders/los-hatching.shaders';

/**
 * Tower render data - stored per tower
 */
export interface TowerRenderData {
  id: string;
  mesh: THREE.Object3D;
  rangeIndicator: THREE.Mesh | null;
  selectionRing: THREE.Mesh | null;
  hexGrid: THREE.InstancedMesh | null; // Instanced mesh for hex visualization
  hexCells: HexCell[]; // Hex cell data for LoS calculations
  tipMarker: THREE.Mesh | null; // Debug marker showing LoS origin point
  typeConfig: TowerTypeConfig;
  isSelected: boolean;
  // Geo coordinates for terrain sampling
  lat: number;
  lon: number;
  height: number;
  // Tower tip position for LoS calculations
  tipY: number;
}

/**
 * Function type for terrain height sampling (geo coordinates)
 * @deprecated Use TerrainRaycaster instead for accurate terrain-conforming meshes
 */
export type TerrainHeightSampler = (lat: number, lon: number) => number | null;

/**
 * Function type for direct terrain raycasting at local coordinates
 * More accurate than TerrainHeightSampler as it uses actual mesh intersection
 */
export type TerrainRaycaster = (localX: number, localZ: number) => number | null;

/**
 * Function type for Line-of-Sight raycasting between two 3D points
 * Returns true if line of sight is BLOCKED (ray hits something before target)
 */
export type LineOfSightRaycaster = (
  originX: number, originY: number, originZ: number,
  targetX: number, targetY: number, targetZ: number
) => boolean;

/**
 * Data for a single hex cell in the range indicator
 */
interface HexCell {
  index: number; // Index in the InstancedMesh
  centerX: number; // World X
  centerZ: number; // World Z
  terrainY: number;
  isBlocked: boolean;
}

/**
 * ThreeTowerRenderer - Renders towers using Three.js
 *
 * Features:
 * - GLB model loading with caching
 * - Range indicator (circle on ground)
 * - Selection highlight ring
 */
export class ThreeTowerRenderer {
  private scene: THREE.Scene;
  private sync: CoordinateSync;
  private loader: GLTFLoader;

  // Cached model templates per tower type
  private modelTemplates = new Map<string, GLTF>();
  private loadingPromises = new Map<string, Promise<GLTF>>();

  // Active tower renders
  private towers = new Map<string, TowerRenderData>();

  // Shared materials
  private rangeMaterial: THREE.MeshBasicMaterial;
  private selectionMaterial: THREE.MeshBasicMaterial;

  // Terrain height sampler (optional - for terrain-conforming range indicators)
  private terrainHeightSampler: TerrainHeightSampler | null = null;

  // Direct terrain raycaster for accurate terrain-conforming meshes
  private terrainRaycaster: TerrainRaycaster | null = null;

  // Line-of-Sight raycaster for visibility checks
  private losRaycaster: LineOfSightRaycaster | null = null;

  // Hex grid material - unified shader for both visible and blocked areas
  private hexMaterial: THREE.ShaderMaterial;

  // Debug mode - shows tip markers for all towers
  private debugMode = false;

  // Animation time accumulator for frame-independent animations
  private animationTime = 0;

  // Configuration for terrain-conforming range indicator
  private readonly RANGE_SEGMENTS = 48; // Number of segments around the circle
  private readonly RANGE_RINGS = 8; // Number of concentric rings

  // Hex grid configuration
  private readonly HEX_SIZE = 8; // Size of each hex cell in meters (flat-to-flat)
  private readonly HEX_GAP = 0.5; // Small gap between hexes for visual clarity

  constructor(scene: THREE.Scene, sync: CoordinateSync) {
    this.scene = scene;
    this.sync = sync;
    this.loader = new GLTFLoader();

    // Range indicator material (invisible - hex cells show visibility now)
    this.rangeMaterial = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0, // Hidden - green/red hex hatching shows visibility instead
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });

    // Selection ring material (gold for WC3 style, high visibility)
    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0xc9a44c, // TD gold from design system
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false, // Always render on top
    });

    // Unified hex material with animated hatching shader
    const hexRadius = (this.HEX_SIZE - this.HEX_GAP) / 2;
    this.hexMaterial = new THREE.ShaderMaterial({
      vertexShader: LOS_HATCHING_VERTEX,
      fragmentShader: LOS_HATCHING_FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uVisibleColor: { value: new THREE.Color(0x22c55e) }, // Green
        uBlockedColor: { value: new THREE.Color(0xdc2626) }, // Red
        uVisibleOpacity: { value: 0.35 }, // Clearly visible
        uBlockedOpacity: { value: 0.30 }, // More visible for blocked
        uHexRadius: { value: hexRadius },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
  }

  /**
   * Set terrain height sampler for terrain-conforming range indicators
   * @deprecated Use setTerrainRaycaster instead for accurate terrain-conforming meshes
   */
  setTerrainHeightSampler(sampler: TerrainHeightSampler): void {
    this.terrainHeightSampler = sampler;
  }

  /**
   * Set direct terrain raycaster for accurate terrain-conforming range indicators
   * This raycaster takes local X,Z coordinates and returns the terrain Y at that position
   */
  setTerrainRaycaster(raycaster: TerrainRaycaster): void {
    this.terrainRaycaster = raycaster;
  }

  /**
   * Set Line-of-Sight raycaster for visibility checks
   * This raycaster checks if there's a clear line between two 3D points
   */
  setLineOfSightRaycaster(raycaster: LineOfSightRaycaster): void {
    this.losRaycaster = raycaster;
  }

  /**
   * Preload model template for a tower type
   */
  async preloadModel(typeId: TowerTypeId): Promise<void> {
    const config = TOWER_TYPES[typeId];
    if (!config) return;

    if (this.modelTemplates.has(typeId) || this.loadingPromises.has(typeId)) {
      return;
    }

    const promise = this.loader.loadAsync(config.modelUrl);
    this.loadingPromises.set(typeId, promise);

    try {
      const gltf = await promise;
      this.modelTemplates.set(typeId, gltf);
    } catch (err) {
      console.error(`[ThreeTowerRenderer] Failed to load model: ${typeId}`, err);
    } finally {
      this.loadingPromises.delete(typeId);
    }
  }

  /**
   * Preload all tower type models
   */
  async preloadAllModels(): Promise<void> {
    const types = Object.keys(TOWER_TYPES) as TowerTypeId[];
    await Promise.all(types.map((t) => this.preloadModel(t)));
  }

  /**
   * Create tower render - spawns mesh in scene
   */
  async create(
    id: string,
    typeId: TowerTypeId,
    lat: number,
    lon: number,
    height: number
  ): Promise<TowerRenderData | null> {
    const config = TOWER_TYPES[typeId];
    if (!config) {
      console.error(`[ThreeTowerRenderer] Unknown tower type: ${typeId}`);
      return null;
    }

    // Ensure model is loaded
    let gltf = this.modelTemplates.get(typeId);
    if (!gltf) {
      const promise = this.loadingPromises.get(typeId) || this.loader.loadAsync(config.modelUrl);
      if (!this.loadingPromises.has(typeId)) {
        this.loadingPromises.set(typeId, promise);
      }
      try {
        gltf = await promise;
        this.modelTemplates.set(typeId, gltf);
      } catch (err) {
        console.error(`[ThreeTowerRenderer] Failed to load model: ${typeId}`, err);
        return null;
      } finally {
        this.loadingPromises.delete(typeId);
      }
    }

    // Clone the model
    const mesh = gltf.scene.clone();
    mesh.scale.setScalar(config.scale);

    // Enable shadows
    mesh.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        node.castShadow = true;
        node.receiveShadow = true;
      }
    });

    // Position in local coordinates - terrain level (without height offset)
    const terrainPos = this.sync.geoToLocal(lat, lon, height);

    // Tower mesh position with height offset
    const localPos = terrainPos.clone();
    localPos.y += config.heightOffset;
    mesh.position.copy(localPos);

    // Add to scene
    this.scene.add(mesh);

    // Create range indicator at TERRAIN level (not tower level)
    const rangeIndicator = this.createRangeIndicator(lat, lon, height, config.range, terrainPos);
    rangeIndicator.visible = false;
    this.scene.add(rangeIndicator);

    // Create selection ring at terrain level
    const selectionGeometry = new THREE.RingGeometry(8, 12, 48);
    const selectionRing = new THREE.Mesh(selectionGeometry, this.selectionMaterial.clone());
    selectionRing.rotation.x = -Math.PI / 2;
    selectionRing.position.copy(terrainPos);
    selectionRing.position.y += 1.5; // Slightly above terrain
    selectionRing.visible = false;
    selectionRing.renderOrder = 5; // Render on top
    this.scene.add(selectionRing);

    // Calculate tower shooting position Y (for LoS calculations)
    // Uses configurable shootHeight per tower type
    const tipY = terrainPos.y + config.heightOffset + config.shootHeight;

    // Create hex grid for LoS visualization (initially hidden)
    const { hexGrid, hexCells } = this.createHexGrid(terrainPos.x, terrainPos.z, config.range, tipY);
    hexGrid.visible = false;
    this.scene.add(hexGrid);

    // Create tip marker (magenta sphere showing LoS origin point)
    const tipMarkerGeometry = new THREE.SphereGeometry(2, 16, 16);
    const tipMarkerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff00ff, // Magenta
      depthTest: false, // Always visible, even inside tower mesh
    });
    const tipMarker = new THREE.Mesh(tipMarkerGeometry, tipMarkerMaterial);
    tipMarker.position.set(terrainPos.x, tipY, terrainPos.z);
    tipMarker.renderOrder = 999; // Render on top
    tipMarker.visible = this.debugMode; // Visible in debug mode, or when tower is selected
    this.scene.add(tipMarker);

    const renderData: TowerRenderData = {
      id,
      mesh,
      rangeIndicator,
      selectionRing,
      hexGrid,
      hexCells,
      tipMarker,
      typeConfig: config,
      isSelected: false,
      lat,
      lon,
      height,
      tipY,
    };

    this.towers.set(id, renderData);
    return renderData;
  }

  /**
   * Update tower position (normally static, but useful for editor)
   */
  updatePosition(id: string, lat: number, lon: number, height: number): void {
    const data = this.towers.get(id);
    if (!data) return;

    // Terrain level position (without heightOffset)
    const terrainPos = this.sync.geoToLocal(lat, lon, height);

    // Tower mesh gets heightOffset
    const localPos = terrainPos.clone();
    localPos.y += data.typeConfig.heightOffset;
    data.mesh.position.copy(localPos);

    // Range indicator stays at terrain level (for terrain-conforming geometry, position is 0,0,0)
    // Only set position for simple flat geometry which doesn't use world coords
    if (data.rangeIndicator && !this.terrainHeightSampler) {
      data.rangeIndicator.position.copy(terrainPos);
      data.rangeIndicator.position.y += 0.5;
    }

    // Selection ring at terrain level
    if (data.selectionRing) {
      data.selectionRing.position.copy(terrainPos);
      data.selectionRing.position.y += 1.5;
    }

    // Update stored coordinates
    data.lat = lat;
    data.lon = lon;
    data.height = height;
  }

  /**
   * Update tower rotation (for aiming at target)
   */
  updateRotation(id: string, heading: number): void {
    const data = this.towers.get(id);
    if (!data) return;

    data.mesh.rotation.y = heading;
  }

  /**
   * Select tower (show range indicator, selection ring, and hex grid)
   */
  select(id: string): void {
    const data = this.towers.get(id);
    if (!data) return;

    data.isSelected = true;
    if (data.rangeIndicator) data.rangeIndicator.visible = true;
    if (data.selectionRing) data.selectionRing.visible = true;
    if (data.hexGrid) {
      data.hexGrid.visible = true;
      // Recalculate LoS when tower is selected
      this.updateHexGridLoS(data);
    }
    if (data.tipMarker) data.tipMarker.visible = this.debugMode;
  }

  /**
   * Deselect tower
   */
  deselect(id: string): void {
    const data = this.towers.get(id);
    if (!data) return;

    data.isSelected = false;
    if (data.rangeIndicator) data.rangeIndicator.visible = false;
    if (data.selectionRing) data.selectionRing.visible = false;
    if (data.hexGrid) data.hexGrid.visible = false;
    // Keep tip marker visible in debug mode
    if (data.tipMarker) data.tipMarker.visible = this.debugMode;
  }

  /**
   * Deselect all towers
   */
  deselectAll(): void {
    for (const id of this.towers.keys()) {
      this.deselect(id);
    }
  }

  /**
   * Set debug mode - shows tip markers (shoot height indicators) for all towers
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;

    let updatedCount = 0;
    for (const data of this.towers.values()) {
      if (data.tipMarker) {
        // Only show in debug mode (Tower-Schusshoehe option)
        data.tipMarker.visible = enabled;
        updatedCount++;
      }
    }

  }

  /**
   * Get current debug mode state
   */
  isDebugMode(): boolean {
    return this.debugMode;
  }

  /**
   * Remove tower from scene
   */
  remove(id: string): void {
    const data = this.towers.get(id);
    if (!data) return;

    // Remove mesh
    this.scene.remove(data.mesh);
    this.disposeObject(data.mesh);

    // Remove range indicator (may be a Group with children)
    if (data.rangeIndicator) {
      this.scene.remove(data.rangeIndicator);
      this.disposeObject(data.rangeIndicator);
    }

    // Remove selection ring
    if (data.selectionRing) {
      this.scene.remove(data.selectionRing);
      if (data.selectionRing.geometry) {
        data.selectionRing.geometry.dispose();
      }
      if (data.selectionRing.material) {
        (data.selectionRing.material as THREE.Material).dispose();
      }
    }

    // Remove hex grid (InstancedMesh)
    if (data.hexGrid) {
      this.scene.remove(data.hexGrid);
      data.hexGrid.geometry.dispose();
      // Material is shared (hexMaterial), don't dispose it
    }

    // Remove tip marker
    if (data.tipMarker) {
      this.scene.remove(data.tipMarker);
      data.tipMarker.geometry.dispose();
      (data.tipMarker.material as THREE.Material).dispose();
    }

    this.towers.delete(id);
  }

  /**
   * Update selection ring animation and hex grid shader
   * Call each frame for pulse effect and hatching animation
   */
  updateAnimations(deltaTime: number): void {
    // Accumulate time for frame-independent animation
    this.animationTime += deltaTime * 0.003;

    // Update hex material shader time uniform
    this.hexMaterial.uniforms['uTime'].value = this.animationTime;

    for (const data of this.towers.values()) {
      if (data.isSelected && data.selectionRing) {
        // Pulse scale (using accumulated time for consistent speed)
        const scale = 1 + Math.sin(this.animationTime) * 0.1;
        data.selectionRing.scale.setScalar(scale);

        // Rotate slowly
        data.selectionRing.rotation.z += deltaTime * 0.001;
      }
    }
  }

  /**
   * Get tower render data
   */
  get(id: string): TowerRenderData | undefined {
    return this.towers.get(id);
  }

  /**
   * Get count of active towers
   */
  get count(): number {
    return this.towers.size;
  }

  /**
   * Get all tower meshes for raycasting
   * Returns array of { id, mesh } for intersection testing
   */
  getAllMeshes(): Array<{ id: string; mesh: THREE.Object3D }> {
    const result: Array<{ id: string; mesh: THREE.Object3D }> = [];
    for (const [id, data] of this.towers) {
      result.push({ id, mesh: data.mesh });
    }
    return result;
  }

  /**
   * Clear all towers
   */
  clear(): void {
    for (const id of this.towers.keys()) {
      this.remove(id);
    }
  }

  /**
   * Create a terrain-conforming range indicator disc with visible edge
   * Uses direct raycasting for accurate terrain conformance
   */
  private createRangeIndicator(
    centerLat: number,
    centerLon: number,
    centerHeight: number,
    range: number,
    localCenter: THREE.Vector3
  ): THREE.Mesh {
    // If no raycaster available, use simple flat circle with edge
    if (!this.terrainRaycaster) {
      const group = new THREE.Group() as unknown as THREE.Mesh;

      // Filled disc
      const discGeometry = new THREE.CircleGeometry(range, this.RANGE_SEGMENTS);
      const discMesh = new THREE.Mesh(discGeometry, this.rangeMaterial.clone());
      discMesh.rotation.x = -Math.PI / 2;
      group.add(discMesh);

      // Edge ring (gold border)
      const edgeGeometry = new THREE.RingGeometry(range - 2, range, this.RANGE_SEGMENTS);
      const edgeMaterial = new THREE.MeshBasicMaterial({
        color: 0xc9a44c, // TD gold
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const edgeMesh = new THREE.Mesh(edgeGeometry, edgeMaterial);
      edgeMesh.rotation.x = -Math.PI / 2;
      edgeMesh.position.y = 0.1; // Slightly above disc
      group.add(edgeMesh);

      group.position.copy(localCenter);
      group.position.y += 0.5;
      return group;
    }

    // Create terrain-conforming group with disc and edge rings using raycasting
    const group = new THREE.Group() as unknown as THREE.Mesh;

    // Create terrain-conforming disc geometry using direct raycasts
    const geometry = this.createTerrainDiscGeometryRaycast(localCenter.x, localCenter.z, range);

    const discMesh = new THREE.Mesh(geometry, this.rangeMaterial.clone());
    discMesh.renderOrder = 1;
    group.add(discMesh);

    // Create terrain-following edge rings using raycasting
    const edgePoints = this.createTerrainEdgePointsRaycast(localCenter.x, localCenter.z, range);

    if (edgePoints.length > 0) {
      // Gold inner edge (slightly inside the range)
      const goldEdgePoints = this.createTerrainEdgePointsRaycast(localCenter.x, localCenter.z, range - 1.5);
      if (goldEdgePoints.length > 0) {
        const goldGeometry = new THREE.BufferGeometry().setFromPoints([...goldEdgePoints, goldEdgePoints[0]]);
        const goldMaterial = new THREE.LineBasicMaterial({
          color: 0xc9a44c,
          linewidth: 2,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false,
        });
        const goldLine = new THREE.Line(goldGeometry, goldMaterial);
        goldLine.renderOrder = 2;
        group.add(goldLine);
      }

      // White outer edge (at the range boundary)
      const whiteGeometry = new THREE.BufferGeometry().setFromPoints([...edgePoints, edgePoints[0]]);
      const whiteMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        linewidth: 3,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      const whiteLine = new THREE.Line(whiteGeometry, whiteMaterial);
      whiteLine.renderOrder = 3;
      group.add(whiteLine);
    }

    return group;
  }

  /**
   * Create terrain-following edge points for a circle at given radius
   */
  private createTerrainEdgePoints(
    centerLat: number,
    centerLon: number,
    centerHeight: number,
    radius: number,
    localCenter: THREE.Vector3
  ): THREE.Vector3[] {
    if (!this.terrainHeightSampler) return [];

    const EDGE_OFFSET = 2.0; // Slightly higher than disc for visibility

    const points: THREE.Vector3[] = [];
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = 111320 * Math.cos((centerLat * Math.PI) / 180);

    const centerTerrainHeight = this.terrainHeightSampler(centerLat, centerLon);
    const baseCenterY = centerTerrainHeight !== null ? centerTerrainHeight : centerHeight;

    for (let seg = 0; seg < this.RANGE_SEGMENTS; seg++) {
      const angle = (seg / this.RANGE_SEGMENTS) * Math.PI * 2;

      const localX = Math.cos(angle) * radius;
      const localZ = Math.sin(angle) * radius;

      const sampleLat = centerLat + (localZ / metersPerDegreeLat);
      const sampleLon = centerLon + (localX / metersPerDegreeLon);

      const terrainHeight = this.terrainHeightSampler(sampleLat, sampleLon);
      const sampleY = terrainHeight !== null ? terrainHeight : baseCenterY;

      const worldX = localCenter.x + localX;
      const worldZ = localCenter.z - localZ;
      const worldY = (sampleY - baseCenterY) + localCenter.y + EDGE_OFFSET;

      points.push(new THREE.Vector3(worldX, worldY, worldZ));
    }

    return points;
  }

  /**
   * Create disc geometry that conforms to terrain
   * Samples terrain heights at multiple points and creates triangulated mesh
   */
  private createTerrainDiscGeometry(
    centerLat: number,
    centerLon: number,
    centerHeight: number,
    range: number,
    localCenter: THREE.Vector3
  ): THREE.BufferGeometry {
    if (!this.terrainHeightSampler) {
      return new THREE.CircleGeometry(range, this.RANGE_SEGMENTS);
    }

    const vertices: number[] = [];
    const indices: number[] = [];

    // Small offset above terrain for visibility
    const TERRAIN_OFFSET = 1.5;

    // Meters per degree (approximate at this latitude)
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLon = 111320 * Math.cos((centerLat * Math.PI) / 180);

    // Get center terrain height as reference for relative calculations
    const centerTerrainHeight = this.terrainHeightSampler(centerLat, centerLon);
    const baseCenterY = centerTerrainHeight !== null ? centerTerrainHeight : centerHeight;

    // Add center vertex - use localCenter.y as base (which is at terrain level)
    // localCenter already accounts for terrain height via geoToLocal
    vertices.push(localCenter.x, localCenter.y + TERRAIN_OFFSET, localCenter.z);

    // Sample points in concentric rings
    for (let ring = 1; ring <= this.RANGE_RINGS; ring++) {
      const ringRadius = (range * ring) / this.RANGE_RINGS;

      for (let seg = 0; seg < this.RANGE_SEGMENTS; seg++) {
        const angle = (seg / this.RANGE_SEGMENTS) * Math.PI * 2;

        // Local offset from center
        const localX = Math.cos(angle) * ringRadius;
        const localZ = Math.sin(angle) * ringRadius;

        // Convert to geo coordinates
        const sampleLat = centerLat + (localZ / metersPerDegreeLat);
        const sampleLon = centerLon + (localX / metersPerDegreeLon);

        // Sample terrain height at this point
        const terrainHeight = this.terrainHeightSampler(sampleLat, sampleLon);
        const sampleY = terrainHeight !== null ? terrainHeight : baseCenterY;

        // World coordinates - use height difference from center + localCenter.y
        const worldX = localCenter.x + localX;
        const worldZ = localCenter.z - localZ; // Note: Z is flipped in local coords
        const worldY = (sampleY - baseCenterY) + localCenter.y + TERRAIN_OFFSET;

        vertices.push(worldX, worldY, worldZ);
      }
    }

    // Create triangles
    // Center to first ring
    for (let seg = 0; seg < this.RANGE_SEGMENTS; seg++) {
      const next = (seg + 1) % this.RANGE_SEGMENTS;
      indices.push(0, 1 + seg, 1 + next);
    }

    // Between rings
    for (let ring = 1; ring < this.RANGE_RINGS; ring++) {
      const innerOffset = 1 + (ring - 1) * this.RANGE_SEGMENTS;
      const outerOffset = 1 + ring * this.RANGE_SEGMENTS;

      for (let seg = 0; seg < this.RANGE_SEGMENTS; seg++) {
        const nextSeg = (seg + 1) % this.RANGE_SEGMENTS;

        // Two triangles per quad
        indices.push(
          innerOffset + seg,
          outerOffset + seg,
          outerOffset + nextSeg
        );
        indices.push(
          innerOffset + seg,
          outerOffset + nextSeg,
          innerOffset + nextSeg
        );
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Create terrain-following edge points using direct raycasting
   * Much more accurate than geo-coordinate based sampling
   */
  private createTerrainEdgePointsRaycast(
    centerX: number,
    centerZ: number,
    radius: number
  ): THREE.Vector3[] {
    if (!this.terrainRaycaster) return [];

    const EDGE_OFFSET = 2.0; // Height above terrain for visibility
    const points: THREE.Vector3[] = [];

    for (let seg = 0; seg < this.RANGE_SEGMENTS; seg++) {
      const angle = (seg / this.RANGE_SEGMENTS) * Math.PI * 2;

      // Local offset from center
      const dx = Math.cos(angle) * radius;
      const dz = Math.sin(angle) * radius;

      // World position (note: Z is flipped in local coords)
      const worldX = centerX + dx;
      const worldZ = centerZ - dz;

      // Raycast to get actual terrain height at this position
      const terrainY = this.terrainRaycaster(worldX, worldZ);

      if (terrainY !== null) {
        points.push(new THREE.Vector3(worldX, terrainY + EDGE_OFFSET, worldZ));
      }
    }

    return points;
  }

  /**
   * Create disc geometry using direct raycasting for terrain conformance
   * Each vertex is placed exactly on the terrain surface via raycasting
   */
  private createTerrainDiscGeometryRaycast(
    centerX: number,
    centerZ: number,
    range: number
  ): THREE.BufferGeometry {
    if (!this.terrainRaycaster) {
      return new THREE.CircleGeometry(range, this.RANGE_SEGMENTS);
    }

    const vertices: number[] = [];
    const indices: number[] = [];

    // Small offset above terrain for visibility
    const TERRAIN_OFFSET = 1.5;

    // Get center terrain height via raycast
    const centerY = this.terrainRaycaster(centerX, centerZ);
    if (centerY === null) {
      // Fallback to flat circle if center raycast fails
      return new THREE.CircleGeometry(range, this.RANGE_SEGMENTS);
    }

    // Add center vertex
    vertices.push(centerX, centerY + TERRAIN_OFFSET, centerZ);

    // Sample points in concentric rings
    for (let ring = 1; ring <= this.RANGE_RINGS; ring++) {
      const ringRadius = (range * ring) / this.RANGE_RINGS;

      for (let seg = 0; seg < this.RANGE_SEGMENTS; seg++) {
        const angle = (seg / this.RANGE_SEGMENTS) * Math.PI * 2;

        // Local offset from center
        const dx = Math.cos(angle) * ringRadius;
        const dz = Math.sin(angle) * ringRadius;

        // World position (note: Z is flipped in local coords)
        const worldX = centerX + dx;
        const worldZ = centerZ - dz;

        // Raycast to get actual terrain height
        const terrainY = this.terrainRaycaster(worldX, worldZ);
        const worldY = terrainY !== null ? terrainY + TERRAIN_OFFSET : centerY + TERRAIN_OFFSET;

        vertices.push(worldX, worldY, worldZ);
      }
    }

    // Create triangles
    // Center to first ring
    for (let seg = 0; seg < this.RANGE_SEGMENTS; seg++) {
      const next = (seg + 1) % this.RANGE_SEGMENTS;
      indices.push(0, 1 + seg, 1 + next);
    }

    // Between rings
    for (let ring = 1; ring < this.RANGE_RINGS; ring++) {
      const innerOffset = 1 + (ring - 1) * this.RANGE_SEGMENTS;
      const outerOffset = 1 + ring * this.RANGE_SEGMENTS;

      for (let seg = 0; seg < this.RANGE_SEGMENTS; seg++) {
        const nextSeg = (seg + 1) % this.RANGE_SEGMENTS;

        // Two triangles per quad
        indices.push(
          innerOffset + seg,
          outerOffset + seg,
          outerOffset + nextSeg
        );
        indices.push(
          innerOffset + seg,
          outerOffset + nextSeg,
          innerOffset + nextSeg
        );
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Update range indicator geometry with current terrain data
   * Call this when terrain data might have changed
   */
  updateRangeIndicatorTerrain(id: string): void {
    const data = this.towers.get(id);
    if (!data || !data.rangeIndicator) return;

    // Need either raycaster or height sampler
    if (!this.terrainRaycaster && !this.terrainHeightSampler) return;

    // Get terrain level position (without heightOffset - range indicator lies on terrain)
    const terrainPos = this.sync.geoToLocal(data.lat, data.lon, data.height);

    // Create new geometry using raycaster if available, otherwise fall back to height sampler
    let newGeometry: THREE.BufferGeometry;
    if (this.terrainRaycaster) {
      newGeometry = this.createTerrainDiscGeometryRaycast(
        terrainPos.x,
        terrainPos.z,
        data.typeConfig.range
      );
    } else {
      newGeometry = this.createTerrainDiscGeometry(
        data.lat,
        data.lon,
        data.height,
        data.typeConfig.range,
        terrainPos
      );
    }

    // Dispose old geometry and replace
    data.rangeIndicator.geometry.dispose();
    data.rangeIndicator.geometry = newGeometry;

    // Reset position (geometry is now in world coords)
    data.rangeIndicator.position.set(0, 0, 0);
    data.rangeIndicator.rotation.set(0, 0, 0);
  }

  /**
   * Create a hex grid for Line-of-Sight visualization
   * Uses InstancedMesh for optimal performance (single draw call)
   * Per-instance aIsBlocked attribute controls hatching pattern per cell
   */
  private createHexGrid(
    centerX: number,
    centerZ: number,
    range: number,
    _towerTipY: number
  ): { hexGrid: THREE.InstancedMesh; hexCells: HexCell[] } {
    const hexCells: HexCell[] = [];

    // Hex dimensions (flat-top)
    const hexRadius = (this.HEX_SIZE - this.HEX_GAP) / 2;
    const hexWidth = hexRadius * 2;
    const hexHeight = hexRadius * Math.sqrt(3);

    // Horizontal and vertical spacing
    const horizSpacing = hexWidth * 0.75;
    const vertSpacing = hexHeight;

    // Calculate how many hexes we need in each direction
    const maxHexesX = Math.ceil(range / horizSpacing) + 1;
    const maxHexesZ = Math.ceil(range / vertSpacing) + 1;

    // First pass: collect all valid hex positions
    interface HexPosition {
      worldX: number;
      worldZ: number;
      terrainY: number;
    }
    const hexPositions: HexPosition[] = [];

    for (let qx = -maxHexesX; qx <= maxHexesX; qx++) {
      for (let qz = -maxHexesZ; qz <= maxHexesZ; qz++) {
        // Offset every other row (offset coordinates)
        const xOffset = qz % 2 === 0 ? 0 : horizSpacing / 2;
        const localX = qx * horizSpacing + xOffset;
        const localZ = qz * vertSpacing * 0.75;

        // Check if hex center is within range
        const distFromCenter = Math.sqrt(localX * localX + localZ * localZ);
        if (distFromCenter > range - hexRadius * 0.5) {
          continue;
        }

        // World position
        const worldX = centerX + localX;
        const worldZ = centerZ - localZ;

        // Get terrain height
        if (!this.terrainRaycaster) continue;
        const terrainY = this.terrainRaycaster(worldX, worldZ);
        if (terrainY === null) continue;

        hexPositions.push({ worldX, worldZ, terrainY });
      }
    }

    // Create hex geometry template (flat-top hexagon)
    const hexShape = new THREE.Shape();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const x = hexRadius * Math.cos(angle);
      const y = hexRadius * Math.sin(angle);
      if (i === 0) {
        hexShape.moveTo(x, y);
      } else {
        hexShape.lineTo(x, y);
      }
    }
    hexShape.closePath();
    const hexGeometry = new THREE.ShapeGeometry(hexShape);

    // Create InstancedMesh with collected positions
    const instanceCount = hexPositions.length;
    const hexGrid = new THREE.InstancedMesh(hexGeometry, this.hexMaterial, instanceCount);
    hexGrid.renderOrder = 3;

    // Create instance matrices and aIsBlocked attribute
    const isBlockedArray = new Float32Array(instanceCount);
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Euler(-Math.PI / 2, 0, 0); // Lay flat
    const quaternion = new THREE.Quaternion().setFromEuler(rotation);
    const scale = new THREE.Vector3(1, 1, 1);

    for (let i = 0; i < instanceCount; i++) {
      const pos = hexPositions[i];

      // Set instance matrix (position + rotation)
      matrix.compose(
        new THREE.Vector3(pos.worldX, pos.terrainY + 1.0, pos.worldZ),
        quaternion,
        scale
      );
      hexGrid.setMatrixAt(i, matrix);

      // Initialize as not blocked
      isBlockedArray[i] = 0;

      // Store cell data
      hexCells.push({
        index: i,
        centerX: pos.worldX,
        centerZ: pos.worldZ,
        terrainY: pos.terrainY,
        isBlocked: false,
      });
    }

    // Add aIsBlocked as instanced attribute
    hexGrid.geometry.setAttribute(
      'aIsBlocked',
      new THREE.InstancedBufferAttribute(isBlockedArray, 1)
    );

    hexGrid.instanceMatrix.needsUpdate = true;
    hexGrid.visible = false; // Hidden until tower is selected

    return { hexGrid, hexCells };
  }

  /**
   * Update Line-of-Sight visualization for all hex cells in a tower's grid
   * Raycasts from tower tip to each hex cell center, updates aIsBlocked attribute
   */
  private updateHexGridLoS(data: TowerRenderData): void {
    if (!data.hexCells || data.hexCells.length === 0) return;
    if (!data.hexGrid) return;
    if (!this.losRaycaster) {
      console.warn('[ThreeTowerRenderer] No LoS raycaster set, skipping LoS update');
      return;
    }

    const terrainPos = this.sync.geoToLocal(data.lat, data.lon, data.height);
    const towerX = terrainPos.x;
    const towerZ = terrainPos.z;

    // Get the aIsBlocked attribute array
    const isBlockedAttr = data.hexGrid.geometry.getAttribute('aIsBlocked') as THREE.InstancedBufferAttribute;
    const isBlockedArray = isBlockedAttr.array as Float32Array;

    for (const cell of data.hexCells) {
      const targetY = cell.terrainY + 1.0;
      const isBlocked = this.losRaycaster(
        towerX, data.tipY, towerZ,
        cell.centerX, targetY, cell.centerZ
      );

      cell.isBlocked = isBlocked;
      isBlockedArray[cell.index] = isBlocked ? 1.0 : 0.0;
    }

    // Mark attribute as needing update
    isBlockedAttr.needsUpdate = true;
  }

  /**
   * Check if there's line of sight from a tower to a specific position
   * Used for actual targeting decisions
   */
  hasLineOfSight(towerId: string, targetX: number, targetY: number, targetZ: number): boolean {
    const data = this.towers.get(towerId);
    if (!data || !this.losRaycaster) return true; // Assume clear if can't check

    const terrainPos = this.sync.geoToLocal(data.lat, data.lon, data.height);

    return !this.losRaycaster(
      terrainPos.x, data.tipY, terrainPos.z,
      targetX, targetY, targetZ
    );
  }

  /**
   * Recursively dispose Three.js object
   */
  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        const materials: THREE.Material[] = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const mat of materials) {
          const stdMat = mat as THREE.MeshStandardMaterial;
          if (stdMat.map) stdMat.map.dispose();
          if (stdMat.normalMap) stdMat.normalMap.dispose();
          mat.dispose();
        }
      }
    });
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clear();
    this.modelTemplates.clear();
    this.rangeMaterial.dispose();
    this.selectionMaterial.dispose();
    this.hexMaterial.dispose();
  }
}
