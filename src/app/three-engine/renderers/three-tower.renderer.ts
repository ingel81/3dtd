import {
  Scene,
  Object3D,
  ArrowHelper,
  Mesh,
  LineLoop,
  Line,
  AnimationMixer,
  AnimationClip,
  AnimationAction,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  BufferGeometry,
  LineBasicMaterial,
  PointLight,
  Vector3,
  Float32BufferAttribute,
  DoubleSide,
  LoopPingPong,
  LoopRepeat,
  Material,
  MeshStandardMaterial,
  CircleGeometry,
  Group,
  Frustum,
  Matrix4,
  Camera,
  Sphere,
} from 'three';
import type { ColumnSample } from '../column-sample';
import { CoordinateSync } from './index';
import { TowerTypeConfig, TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { AssetManagerService } from '../../services/infrastructure/asset-manager.service';
import { METERS_PER_DEGREE_LAT, DEG_TO_RAD } from '../../utils/geo-utils';

/**
 * Tower render data - stored per tower
 */
export interface TowerRenderData {
  id: string;
  mesh: Object3D;
  turretPart: Object3D | null; // Rotating turret part (e.g., turret_top)
  aimArrow: ArrowHelper | null; // Debug arrow showing aim direction
  rangeIndicator: Mesh | null;
  selectionRing: Mesh | null;
  tipMarker: Mesh | null; // Debug marker showing LoS origin point
  losRing: LineLoop | null; // Debug ring showing LOS origin circle
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
  turretOriginalRotationY: number; // Original rotation from model (for reset)
  // Turret hover animation (e.g., magic tower orb)
  turretBaseY: number; // Original Y position of turret part
  hoverPhaseOffset: number; // Random phase offset for desynchronized hover
  hasTarget: boolean; // Whether tower is currently targeting an enemy
  // Scan animation after placement (turret looks left-right-center)
  scanPhase: number; // 0=inactive, 1=going left, 2=going right, 3=returning to center
  scanStartRotation: number; // Rotation at start of scan
  scanDelayRemaining: number; // Delay before scan starts (ms)
  // GLTF animation support
  mixer: AnimationMixer | null;
  animations: Map<string, AnimationClip>;
  currentAction: AnimationAction | null;
}

/**
 * Function type for terrain height sampling (geo coordinates)
 * @deprecated Use TerrainRaycaster instead for accurate terrain-conforming meshes
 */
export type TerrainHeightSampler = (lat: number, lon: number) => number | null;

/**
 * Function type for direct terrain raycasting at local coordinates.
 * More accurate than TerrainHeightSampler — uses actual mesh intersection.
 */
export type TerrainRaycaster = (localX: number, localZ: number) => number | null;

/**
 * Vertical terrain probe: ground plus the tile LOD it came from. Injected
 * into the route-cell grid, which uses the LOD for quality-versioned
 * idempotency so a coarse streaming pass cannot overwrite a finer sample.
 */
export type ColumnSampler = (localX: number, localZ: number) => ColumnSample | null;

/**
 * Cheap LOD-probe at a local (x,z) position WITHOUT raycasting. Returns the
 * best (deepest depth / lowest geometric error) tile that horizontally
 * contains (x,z), based on the persistent tile-info map. Used by
 * `sampleCellY` to skip stable cells whose tile LOD has NOT improved since
 * the last sample — eliminates the per-cell raycast in the full-sweep
 * triggered by `updateTerrainHeights`.
 */
export type TerrainPeekLOD = (localX: number, localZ: number) => { depth: number; geometricError: number } | null;

/**
 * Function type for Line-of-Sight raycasting between two 3D points
 * Returns true if line of sight is BLOCKED (ray hits something before target)
 */
export type LineOfSightRaycaster = (
  originX: number, originY: number, originZ: number,
  targetX: number, targetY: number, targetZ: number
) => boolean;

/**
 * ThreeTowerRenderer - Renders towers using Three.js
 *
 * Features:
 * - GLB model loading with caching
 * - Range indicator (circle on ground)
 * - Selection highlight ring
 */
export class ThreeTowerRenderer {
  private scene: Scene;
  private sync: CoordinateSync;
  private assetManager: AssetManagerService;

  // Loaded model URLs for reference counting
  private loadedModelUrls = new Set<string>();

  // Active tower renders
  private towers = new Map<string, TowerRenderData>();

  // Shared materials and geometry
  private rangeMaterial: MeshBasicMaterial;

  // Static shared selection ring geometry + material (created once, reused across all instances)
  private static sharedSelectionMaterial: MeshBasicMaterial | null = null;
  private static sharedSelectionGeometry: RingGeometry | null = null;
  private static sharedRefCount = 0;

  // Muzzle flash (pooled - single reusable light)
  private muzzleFlashLight: PointLight | null = null;
  private muzzleFlashTimer: ReturnType<typeof setTimeout> | null = null;

  // Terrain height sampler (optional - for terrain-conforming range indicators)
  private terrainHeightSampler: TerrainHeightSampler | null = null;

  // Direct terrain raycaster for accurate terrain-conforming meshes
  private terrainRaycaster: TerrainRaycaster | null = null;

  // Line-of-Sight raycaster for visibility checks
  private losRaycaster: LineOfSightRaycaster | null = null;

  // Debug mode - shows LOS rings and aim arrows for all towers
  private debugMode = false;

  // Show shoot height mode - shows tip markers (magenta spheres) for all towers
  private showShootHeight = false;

  // Animation time accumulator for frame-independent animations
  private animationTime = 0;
  /** Reused scratch for the debug aim-arrow direction (avoids per-frame alloc). */
  private readonly _aimDir = new Vector3();
  private frustum = new Frustum();
  private projScreenMatrix = new Matrix4();
  private boundingSphere = new Sphere();
  private _animFrameCount = 0;

  // Configuration for terrain-conforming range indicator
  private readonly RANGE_SEGMENTS = 48; // Number of segments around the circle
  private readonly RANGE_RINGS = 8; // Number of concentric rings

  // LOS offset configuration - raycast starts from tower edge, not center
  private readonly LOS_OFFSET_MIN = 2.4; // Offset in meters from tower center

  constructor(scene: Scene, sync: CoordinateSync, assetManager: AssetManagerService) {
    this.scene = scene;
    this.sync = sync;
    this.assetManager = assetManager;

    // Range indicator material (invisible - hex cells show visibility now)
    this.rangeMaterial = new MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0, // Hidden - green/red hex hatching shows visibility instead
      side: DoubleSide,
      depthWrite: false,
      depthTest: false,
    });

    // Static shared selection ring geometry + material (created once, reused across all instances)
    if (!ThreeTowerRenderer.sharedSelectionMaterial) {
      ThreeTowerRenderer.sharedSelectionMaterial = new MeshBasicMaterial({
        color: 0xc9a44c, // TD gold from design system
        transparent: true,
        opacity: 0.85,
        side: DoubleSide,
        depthWrite: false,
        depthTest: false, // Always render on top
      });
    }
    if (!ThreeTowerRenderer.sharedSelectionGeometry) {
      ThreeTowerRenderer.sharedSelectionGeometry = new RingGeometry(8, 12, 48);
    }
    ThreeTowerRenderer.sharedRefCount++;
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
   * Make tower model brighter by increasing emissive intensity
   * Used to enhance visibility of darker models like the rocket tower
   */
  private makeTowerBrighter(model: Object3D, intensityFactor = 2.0): void {
    model.traverse((child) => {
      if ((child as Mesh).isMesh) {
        const mesh = child as Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

        materials.forEach((mat) => {
          const stdMat = mat as MeshStandardMaterial;
          if (stdMat.color) {
            // Increase emissive intensity for better visibility
            if ('emissive' in stdMat) {
              stdMat.emissive = stdMat.color.clone();
              stdMat.emissiveIntensity = intensityFactor;
            }
            // Also brighten the base color slightly
            stdMat.color.multiplyScalar(1.3);
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

    // Skip if already loaded
    if (this.loadedModelUrls.has(config.modelUrl)) {
      return;
    }

    try {
      const cachedModel = await this.assetManager.loadModel(config.modelUrl);
      this.loadedModelUrls.add(config.modelUrl);

      if (cachedModel.animations.length > 0) {
        console.log(`[ThreeTowerRenderer] Loaded ${typeId} with ${cachedModel.animations.length} animation(s): ${cachedModel.animations.map(a => a.name).join(', ')}`);
      }
    } catch (err) {
      console.error(`[ThreeTowerRenderer] Failed to load model: ${typeId}`, err);
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

    // Load model via AssetManager (cached)
    let cachedModel;
    try {
      cachedModel = await this.assetManager.loadModel(config.modelUrl);
      this.loadedModelUrls.add(config.modelUrl);
    } catch (err) {
      console.error(`[ThreeTowerRenderer] Failed to load model: ${typeId}`, err);
      return null;
    }

    // Clone the model
    const mesh = this.assetManager.cloneModel(config.modelUrl);
    if (!mesh) {
      console.error(`[ThreeTowerRenderer] Failed to clone model: ${typeId}`);
      return null;
    }

    // Apply FBX materials if needed
    if (this.assetManager.isFbxModel(config.modelUrl)) {
      this.assetManager.applyFbxMaterials(mesh);
    }
    mesh.scale.setScalar(config.scale);

    // Apply rotation: custom rotation + config rotation
    const baseRotation = config.rotationY ?? 0;
    mesh.rotation.y = baseRotation + customRotation;

    // Find turret part if it exists (for turret rotation)
    // Supports 'turret_top', 'tower_top', and 'top' naming conventions
    let turretPart: Object3D | null = null;
    let turretBaseY = 0;
    let turretOriginalRotationY = 0; // Preserve model's original turret rotation
    mesh.traverse((node) => {
      if ((node.name === 'turret_top' || node.name === 'tower_top' || node.name === 'top') && !turretPart) {
        turretPart = node;
        turretBaseY = node.position.y;
        turretOriginalRotationY = node.rotation.y;
      }
    });
    // (Diagnostic removed — fires on every tower placement for types without
    // a named turret part, which was flooding the console during training.)

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

    // Create selection ring at terrain level (shared geometry + material)
    const selectionRing = new Mesh(ThreeTowerRenderer.sharedSelectionGeometry!, ThreeTowerRenderer.sharedSelectionMaterial!);
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

    // Create tip marker (magenta sphere showing projectile origin point)
    const tipMarkerGeometry = new SphereGeometry(2, 16, 16);
    const tipMarkerMaterial = new MeshBasicMaterial({
      color: 0xff00ff, // Magenta
      transparent: true,
      opacity: 0.5, // Semi-transparent so tower is visible
      depthTest: false, // Always visible, even inside tower mesh
    });
    const tipMarker = new Mesh(tipMarkerGeometry, tipMarkerMaterial);
    tipMarker.position.set(terrainPos.x, tipY, terrainPos.z);
    tipMarker.renderOrder = 999; // Render on top
    tipMarker.visible = this.showShootHeight; // Controlled by "Show Shoot Height" option
    this.scene.add(tipMarker);

    // Create LOS ring (cyan circle showing where LOS raycasts originate)
    // Skip for pure air towers
    let losRing: LineLoop | null = null;
    if (!isPureAirTower) {
      const losOffset = this.LOS_OFFSET_MIN;
      const losRingPoints: Vector3[] = [];
      const losRingSegments = 32;
      for (let i = 0; i <= losRingSegments; i++) {
        const angle = (i / losRingSegments) * Math.PI * 2;
        losRingPoints.push(new Vector3(
          Math.cos(angle) * losOffset,
          0,
          Math.sin(angle) * losOffset
        ));
      }
      const losRingGeometry = new BufferGeometry().setFromPoints(losRingPoints);
      const losRingMaterial = new LineBasicMaterial({
        color: 0x00ffff, // Cyan
        depthTest: false,
      });
      losRing = new LineLoop(losRingGeometry, losRingMaterial);
      losRing.position.set(terrainPos.x, tipY, terrainPos.z);
      losRing.renderOrder = 999;
      losRing.visible = this.debugMode;
      this.scene.add(losRing);
    }

    // Create aim direction arrow for turrets (debug visualization)
    // DISABLED: Causing NaN errors in render loop
    const aimArrow: ArrowHelper | null = null;
    // if (turretPart) {
    //   const arrowDir = new Vector3(0, 0, -1);
    //   const arrowOrigin = new Vector3(terrainPos.x, tipY, terrainPos.z);
    //   const arrowLength = 15;
    //   const arrowColor = 0x00ff00;
    //   aimArrow = new ArrowHelper(arrowDir, arrowOrigin, arrowLength, arrowColor, 3, 2);
    //   aimArrow.visible = this.debugMode;
    //   this.scene.add(aimArrow);
    // }

    // Setup animation mixer if model has animations AND config allows it
    let mixer: AnimationMixer | null = null;
    const animations = new Map<string, AnimationClip>();
    let currentAction: AnimationAction | null = null;

    if (config.hasAnimations && cachedModel.animations && cachedModel.animations.length > 0) {
      mixer = new AnimationMixer(mesh);
      for (const clip of cachedModel.animations) {
        animations.set(clip.name, clip);
      }

      // Auto-play first animation (typically the idle/base animation)
      const firstClip = cachedModel.animations[0];
      if (firstClip) {
        const action = mixer.clipAction(firstClip);
        // Use PingPong for smooth back-and-forth animation if configured
        if (config.animationPingPong) {
          action.setLoop(LoopPingPong, Infinity);
        } else {
          action.setLoop(LoopRepeat, Infinity);
        }
        action.play();
        currentAction = action;
      }
    }

    const renderData: TowerRenderData = {
      id,
      mesh,
      turretPart,
      aimArrow,
      rangeIndicator,
      selectionRing,
      tipMarker,
      losRing,
      typeConfig: config,
      isSelected: false,
      lat,
      lon,
      height,
      tipY,
      customRotation,
      currentLocalRotation: turretOriginalRotationY, // Start at model's original rotation
      targetLocalRotation: turretOriginalRotationY, // Target at model's original rotation
      turretOriginalRotationY, // Store for reset
      turretBaseY, // Store original Y for hover animation
      hoverPhaseOffset: Math.random() * Math.PI * 2, // Random start phase
      hasTarget: false, // Start without target
      // Start scan animation if tower has a turret (with short delay)
      scanPhase: turretPart ? 1 : 0, // 1 = start scanning left
      scanStartRotation: turretOriginalRotationY,
      scanDelayRemaining: turretPart ? 800 : 0, // 800ms delay before scan starts
      mixer,
      animations,
      currentAction,
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
   * Apply debug overrides to all towers of a specific type.
   * Updates scale, position (heightOffset), tipMarker (shootHeight), and base rotation.
   */
  applyDebugOverrides(
    typeId: TowerTypeId,
    overrides: { scale: number; heightOffset: number; shootHeight: number; rotationY: number }
  ): void {
    for (const data of this.towers.values()) {
      if (data.typeConfig.id !== typeId) continue;

      // Update scale
      data.mesh.scale.setScalar(overrides.scale);

      // Update position (heightOffset)
      const terrainPos = this.sync.geoToLocal(data.lat, data.lon, data.height);
      data.mesh.position.set(
        terrainPos.x,
        terrainPos.y + overrides.heightOffset,
        terrainPos.z
      );

      // Update base rotation (preserving custom rotation)
      data.mesh.rotation.y = overrides.rotationY + data.customRotation;

      // Update tipY and tipMarker position (shootHeight)
      const newTipY = terrainPos.y + overrides.heightOffset + overrides.shootHeight;
      data.tipY = newTipY;

      if (data.tipMarker) {
        data.tipMarker.position.set(terrainPos.x, newTipY, terrainPos.z);
      }

      if (data.losRing) {
        data.losRing.position.set(terrainPos.x, newTipY, terrainPos.z);
      }
    }
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

    // Turret barrel offset: compensates for models where barrels don't point -Z
    // For dual-gatling: barrels point +X in model space, so turretBarrelOffset = -π/2
    // Most towers have barrels pointing -Z, so turretBarrelOffset = 0 (default)
    const turretBarrelOffset = data.typeConfig.turretBarrelOffset ?? 0;
    const turretModelOffset = -turretBarrelOffset;

    // Convert geo heading to Three.js target rotation for the turret
    // geoHeading 0 = North = -Z = Three.js rotation 0
    // But if model barrels are offset, add that offset
    const threeJsTargetRotation = -heading + turretModelOffset;

    // Parent mesh rotation (includes config.rotationY + customRotation)
    const parentRotation = data.mesh.rotation.y;

    // Convert to local space: subtract parent's rotation
    // Set as target - actual rotation is interpolated in updateTurretAnimations()
    data.targetLocalRotation = threeJsTargetRotation - parentRotation;
    data.hasTarget = true;
  }

  /**
   * Reset turret rotation to base position (facing forward relative to tower base)
   * Called when tower has no targets in range - sets target for smooth return animation
   */
  resetRotation(id: string): void {
    const data = this.towers.get(id);
    if (!data || !data.turretPart) return;

    // Set target to original model rotation (turret returns to default pose)
    // Actual rotation is interpolated in updateTurretAnimations()
    data.targetLocalRotation = data.turretOriginalRotationY;
    data.hasTarget = false;
  }

  /**
   * Select tower (show range indicator and selection ring)
   * Note: LOS visualization is now handled by GlobalRouteGrid
   */
  select(id: string): void {
    const data = this.towers.get(id);
    if (!data) return;

    data.isSelected = true;
    if (data.rangeIndicator) data.rangeIndicator.visible = true;
    if (data.selectionRing) data.selectionRing.visible = true;
    if (data.tipMarker) data.tipMarker.visible = this.showShootHeight;
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
    // Keep debug markers visible when enabled
    if (data.tipMarker) data.tipMarker.visible = this.showShootHeight;
    if (data.losRing) data.losRing.visible = this.debugMode;
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
   * Set debug mode - shows LOS rings and aim arrows for all towers
   * (Raycast lines removed - visualization is now via routeLosViz)
   */
  setDebugMode(enabled: boolean): void {
    this.debugMode = enabled;

    for (const data of this.towers.values()) {
      if (data.losRing) {
        data.losRing.visible = enabled;
      }
      if (data.aimArrow) {
        data.aimArrow.visible = enabled;
      }
    }
  }

  /**
   * Set show shoot height mode - shows tip markers (magenta spheres) for all towers
   * Controlled by Tower Debug Panel's "Show Shoot Height" checkbox
   */
  setShowShootHeight(enabled: boolean): void {
    this.showShootHeight = enabled;

    for (const data of this.towers.values()) {
      if (data.tipMarker) {
        data.tipMarker.visible = enabled;
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

    // Remove selection ring (geometry and material are shared — do NOT dispose)
    if (data.selectionRing) {
      this.scene.remove(data.selectionRing);
    }

    // Remove tip marker
    if (data.tipMarker) {
      this.scene.remove(data.tipMarker);
      data.tipMarker.geometry.dispose();
      (data.tipMarker.material as Material).dispose();
    }

    // Remove LOS ring
    if (data.losRing) {
      this.scene.remove(data.losRing);
      data.losRing.geometry.dispose();
      (data.losRing.material as Material).dispose();
    }

    // Remove aim arrow
    if (data.aimArrow) {
      this.scene.remove(data.aimArrow);
      data.aimArrow.dispose();
    }

    // Clean up animation mixer
    if (data.mixer) {
      data.mixer.stopAllAction();
      for (const clip of data.animations.values()) {
        data.mixer.uncacheClip(clip);
      }
      data.mixer.uncacheRoot(data.mesh);
    }
    data.animations.clear();
    data.currentAction = null;

    this.towers.delete(id);
  }

  /**
   * Visual update — once per RENDER frame. Drives selection-ring pulse,
   * magic-idle spin, and GLTF mixer (LOD). NO gameplay-affecting state here:
   * turret aim now flows through `advanceTurretAim()` which is called per
   * sub-step in game-time.
   */
  updateAnimations(deltaTime: number, camera: Camera): void {
    this.animationTime += deltaTime * 0.001;
    this._animFrameCount++;

    const deltaSeconds = deltaTime * 0.001;

    // Frustum for culling GLTF animations
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    for (const data of this.towers.values()) {
      // GLTF mixer LOD (visual only)
      if (data.mixer) {
        this.boundingSphere.center.copy(data.mesh.position);
        this.boundingSphere.radius = 3;
        if (this.frustum.intersectsSphere(this.boundingSphere)) {
          const distSq = data.mesh.position.distanceToSquared(camera.position);
          if (distSq > 40000) {
            // >200m: skip
          } else if (distSq > 10000) {
            if (this._animFrameCount % 4 === 0) data.mixer.update(deltaSeconds * 4);
          } else if (distSq > 2500) {
            if (this._animFrameCount % 2 === 0) data.mixer.update(deltaSeconds * 2);
          } else {
            data.mixer.update(deltaSeconds);
          }
        }
      }

      // Selection ring (visual)
      if (data.isSelected && data.selectionRing) {
        const scale = 1 + Math.sin(this.animationTime) * 0.1;
        data.selectionRing.scale.setScalar(scale);
        data.selectionRing.rotation.z += deltaTime * 0.001;
      }

      // Magic-tower idle spin (visual)
      if (
        data.turretPart &&
        data.typeConfig.id === 'magic' &&
        !data.hasTarget &&
        data.scanPhase === 0
      ) {
        const idleRotationSpeed = 0.3; // rad/s wall-clock — purely cosmetic
        data.currentLocalRotation += idleRotationSpeed * (deltaTime / 1000);
        data.turretPart.rotation.y = data.currentLocalRotation;
      }
    }

    // Visual-only per-render-frame extras (magic hover, debug arrow)
    this.updateTurretVisuals();
  }

  /**
   * Gameplay-affecting turret aim — called per sub-step in game-time.
   * Rotation speed is a constant ~PI rad/s game-time, so combat alignment
   * advances at the same rate at every training timescale (sub-stepping
   * provides the "more ticks per real-frame" at high speeds).
   */
  advanceTurretAim(gameTimeStepMs: number): void {
    const turretRotationSpeed = Math.PI; // rad/s game-time
    const maxRotationThisStep = turretRotationSpeed * (gameTimeStepMs / 1000);

    for (const data of this.towers.values()) {
      if (!data.turretPart) continue;

      // Cancel scan if tower acquires a target
      if (data.scanPhase > 0 && data.hasTarget) {
        data.scanPhase = 0;
        data.scanDelayRemaining = 0;
      }

      // Tick scan delay in game-time
      if (data.scanDelayRemaining > 0) {
        data.scanDelayRemaining -= gameTimeStepMs;
      }

      const scanAngle = 1.309; // 75° in radians
      if (data.scanPhase > 0 && !data.hasTarget && data.scanDelayRemaining <= 0) {
        let scanTarget: number;
        if (data.scanPhase === 1) {
          scanTarget = data.scanStartRotation - scanAngle;
        } else if (data.scanPhase === 2) {
          scanTarget = data.scanStartRotation + scanAngle;
        } else {
          scanTarget = data.turretOriginalRotationY;
        }
        let diff = scanTarget - data.currentLocalRotation;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < 0.02) {
          data.currentLocalRotation = scanTarget;
          data.scanPhase++;
          if (data.scanPhase > 3) data.scanPhase = 0;
        } else {
          const scanSpeed = maxRotationThisStep * 0.7;
          const rotation = Math.sign(diff) * Math.min(Math.abs(diff), scanSpeed);
          data.currentLocalRotation += rotation;
        }
        data.turretPart.rotation.y = data.currentLocalRotation;
      } else if (
        data.scanPhase === 0 &&
        // skip magic-idle (handled in render-frame visual update)
        !(data.typeConfig.id === 'magic' && !data.hasTarget)
      ) {
        const current = data.currentLocalRotation;
        const target = data.targetLocalRotation;
        let diff = target - current;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) < 0.01) {
          data.currentLocalRotation = target;
        } else {
          const rotation = Math.sign(diff) * Math.min(Math.abs(diff), maxRotationThisStep);
          data.currentLocalRotation += rotation;
        }
        data.turretPart.rotation.y = data.currentLocalRotation;
      }
    }
  }

  /** Visual-only per-render-frame extras: magic hover + debug aim arrow. */
  updateTurretVisuals(): void {
    for (const data of this.towers.values()) {
      if (!data.turretPart) continue;

      // Magic tower orb: hover animation (always active, purely visual)
      if (data.typeConfig.id === 'magic') {
        const hoverAmplitude = 0.006;
        const hoverSpeed = 0.6;
        const phase = this.animationTime * hoverSpeed * Math.PI * 2 + data.hoverPhaseOffset;
        data.turretPart.position.y = data.turretBaseY + Math.sin(phase) * hoverAmplitude;
      }

      // Debug aim arrow (world-space direction)
      if (data.aimArrow) {
        const parentRotation = data.mesh.rotation.y;
        const worldRot = data.currentLocalRotation + parentRotation;
        const dir = this._aimDir.set(Math.sin(worldRot), 0, Math.cos(worldRot));
        data.aimArrow.setDirection(dir);
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
  getAllMeshes(): { id: string; mesh: Object3D }[] {
    const result: { id: string; mesh: Object3D }[] = [];
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
    localCenter: Vector3
  ): Mesh {
    // If no raycaster available, use simple flat circle with edge
    if (!this.terrainRaycaster) {
      const group = new Group() as unknown as Mesh;

      // Filled disc
      const discGeometry = new CircleGeometry(range, this.RANGE_SEGMENTS);
      const discMesh = new Mesh(discGeometry, this.rangeMaterial);
      discMesh.rotation.x = -Math.PI / 2;
      group.add(discMesh);

      // Edge ring (gold border)
      const edgeGeometry = new RingGeometry(range - 2, range, this.RANGE_SEGMENTS);
      const edgeMaterial = new MeshBasicMaterial({
        color: 0xc9a44c, // TD gold
        transparent: true,
        opacity: 0.7,
        side: DoubleSide,
        depthWrite: false,
      });
      const edgeMesh = new Mesh(edgeGeometry, edgeMaterial);
      edgeMesh.rotation.x = -Math.PI / 2;
      edgeMesh.position.y = 0.1; // Slightly above disc
      group.add(edgeMesh);

      group.position.copy(localCenter);
      group.position.y += 0.5;
      return group;
    }

    // Create terrain-conforming group with disc and edge rings using raycasting
    const group = new Group() as unknown as Mesh;

    // Create terrain-conforming disc geometry using direct raycasts
    const geometry = this.createTerrainDiscGeometryRaycast(localCenter.x, localCenter.z, range);

    const discMesh = new Mesh(geometry, this.rangeMaterial);
    discMesh.renderOrder = 1;
    group.add(discMesh);

    // Create terrain-following edge rings using raycasting
    const edgePoints = this.createTerrainEdgePointsRaycast(localCenter.x, localCenter.z, range);

    if (edgePoints.length > 0) {
      // Gold edge at the range boundary
      const edgeGeometry = new BufferGeometry().setFromPoints([...edgePoints, edgePoints[0]]);
      const edgeMaterial = new LineBasicMaterial({
        color: 0xc9a44c, // TD gold
        linewidth: 2,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      });
      const edgeLine = new Line(edgeGeometry, edgeMaterial);
      edgeLine.renderOrder = 2;
      group.add(edgeLine);
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
    localCenter: Vector3
  ): Vector3[] {
    if (!this.terrainHeightSampler) return [];

    const EDGE_OFFSET = 2.0; // Slightly higher than disc for visibility

    const points: Vector3[] = [];
    const metersPerDegreeLat = METERS_PER_DEGREE_LAT;
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(centerLat * DEG_TO_RAD);

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

      points.push(new Vector3(worldX, worldY, worldZ));
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
    localCenter: Vector3
  ): BufferGeometry {
    if (!this.terrainHeightSampler) {
      return new CircleGeometry(range, this.RANGE_SEGMENTS);
    }

    const vertices: number[] = [];
    const indices: number[] = [];

    // Small offset above terrain for visibility
    const TERRAIN_OFFSET = 1.5;

    // Meters per degree (approximate at this latitude)
    const metersPerDegreeLat = METERS_PER_DEGREE_LAT;
    const metersPerDegreeLon = METERS_PER_DEGREE_LAT * Math.cos(centerLat * DEG_TO_RAD);

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

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
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
  ): Vector3[] {
    if (!this.terrainRaycaster) return [];

    const EDGE_OFFSET = 2.0; // Height above terrain for visibility
    const points: Vector3[] = [];

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
        points.push(new Vector3(worldX, terrainY + EDGE_OFFSET, worldZ));
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
  ): BufferGeometry {
    if (!this.terrainRaycaster) {
      return new CircleGeometry(range, this.RANGE_SEGMENTS);
    }

    const vertices: number[] = [];
    const indices: number[] = [];

    // Small offset above terrain for visibility
    const TERRAIN_OFFSET = 1.5;

    // Get center terrain height via raycast
    const centerY = this.terrainRaycaster(centerX, centerZ);
    if (centerY === null) {
      // Fallback to flat circle if center raycast fails
      return new CircleGeometry(range, this.RANGE_SEGMENTS);
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

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Rebuild the range indicator (filled disc + gold edge ring) for this
   * tower. Call when the tower's effective range changes (range upgrade)
   * or when terrain data has changed under the disc. Pass `range` to use
   * the current runtime range; without it, the base config range is used.
   *
   * The indicator is a Group of two child meshes/lines, so we can't
   * just swap one geometry — we tear it down and rebuild via
   * createRangeIndicator() to keep the construction logic in one place.
   */
  updateRangeIndicatorTerrain(id: string, range?: number): void {
    const data = this.towers.get(id);
    if (!data || !data.rangeIndicator) return;

    const wasVisible = data.rangeIndicator.visible;
    const effectiveRange = range ?? data.typeConfig.range;
    const terrainPos = this.sync.geoToLocal(data.lat, data.lon, data.height);

    this.scene.remove(data.rangeIndicator);
    this.disposeObject(data.rangeIndicator);

    const fresh = this.createRangeIndicator(
      data.lat,
      data.lon,
      data.height,
      effectiveRange,
      terrainPos
    );
    fresh.visible = wasVisible;
    this.scene.add(fresh);
    data.rangeIndicator = fresh;
  }

  /**
   * Check if there's line of sight from a tower to a specific position
   * Uses runtime raycast (GlobalRouteGrid handles pre-computed LOS)
   */
  hasLineOfSight(towerId: string, targetX: number, targetY: number, targetZ: number): boolean {
    const data = this.towers.get(towerId);
    if (!data) return true; // Assume clear if can't check

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
   * Trigger muzzle flash at tower's shoot position
   * Creates a brief bright point light + small sprite flash
   */
  triggerMuzzleFlash(towerId: string): void {
    const data = this.towers.get(towerId);
    if (!data) return;

    const terrainPos = this.sync.geoToLocal(data.lat, data.lon, data.height);

    // Reuse or create the pooled PointLight
    if (!this.muzzleFlashLight) {
      this.muzzleFlashLight = new PointLight(0xffaa44, 3, 30);
    }

    // Position at tower tip
    this.muzzleFlashLight.position.set(terrainPos.x, data.tipY, terrainPos.z);
    this.scene.add(this.muzzleFlashLight);

    // Clear any existing timer
    if (this.muzzleFlashTimer) {
      clearTimeout(this.muzzleFlashTimer);
    }

    // Remove after 50ms
    this.muzzleFlashTimer = setTimeout(() => {
      if (this.muzzleFlashLight) {
        this.scene.remove(this.muzzleFlashLight);
      }
      this.muzzleFlashTimer = null;
    }, 50);
  }

  /**
   * Recursively dispose Three.js object
   */
  private disposeObject(obj: Object3D): void {
    obj.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      if (mesh.material) {
        const materials: Material[] = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        for (const mat of materials) {
          const stdMat = mat as MeshStandardMaterial;
          // Dispose all possible texture maps
          if (stdMat.map) stdMat.map.dispose();
          if (stdMat.normalMap) stdMat.normalMap.dispose();
          if (stdMat.roughnessMap) stdMat.roughnessMap.dispose();
          if (stdMat.metalnessMap) stdMat.metalnessMap.dispose();
          if (stdMat.emissiveMap) stdMat.emissiveMap.dispose();
          if (stdMat.aoMap) stdMat.aoMap.dispose();
          mat.dispose();
        }
      }
    });
  }

  /**
   * Dispose all resources including shared materials and model templates
   */
  dispose(): void {
    // Remove and dispose all individual tower renders
    this.clear();

    // Release model references from AssetManager (decrements ref counts, disposes at 0)
    for (const url of this.loadedModelUrls) {
      this.assetManager.releaseModel(url);
    }
    this.loadedModelUrls.clear();

    // Dispose shared geometry and materials
    this.rangeMaterial.dispose();

    // Only dispose static selection resources when last instance is destroyed
    ThreeTowerRenderer.sharedRefCount--;
    if (ThreeTowerRenderer.sharedRefCount <= 0) {
      ThreeTowerRenderer.sharedSelectionGeometry?.dispose();
      ThreeTowerRenderer.sharedSelectionGeometry = null;
      ThreeTowerRenderer.sharedSelectionMaterial?.dispose();
      ThreeTowerRenderer.sharedSelectionMaterial = null;
      ThreeTowerRenderer.sharedRefCount = 0;
    }

    // Clean up muzzle flash
    if (this.muzzleFlashTimer) {
      clearTimeout(this.muzzleFlashTimer);
      this.muzzleFlashTimer = null;
    }
    if (this.muzzleFlashLight) {
      this.scene.remove(this.muzzleFlashLight);
      this.muzzleFlashLight.dispose();
      this.muzzleFlashLight = null;
    }

    // Clear map reference to allow GC
    this.towers.clear();
  }
}
