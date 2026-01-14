import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CoordinateSync } from './index';
import { TowerTypeConfig, TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { LOS_HATCHING_VERTEX, LOS_HATCHING_FRAGMENT } from '../../game/tower-defense/shaders/los-hatching.shaders';
import { RouteLosGrid } from './route-los-grid';
import { GeoPosition } from '../../models/game.types';

/**
 * Tower render data - stored per tower
 */
export interface TowerRenderData {
  id: string;
  mesh: THREE.Object3D;
  turretPart: THREE.Object3D | null; // Rotating turret part (e.g., turret_top)
  aimArrow: THREE.ArrowHelper | null; // Debug arrow showing aim direction
  rangeIndicator: THREE.Mesh | null;
  selectionRing: THREE.Mesh | null;
  hexGrid: THREE.InstancedMesh | null; // Instanced mesh for hex visualization
  hexCells: HexCell[]; // Hex cell data for LoS calculations
  tipMarker: THREE.Mesh | null; // Debug marker showing LoS origin point
  losRing: THREE.LineLoop | null; // Debug ring showing LOS origin circle
  losRays: THREE.Group | null; // Debug raycast lines
  typeConfig: TowerTypeConfig;
  isSelected: boolean;
  // Geo coordinates for terrain sampling
  lat: number;
  lon: number;
  height: number;
  // Tower tip position for LoS calculations
  tipY: number;
  // Custom rotation set by user during placement (radians)
  customRotation: number;
  // Turret rotation animation
  currentLocalRotation: number; // Current turret rotation (local space)
  targetLocalRotation: number; // Target turret rotation (local space)
  // Route-based LOS grid for fast O(1) lookups
  routeLosGrid: RouteLosGrid | null;
  routeLosDebugViz: THREE.Group | null;
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
  private gltfLoader: GLTFLoader;
  private fbxLoader: FBXLoader;

  // Cached model templates per tower type (stores the scene/group from GLTF or FBX)
  private modelTemplates = new Map<string, THREE.Object3D>();
  private loadingPromises = new Map<string, Promise<THREE.Object3D>>();

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

  // Preview hex grid for placement mode LoS visualization
  private previewHexGrid: THREE.InstancedMesh | null = null;
  private previewHexCells: HexCell[] = [];

  // Animation time accumulator for frame-independent animations
  private animationTime = 0;

  // Configuration for terrain-conforming range indicator
  private readonly RANGE_SEGMENTS = 48; // Number of segments around the circle
  private readonly RANGE_RINGS = 8; // Number of concentric rings

  // Hex grid configuration
  private readonly HEX_SIZE = 8; // Size of each hex cell in meters (flat-to-flat)
  private readonly HEX_GAP = 0.5; // Small gap between hexes for visual clarity

  // LOS offset configuration - raycast starts from tower edge, not center
  private readonly LOS_OFFSET_MIN = 2.4; // Offset in meters from tower center

  constructor(scene: THREE.Scene, sync: CoordinateSync) {
    this.scene = scene;
    this.sync = sync;
    this.gltfLoader = new GLTFLoader();
    this.fbxLoader = new FBXLoader();

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
   * Load a model from URL, supporting both GLTF/GLB and FBX formats
   */
  private async loadModelFromUrl(url: string): Promise<THREE.Object3D> {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.endsWith('.fbx')) {
      const model = await this.fbxLoader.loadAsync(url);
      this.applyFbxMaterials(model);
      return model;
    } else {
      const gltf = await this.gltfLoader.loadAsync(url);
      return gltf.scene;
    }
  }

  /**
   * Apply colors to FBX materials that may not have proper textures
   * Maps material names to appropriate colors
   */
  private applyFbxMaterials(model: THREE.Object3D): void {
    // Color mapping for known material names
    const materialColors: Record<string, number> = {
      'lightwood': 0xc4a574,      // Light wood brown
      'wood': 0xa0784a,           // Medium wood
      'darkwood': 0x6b4423,       // Dark wood
      'celing': 0xcd5c5c,         // Ceiling/roof - indian red (roof tiles)
      'ceiling': 0xcd5c5c,        // Alternative spelling
      'roof': 0xcd5c5c,           // Roof tiles
      'stone': 0x808080,          // Stone gray
      'metal': 0x707070,          // Metal gray
    };

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

        materials.forEach((mat) => {
          // Handle any material type with a color property
          const matWithColor = mat as THREE.MeshStandardMaterial;
          if (matWithColor.color) {
            const matName = mat.name.toLowerCase();

            // Find matching color
            let color: number | undefined;
            for (const [key, value] of Object.entries(materialColors)) {
              if (matName.includes(key)) {
                color = value;
                break;
              }
            }

            // Apply color - always override for FBX
            const finalColor = color ?? 0xb8956e; // Default wood color
            matWithColor.color.setHex(finalColor);

            // Ensure material is visible
            if ('transparent' in mat) mat.transparent = false;
            if ('opacity' in mat) (mat as THREE.MeshStandardMaterial).opacity = 1.0;
          }
        });
      }
    });
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

    const promise = this.loadModelFromUrl(config.modelUrl);
    this.loadingPromises.set(typeId, promise);

    try {
      const model = await promise;
      this.modelTemplates.set(typeId, model);
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
   * @param id Tower ID
   * @param typeId Tower type
   * @param lat Latitude
   * @param lon Longitude
   * @param height Terrain height
   * @param customRotation Custom rotation set by user during placement (radians)
   */
  async create(
    id: string,
    typeId: TowerTypeId,
    lat: number,
    lon: number,
    height: number,
    customRotation = 0
  ): Promise<TowerRenderData | null> {
    const config = TOWER_TYPES[typeId];
    if (!config) {
      console.error(`[ThreeTowerRenderer] Unknown tower type: ${typeId}`);
      return null;
    }

    // Ensure model is loaded
    let modelTemplate = this.modelTemplates.get(typeId);
    if (!modelTemplate) {
      const promise = this.loadingPromises.get(typeId) || this.loadModelFromUrl(config.modelUrl);
      if (!this.loadingPromises.has(typeId)) {
        this.loadingPromises.set(typeId, promise);
      }
      try {
        modelTemplate = await promise;
        this.modelTemplates.set(typeId, modelTemplate);
      } catch (err) {
        console.error(`[ThreeTowerRenderer] Failed to load model: ${typeId}`, err);
        return null;
      } finally {
        this.loadingPromises.delete(typeId);
      }
    }

    // Clone the model
    const mesh = modelTemplate.clone();
    mesh.scale.setScalar(config.scale);

    // Apply rotation: custom rotation + config rotation
    const baseRotation = config.rotationY ?? 0;
    mesh.rotation.y = baseRotation + customRotation;

    // Find turret part if it exists (for turret rotation)
    // Supports both 'turret_top' and 'top' naming conventions
    let turretPart: THREE.Object3D | null = null;
    mesh.traverse((node) => {
      if ((node.name === 'turret_top' || node.name === 'top') && !turretPart) {
        turretPart = node;
      }
    });

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

    // Check if this is a pure air tower (only targets air, not ground)
    // Pure air towers don't need LOS visualization since air enemies are always visible
    const isPureAirTower = (config.canTargetAir ?? false) && !(config.canTargetGround ?? true);

    // Create hex grid for LoS visualization (initially hidden)
    // Skip for pure air towers - they don't need LOS checks
    let hexGrid: THREE.InstancedMesh | null = null;
    let hexCells: HexCell[] = [];
    if (!isPureAirTower) {
      const hexData = this.createHexGrid(terrainPos.x, terrainPos.z, config.range, tipY);
      hexGrid = hexData.hexGrid;
      hexCells = hexData.hexCells;
      hexGrid.visible = false;
      this.scene.add(hexGrid);
    }

    // Create tip marker (magenta sphere showing LoS origin point)
    // Skip for pure air towers
    let tipMarker: THREE.Mesh | null = null;
    if (!isPureAirTower) {
      const tipMarkerGeometry = new THREE.SphereGeometry(2, 16, 16);
      const tipMarkerMaterial = new THREE.MeshBasicMaterial({
        color: 0xff00ff, // Magenta
        depthTest: false, // Always visible, even inside tower mesh
      });
      tipMarker = new THREE.Mesh(tipMarkerGeometry, tipMarkerMaterial);
      tipMarker.position.set(terrainPos.x, tipY, terrainPos.z);
      tipMarker.renderOrder = 999; // Render on top
      tipMarker.visible = this.debugMode; // Visible in debug mode, or when tower is selected
      this.scene.add(tipMarker);
    }

    // Create LOS ring (cyan circle showing where LOS raycasts originate)
    // Skip for pure air towers
    let losRing: THREE.LineLoop | null = null;
    if (!isPureAirTower) {
      const losOffset = this.LOS_OFFSET_MIN;
      const losRingPoints: THREE.Vector3[] = [];
      const losRingSegments = 32;
      for (let i = 0; i <= losRingSegments; i++) {
        const angle = (i / losRingSegments) * Math.PI * 2;
        losRingPoints.push(new THREE.Vector3(
          Math.cos(angle) * losOffset,
          0,
          Math.sin(angle) * losOffset
        ));
      }
      const losRingGeometry = new THREE.BufferGeometry().setFromPoints(losRingPoints);
      const losRingMaterial = new THREE.LineBasicMaterial({
        color: 0x00ffff, // Cyan
        depthTest: false,
      });
      losRing = new THREE.LineLoop(losRingGeometry, losRingMaterial);
      losRing.position.set(terrainPos.x, tipY, terrainPos.z);
      losRing.renderOrder = 999;
      losRing.visible = this.debugMode;
      this.scene.add(losRing);
    }

    // Create aim direction arrow for turrets (debug visualization)
    // DISABLED: Causing NaN errors in render loop
    const aimArrow: THREE.ArrowHelper | null = null;
    // if (turretPart) {
    //   const arrowDir = new THREE.Vector3(0, 0, -1);
    //   const arrowOrigin = new THREE.Vector3(terrainPos.x, tipY, terrainPos.z);
    //   const arrowLength = 15;
    //   const arrowColor = 0x00ff00;
    //   aimArrow = new THREE.ArrowHelper(arrowDir, arrowOrigin, arrowLength, arrowColor, 3, 2);
    //   aimArrow.visible = this.debugMode;
    //   this.scene.add(aimArrow);
    // }

    const renderData: TowerRenderData = {
      id,
      mesh,
      turretPart,
      aimArrow,
      rangeIndicator,
      selectionRing,
      hexGrid,
      hexCells,
      tipMarker,
      losRing,
      losRays: null, // Created on demand in debug mode
      typeConfig: config,
      isSelected: false,
      lat,
      lon,
      height,
      tipY,
      customRotation,
      currentLocalRotation: 0, // Start at base position
      targetLocalRotation: 0, // Target at base position
      routeLosGrid: null, // Populated via generateRouteLosGrid()
      routeLosDebugViz: null,
    };

    this.towers.set(id, renderData);
    return renderData;
  }

  /**
   * Generate route-based LOS grid for a tower
   * Called after tower placement to pre-compute LOS along enemy routes
   * @param towerId Tower ID
   * @param routes Array of enemy routes (each route is GeoPosition[])
   */
  generateRouteLosGrid(towerId: string, routes: GeoPosition[][]): void {
    const data = this.towers.get(towerId);
    if (!data) return;

    // Skip for pure air towers (they don't need LOS)
    const isPureAirTower =
      (data.typeConfig.canTargetAir ?? false) && !(data.typeConfig.canTargetGround ?? true);
    if (isPureAirTower) return;

    // Need both raycasters
    if (!this.losRaycaster || !this.terrainRaycaster) {
      console.warn('[ThreeTowerRenderer] Cannot generate route LOS grid - missing raycasters');
      return;
    }

    // Get tower local position
    const terrainPos = this.sync.geoToLocal(data.lat, data.lon, data.height);

    // Create and populate the grid
    data.routeLosGrid = new RouteLosGrid(
      terrainPos.x,
      terrainPos.z,
      data.tipY,
      data.typeConfig.range,
      this.losRaycaster,
      this.terrainRaycaster
    );

    data.routeLosGrid.generateFromRoutes(routes, this.sync);

    const stats = data.routeLosGrid.getStats();
    console.log(
      `[ThreeTowerRenderer] Route LOS grid for ${towerId}: ${stats.totalCells} cells ` +
        `(${stats.visibleCells} visible, ${stats.blockedCells} blocked)`
    );
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
   * Update tower rotation target (for aiming at target)
   * Only affects turrets (turret_top). Actual rotation is interpolated in updateTurretAnimations().
   *
   * Coordinate system mapping:
   * - Geo: North (+lat), East (+lon)
   * - Three.js local: North → -Z, East → +X
   * - geoHeading = atan2(dLon, dLat): 0=North, π/2=East
   * - Three.js rotation.y: 0 faces -Z (North), -π/2 faces +X (East)
   * - Conversion: threeJsRotation = -geoHeading
   */
  updateRotation(id: string, heading: number): void {
    const data = this.towers.get(id);
    if (!data || !data.turretPart) return;

    // Turret model offset: if barrels don't point -Z in model space, we need to compensate
    // For dual-gatling: barrels point +X, so offset = π/2 (90° from -Z)
    // The config.rotationY is set to align the model, so -rotationY gives us the model offset
    const turretModelOffset = -(data.typeConfig.rotationY ?? 0);

    // Convert geo heading to Three.js target rotation for the turret
    // geoHeading 0 = North = -Z = Three.js rotation 0
    // But if model barrels are offset, add that offset
    const threeJsTargetRotation = -heading + turretModelOffset;

    // Parent mesh rotation (includes config.rotationY + customRotation)
    const parentRotation = data.mesh.rotation.y;

    // Convert to local space: subtract parent's rotation
    // Set as target - actual rotation is interpolated in updateTurretAnimations()
    data.targetLocalRotation = threeJsTargetRotation - parentRotation;
  }

  /**
   * Reset turret rotation to base position (facing forward relative to tower base)
   * Called when tower has no targets in range - sets target for smooth return animation
   */
  resetRotation(id: string): void {
    const data = this.towers.get(id);
    if (!data || !data.turretPart) return;

    // Set target to 0 = turret faces same direction as tower base
    // Actual rotation is interpolated in updateTurretAnimations()
    data.targetLocalRotation = 0;
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
    if (data.losRing) data.losRing.visible = this.debugMode;
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
    // Keep debug markers visible in debug mode
    if (data.tipMarker) data.tipMarker.visible = this.debugMode;
    if (data.losRing) data.losRing.visible = this.debugMode;
    // Clear debug rays when deselected
    this.clearLosRays(data);
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
   * Set debug mode - shows tip markers, LOS rings, and raycast lines for all towers
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;

    for (const data of this.towers.values()) {
      if (data.tipMarker) {
        data.tipMarker.visible = enabled;
      }
      if (data.losRing) {
        data.losRing.visible = enabled;
      }
      if (data.aimArrow) {
        data.aimArrow.visible = enabled;
      }
      // Recalculate LOS for selected towers to show/hide debug rays
      if (data.isSelected && data.hexGrid) {
        this.updateHexGridLoS(data);
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
   * Set route LOS debug mode - shows/hides pre-computed route LOS grid visualization
   * @param enabled Whether to show route LOS debug visualization
   */
  setRouteLosDebugMode(enabled: boolean): void {
    for (const data of this.towers.values()) {
      if (enabled) {
        // Create debug visualization if not exists
        if (!data.routeLosDebugViz && data.routeLosGrid) {
          data.routeLosDebugViz = data.routeLosGrid.createDebugVisualization();
          this.scene.add(data.routeLosDebugViz);
        }
        if (data.routeLosDebugViz) {
          data.routeLosDebugViz.visible = true;
        }
      } else {
        // Hide debug visualization
        if (data.routeLosDebugViz) {
          data.routeLosDebugViz.visible = false;
        }
      }
    }
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

    // Remove LOS ring
    if (data.losRing) {
      this.scene.remove(data.losRing);
      data.losRing.geometry.dispose();
      (data.losRing.material as THREE.Material).dispose();
    }

    // Remove aim arrow
    if (data.aimArrow) {
      this.scene.remove(data.aimArrow);
      data.aimArrow.dispose();
    }

    // Remove debug rays
    this.clearLosRays(data);

    // Remove route LOS grid and debug visualization
    if (data.routeLosGrid) {
      data.routeLosGrid.dispose();
    }
    if (data.routeLosDebugViz) {
      this.scene.remove(data.routeLosDebugViz);
      this.disposeObject(data.routeLosDebugViz);
    }

    this.towers.delete(id);
  }

  /**
   * Update selection ring animation, hex grid shader, and turret rotations
   * Call each frame for pulse effect, hatching animation, and smooth turret movement
   */
  updateAnimations(deltaTime: number): void {
    // Accumulate time for frame-independent animation
    this.animationTime += deltaTime * 0.003;

    // Update hex material shader time uniform
    this.hexMaterial.uniforms['uTime'].value = this.animationTime;

    // Turret rotation speed: ~180 degrees per second (PI radians/s)
    // Scale deltaTime from ms to seconds
    const turretRotationSpeed = Math.PI; // radians per second
    const maxRotationThisFrame = turretRotationSpeed * (deltaTime / 1000);

    for (const data of this.towers.values()) {
      // Selection ring animation
      if (data.isSelected && data.selectionRing) {
        // Pulse scale (using accumulated time for consistent speed)
        const scale = 1 + Math.sin(this.animationTime) * 0.1;
        data.selectionRing.scale.setScalar(scale);

        // Rotate slowly
        data.selectionRing.rotation.z += deltaTime * 0.001;
      }

      // Turret rotation interpolation (smooth tracking and return-to-base)
      if (data.turretPart) {
        const current = data.currentLocalRotation;
        const target = data.targetLocalRotation;

        // Calculate shortest rotation path (handle wraparound at ±π)
        let diff = target - current;

        // Normalize to [-π, π] for shortest path
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        // If close enough, snap to target
        if (Math.abs(diff) < 0.01) {
          data.currentLocalRotation = target;
        } else {
          // Move towards target, clamped to max rotation speed
          const rotation = Math.sign(diff) * Math.min(Math.abs(diff), maxRotationThisFrame);
          data.currentLocalRotation += rotation;
        }

        // Apply current rotation to turret
        data.turretPart.rotation.y = data.currentLocalRotation;

        // Update debug arrow direction (world space)
        if (data.aimArrow) {
          const parentRotation = data.mesh.rotation.y;
          const worldRot = data.currentLocalRotation + parentRotation;
          const dir = new THREE.Vector3(
            Math.sin(worldRot),
            0,
            Math.cos(worldRot)
          );
          data.aimArrow.setDirection(dir);
        }
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
   * Check if tower's turret is aligned with its target (within tolerance)
   * Returns true if:
   * - Tower has no turret part (static tower, always aligned)
   * - Turret rotation is within tolerance of target rotation
   * @param id Tower ID
   * @param toleranceRadians Maximum allowed deviation in radians (default: ~15°)
   */
  isTurretAligned(id: string, toleranceRadians = Math.PI / 12): boolean {
    const data = this.towers.get(id);
    if (!data) return true; // Unknown tower, assume aligned
    if (!data.turretPart) return true; // No turret, always aligned

    // Calculate shortest angle difference
    let diff = data.targetLocalRotation - data.currentLocalRotation;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    return Math.abs(diff) <= toleranceRadians;
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
   * Raycasts from tower edge (not center) to each hex cell center, updates aIsBlocked attribute
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

    // Fixed LOS offset (raycast from tower edge, not center)
    const losOffset = this.LOS_OFFSET_MIN;

    // Get the aIsBlocked attribute array
    const isBlockedAttr = data.hexGrid.geometry.getAttribute('aIsBlocked') as THREE.InstancedBufferAttribute;
    const isBlockedArray = isBlockedAttr.array as Float32Array;

    // Clear old debug rays
    this.clearLosRays(data);

    // Create debug ray visualization if in debug mode
    if (this.debugMode) {
      data.losRays = new THREE.Group();
      data.losRays.renderOrder = 998;
    }

    for (const cell of data.hexCells) {
      // Calculate direction from tower to target (XZ plane only)
      const dirX = cell.centerX - towerX;
      const dirZ = cell.centerZ - towerZ;
      const dist = Math.sqrt(dirX * dirX + dirZ * dirZ);

      // Offset origin point towards target (on tower edge)
      const originX = towerX + (dirX / dist) * losOffset;
      const originZ = towerZ + (dirZ / dist) * losOffset;

      const targetY = cell.terrainY + 1.0;
      const isBlocked = this.losRaycaster(
        originX, data.tipY, originZ,
        cell.centerX, targetY, cell.centerZ
      );

      cell.isBlocked = isBlocked;
      isBlockedArray[cell.index] = isBlocked ? 1.0 : 0.0;

      // Create debug ray line if in debug mode
      if (this.debugMode && data.losRays) {
        const points = [
          new THREE.Vector3(originX, data.tipY, originZ),
          new THREE.Vector3(cell.centerX, targetY, cell.centerZ)
        ];
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: isBlocked ? 0xff0000 : 0x00ff00, // Red if blocked, green if clear
          transparent: true,
          opacity: 0.6,
          depthTest: false,
        });
        const line = new THREE.Line(geometry, material);
        line.renderOrder = 998;
        data.losRays.add(line);
      }
    }

    // Add debug rays to scene
    if (data.losRays) {
      this.scene.add(data.losRays);
    }

    // Mark attribute as needing update
    isBlockedAttr.needsUpdate = true;
  }

  /**
   * Clear debug raycast lines for a tower
   */
  private clearLosRays(data: TowerRenderData): void {
    if (data.losRays) {
      // Dispose all line geometries and materials
      data.losRays.traverse((child) => {
        if (child instanceof THREE.Line) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
      this.scene.remove(data.losRays);
      data.losRays = null;
    }
  }

  /**
   * Check if there's line of sight from a tower to a specific position
   * Uses route-based LOS grid for O(1) lookup if available, falls back to raycast
   */
  hasLineOfSight(towerId: string, targetX: number, targetY: number, targetZ: number): boolean {
    const data = this.towers.get(towerId);
    if (!data) return true; // Assume clear if can't check

    // Fast path: Use pre-computed route LOS grid if available
    if (data.routeLosGrid) {
      const gridResult = data.routeLosGrid.isPositionVisible(targetX, targetZ);
      if (gridResult !== undefined) {
        return gridResult;
      }
      // Position not in grid - fall through to raycast
    }

    // Slow path: Fall back to runtime raycast
    if (!this.losRaycaster) return true;

    const terrainPos = this.sync.geoToLocal(data.lat, data.lon, data.height);
    const towerX = terrainPos.x;
    const towerZ = terrainPos.z;

    // Fixed LOS offset (raycast from tower edge, not center)
    const losOffset = this.LOS_OFFSET_MIN;

    // Calculate direction from tower to target (XZ plane only)
    const dirX = targetX - towerX;
    const dirZ = targetZ - towerZ;
    const dist = Math.sqrt(dirX * dirX + dirZ * dirZ);

    // Offset origin point towards target (on tower edge)
    const originX = towerX + (dirX / dist) * losOffset;
    const originZ = towerZ + (dirZ / dist) * losOffset;

    return !this.losRaycaster(
      originX, data.tipY, originZ,
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
   * Show Line-of-Sight preview hex grid for tower placement
   * Call this when entering rotation mode to show LoS before confirming placement
   * Skipped for pure air towers (canTargetAir && !canTargetGround) - they don't need LOS
   */
  showPreviewLoS(lat: number, lon: number, height: number, typeId: TowerTypeId): void {
    // Dispose existing preview if any
    this.hidePreviewLoS();

    if (!this.terrainRaycaster || !this.losRaycaster) return;

    const config = TOWER_TYPES[typeId];
    if (!config) return;

    // Skip LOS preview for pure air towers - they don't need LOS checks
    const isPureAirTower = (config.canTargetAir ?? false) && !(config.canTargetGround ?? true);
    if (isPureAirTower) return;

    // Get local coordinates
    const terrainPos = this.sync.geoToLocal(lat, lon, height);

    // Calculate tower tip height (for LoS raycast origin)
    const tipY = terrainPos.y + (config.shootHeight ?? config.heightOffset + 5);

    // Create hex grid
    const { hexGrid, hexCells } = this.createHexGrid(
      terrainPos.x,
      terrainPos.z,
      config.range,
      tipY
    );

    this.previewHexGrid = hexGrid;
    this.previewHexCells = hexCells;

    // Calculate LoS for each cell
    this.updatePreviewHexGridLoS(terrainPos.x, terrainPos.z, tipY);

    // Show the grid
    this.previewHexGrid.visible = true;
    this.scene.add(this.previewHexGrid);
  }

  /**
   * Update LoS calculation for preview hex grid
   */
  private updatePreviewHexGridLoS(towerX: number, towerZ: number, tipY: number): void {
    if (!this.previewHexGrid || this.previewHexCells.length === 0) return;
    if (!this.losRaycaster) return;

    const losOffset = this.LOS_OFFSET_MIN;

    const isBlockedAttr = this.previewHexGrid.geometry.getAttribute('aIsBlocked') as THREE.InstancedBufferAttribute;
    const isBlockedArray = isBlockedAttr.array as Float32Array;

    for (const cell of this.previewHexCells) {
      const dirX = cell.centerX - towerX;
      const dirZ = cell.centerZ - towerZ;
      const dist = Math.sqrt(dirX * dirX + dirZ * dirZ);

      if (dist < 0.1) {
        isBlockedArray[cell.index] = 0;
        continue;
      }

      const originX = towerX + (dirX / dist) * losOffset;
      const originZ = towerZ + (dirZ / dist) * losOffset;
      const targetY = cell.terrainY + 1.0;

      const isBlocked = this.losRaycaster(
        originX, tipY, originZ,
        cell.centerX, targetY, cell.centerZ
      );

      cell.isBlocked = isBlocked;
      isBlockedArray[cell.index] = isBlocked ? 1.0 : 0.0;
    }

    isBlockedAttr.needsUpdate = true;
  }

  /**
   * Hide and dispose preview LoS hex grid
   */
  hidePreviewLoS(): void {
    if (this.previewHexGrid) {
      this.scene.remove(this.previewHexGrid);
      this.previewHexGrid.geometry.dispose();
      this.previewHexGrid = null;
    }
    this.previewHexCells = [];
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.clear();
    this.hidePreviewLoS();
    this.modelTemplates.clear();
    this.rangeMaterial.dispose();
    this.selectionMaterial.dispose();
    this.hexMaterial.dispose();
  }
}
