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
  Vector3,
  Float32BufferAttribute,
  DoubleSide,
  LoopPingPong,
  LoopRepeat,
  Material,
  MeshStandardMaterial,
  CircleGeometry,
  Group,
} from 'three';
import { CoordinateSync } from './index';
import { TowerTypeConfig, TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { AssetManagerService } from '../../services/asset-manager.service';

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
  // Turret hover animation (e.g., magic tower orb)
  turretBaseY: number; // Original Y position of turret part
  hoverPhaseOffset: number; // Random phase offset for desynchronized hover
  hasTarget: boolean; // Whether tower is currently targeting an enemy
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

  // Shared materials
  private rangeMaterial: MeshBasicMaterial;
  private selectionMaterial: MeshBasicMaterial;

  // Terrain height sampler (optional - for terrain-conforming range indicators)
  private terrainHeightSampler: TerrainHeightSampler | null = null;

  // Direct terrain raycaster for accurate terrain-conforming meshes
  private terrainRaycaster: TerrainRaycaster | null = null;

  // Line-of-Sight raycaster for visibility checks
  private losRaycaster: LineOfSightRaycaster | null = null;

  // Debug mode - shows tip markers for all towers
  private debugMode = false;

  // Animation time accumulator for frame-independent animations
  private animationTime = 0;

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

    // Selection ring material (gold for WC3 style, high visibility)
    this.selectionMaterial = new MeshBasicMaterial({
      color: 0xc9a44c, // TD gold from design system
      transparent: true,
      opacity: 0.85,
      side: DoubleSide,
      depthWrite: false,
      depthTest: false, // Always render on top
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
   * Get Line-of-Sight raycaster (for GlobalRouteGrid registration)
   */
  getLosRaycaster(): LineOfSightRaycaster | null {
    return this.losRaycaster;
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
    mesh.traverse((node) => {
      if ((node.name === 'turret_top' || node.name === 'tower_top' || node.name === 'top') && !turretPart) {
        turretPart = node;
        turretBaseY = node.position.y;
        console.log(`[TowerRenderer] Found turret part '${node.name}' for ${typeId}, baseY: ${turretBaseY}`);
      }
    });
    // Debug: list all node names if no turret found
    if (!turretPart) {
      const names: string[] = [];
      mesh.traverse((node) => names.push(node.name));
      console.log(`[TowerRenderer] No turret found for ${typeId}. Nodes:`, names);
    }

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
    const selectionGeometry = new RingGeometry(8, 12, 48);
    const selectionRing = new Mesh(selectionGeometry, this.selectionMaterial.clone());
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

    // Create tip marker (magenta sphere showing LoS origin point)
    // Skip for pure air towers
    let tipMarker: Mesh | null = null;
    if (!isPureAirTower) {
      const tipMarkerGeometry = new SphereGeometry(2, 16, 16);
      const tipMarkerMaterial = new MeshBasicMaterial({
        color: 0xff00ff, // Magenta
        depthTest: false, // Always visible, even inside tower mesh
      });
      tipMarker = new Mesh(tipMarkerGeometry, tipMarkerMaterial);
      tipMarker.position.set(terrainPos.x, tipY, terrainPos.z);
      tipMarker.renderOrder = 999; // Render on top
      tipMarker.visible = this.debugMode; // Visible in debug mode, or when tower is selected
      this.scene.add(tipMarker);
    }

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
        console.log(`[ThreeTowerRenderer] Started animation '${firstClip.name}' for tower ${id} (pingPong: ${config.animationPingPong ?? false})`);
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
      currentLocalRotation: 0, // Start at base position
      targetLocalRotation: 0, // Target at base position
      turretBaseY, // Store original Y for hover animation
      hoverPhaseOffset: Math.random() * Math.PI * 2, // Random start phase
      hasTarget: false, // Start without target
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
    data.hasTarget = true;
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
    // Keep debug markers visible in debug mode
    if (data.tipMarker) data.tipMarker.visible = this.debugMode;
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
   * Set debug mode - shows tip markers and LOS rings for all towers
   * (Raycast lines removed - visualization is now via routeLosViz)
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
        (data.selectionRing.material as Material).dispose();
      }
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
   * Update selection ring animation, turret rotations, and GLTF animations
   * Call each frame for pulse effect, smooth turret movement, and model animations
   */
  updateAnimations(deltaTime: number): void {
    // Accumulate time for frame-independent animation (in seconds)
    this.animationTime += deltaTime * 0.001;

    // Convert deltaTime from ms to seconds for animation mixer
    const deltaSeconds = deltaTime * 0.001;

    // Update GLTF animation mixers
    for (const data of this.towers.values()) {
      if (data.mixer) {
        data.mixer.update(deltaSeconds);
      }
    }

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
        // Magic tower orb: special idle behavior (continuous spin when no target)
        const isMagicIdle = data.typeConfig.id === 'magic' && !data.hasTarget;

        if (isMagicIdle) {
          // Idle spin: slow continuous rotation
          const idleRotationSpeed = 0.3; // Radians per second
          data.currentLocalRotation += idleRotationSpeed * (deltaTime / 1000);
          data.turretPart.rotation.y = data.currentLocalRotation;
        } else {
          // Normal turret behavior: interpolate towards target
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
        }

        // Magic tower orb: hover animation (always active)
        if (data.typeConfig.id === 'magic') {
          const hoverAmplitude = 0.006;
          const hoverSpeed = 0.6;
          const phase = this.animationTime * hoverSpeed * Math.PI * 2 + data.hoverPhaseOffset;
          data.turretPart.position.y = data.turretBaseY + Math.sin(phase) * hoverAmplitude;
        }

        // Update debug arrow direction (world space)
        if (data.aimArrow) {
          const parentRotation = data.mesh.rotation.y;
          const worldRot = data.currentLocalRotation + parentRotation;
          const dir = new Vector3(
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
      const discMesh = new Mesh(discGeometry, this.rangeMaterial.clone());
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

    const discMesh = new Mesh(geometry, this.rangeMaterial.clone());
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
    let newGeometry: BufferGeometry;
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

    // Release model references from AssetManager
    for (const url of this.loadedModelUrls) {
      this.assetManager.releaseModel(url);
    }
    this.loadedModelUrls.clear();

    this.rangeMaterial.dispose();
    this.selectionMaterial.dispose();
  }
}
