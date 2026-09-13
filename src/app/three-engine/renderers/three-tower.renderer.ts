import {
  Scene,
  Object3D,
  ArrowHelper,
  Mesh,
  LineLoop,
  AnimationMixer,
  AnimationClip,
  AnimationAction,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  DoubleSide,
  LoopPingPong,
  LoopRepeat,
  Material,
  MeshStandardMaterial,
  Group,
  Frustum,
  Matrix4,
  Camera,
  Sphere,
  Texture,
  WebGLRenderer,
} from 'three';
import { CoordinateSync } from './index';
import { TowerTypeConfig, TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { AssetManagerService } from '../../services/infrastructure/asset-manager.service';
import { TerrainRaycaster, createLosRing, createRangeIndicator, createTipMarker } from './tower-overlays';
import { headingToLocalRotation, stepTurretAim, turretAimError } from './tower-turret-aim';
import { TowerMuzzleFlash } from './tower-muzzle-flash';

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

  /** Tower types whose configured turretNode the model lacks, warned about once. */
  private readonly missingTurretNodes = new Set<string>();

  // Active tower renders
  private towers = new Map<string, TowerRenderData>();

  /** Tower under the pointer, shows its range like a selected one, see setHovered */
  private hoveredId: string | null = null;

  // Shared materials and geometry
  private rangeMaterial: MeshBasicMaterial;

  // Static shared selection ring geometry + material (created once, reused across all instances)
  private static sharedSelectionMaterial: MeshBasicMaterial | null = null;
  private static sharedSelectionGeometry: RingGeometry | null = null;
  private static sharedRefCount = 0;

  // Muzzle flash (pooled - single reusable light)
  private readonly muzzleFlash: TowerMuzzleFlash;

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

  // LOS offset configuration - raycast starts from tower edge, not center
  private readonly LOS_OFFSET_MIN = 2.4; // Offset in meters from tower center

  constructor(scene: Scene, sync: CoordinateSync, assetManager: AssetManagerService) {
    this.scene = scene;
    this.sync = sync;
    this.assetManager = assetManager;

    // The muzzle flash light lives in the scene for good, dark between shots
    // (see TowerMuzzleFlash).
    this.muzzleFlash = new TowerMuzzleFlash(this.scene);

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
   * Compile every tower model's shader programs and upload its textures
   * ahead of the first placement, which otherwise stalls the frame the tower
   * appears in on a synchronous compile. With KHR_parallel_shader_compile the
   * driver compiles off the main thread. Clones are built the way `create`
   * builds them; their materials share program cache keys with real towers.
   */
  async precompile(renderer: WebGLRenderer, camera: Camera): Promise<void> {
    const warm = new Group();
    const urls = new Set(Object.values(TOWER_TYPES).map((config) => config.modelUrl));
    for (const url of urls) {
      const model = this.assetManager.cloneModel(url);
      if (!model) continue;
      if (this.assetManager.isFbxModel(url)) {
        this.assetManager.applyFbxMaterials(model);
      }
      warm.add(model);
    }

    // Lights come from the real scene, so the program keys match what renders.
    await renderer.compileAsync(warm, camera, this.scene);

    warm.traverse((node) => {
      const material = (node as Mesh).material;
      if (!material) return;
      for (const m of Array.isArray(material) ? material : [material]) {
        for (const value of Object.values(m)) {
          if (value instanceof Texture) renderer.initTexture(value);
        }
      }
    });
  }

  /**
   * Create tower render - spawns mesh in scene
   * @param id Tower ID
   * @param typeId Tower type
   * @param lat Latitude
   * @param lon Longitude
   * @param height Terrain height
   * @param customRotation Custom rotation set by user during placement (radians)
   * @param initialHeading Geo heading the turret starts at (the tower's guard
   *   heading); null keeps the model's own turret pose
   */
  async create(
    id: string,
    typeId: TowerTypeId,
    lat: number,
    lon: number,
    height: number,
    customRotation = 0,
    initialHeading: number | null = null,
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

    // Find turret part if it exists (for turret rotation). A turretNode in the
    // config replaces the default names 'turret_top', 'tower_top' and 'top',
    // there is no fallback to them.
    const isTurretNode = (name: string): boolean => config.turretNode
      ? name === config.turretNode
      : name === 'turret_top' || name === 'tower_top' || name === 'top';
    let turretPart: Object3D | null = null;
    let turretBaseY = 0;
    let turretOriginalRotationY = 0; // Preserve model's original turret rotation
    mesh.traverse((node) => {
      if (isTurretNode(node.name) && !turretPart) {
        turretPart = node;
        turretBaseY = node.position.y;
        turretOriginalRotationY = node.rotation.y;
      }
    });
    // A configured node that is missing is a config error; once per type, so
    // a bot placing towers does not flood the console.
    if (config.turretNode && !turretPart && !this.missingTurretNodes.has(typeId)) {
      this.missingTurretNodes.add(typeId);
      console.warn(`[ThreeTowerRenderer] ${typeId}: turretNode '${config.turretNode}' is not in the model, the turret will not turn`);
    }
    // (Diagnostic removed — fires on every tower placement for types without
    // a named turret part, which was flooding the console during training.)

    // A new turret first makes its reference sweep around the pose it was
    // placed in (what the placement preview showed), then turns to the guard
    // heading at aiming speed. Without one it keeps the model's pose.
    const initialLocalRotation = initialHeading === null
      ? turretOriginalRotationY
      : headingToLocalRotation(config, mesh.rotation.y, initialHeading);

    // Position in local coordinates - terrain level (without height offset)
    const terrainPos = this.sync.geoToLocal(lat, lon, height);

    // Tower mesh position with height offset
    const localPos = terrainPos.clone();
    localPos.y += config.heightOffset;
    mesh.position.copy(localPos);

    // Add to scene
    this.scene.add(mesh);

    // Create range indicator at TERRAIN level (not tower level)
    const rangeIndicator = createRangeIndicator(config.range, terrainPos, this.rangeMaterial, this.terrainRaycaster);
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

    // Create tip marker (magenta sphere showing projectile origin point),
    // controlled by the "Show Shoot Height" option
    const tipMarker = createTipMarker(terrainPos.x, tipY, terrainPos.z, this.showShootHeight);
    this.scene.add(tipMarker);

    // Create LOS ring (cyan circle showing where LOS raycasts originate)
    // Skip for pure air towers
    let losRing: LineLoop | null = null;
    if (!isPureAirTower) {
      losRing = createLosRing(terrainPos.x, tipY, terrainPos.z, this.LOS_OFFSET_MIN, this.debugMode);
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
      currentLocalRotation: turretOriginalRotationY,
      targetLocalRotation: initialLocalRotation,
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
   * Aim the turret at a target. Only affects turrets (turret_top); the actual
   * rotation is interpolated in advanceTurretAim().
   */
  updateRotation(id: string, heading: number): void {
    const data = this.towers.get(id);
    if (!data || !data.turretPart) return;

    data.targetLocalRotation = headingToLocalRotation(data.typeConfig, data.mesh.rotation.y, heading);
    data.hasTarget = true;
  }

  /**
   * Turn the turret to a heading without a target (the guard heading between
   * waves), at the same speed as aiming.
   */
  setIdleHeading(id: string, heading: number): void {
    const data = this.towers.get(id);
    if (!data || !data.turretPart) return;

    data.targetLocalRotation = headingToLocalRotation(data.typeConfig, data.mesh.rotation.y, heading);
    data.hasTarget = false;
  }

  /**
   * The tower has no target any more. The turret finishes its current turn
   * and then holds that heading.
   */
  releaseTarget(id: string): void {
    const data = this.towers.get(id);
    if (!data) return;
    data.hasTarget = false;
  }

  /**
   * Show the range disc and selection ring of the tower under the pointer
   * (InputHandlerService), or of none. The selected tower keeps its own, a
   * hover only adds a second one; the LOS view stays with the selection.
   */
  setHovered(id: string | null): void {
    if (id === this.hoveredId) return;
    const previous = this.hoveredId !== null ? this.towers.get(this.hoveredId) : undefined;
    this.hoveredId = id;
    if (previous && !previous.isSelected) this.setRangeVisible(previous, false);
    const next = id !== null ? this.towers.get(id) : undefined;
    if (next) this.setRangeVisible(next, true);
  }

  private setRangeVisible(data: TowerRenderData, visible: boolean): void {
    if (data.rangeIndicator) data.rangeIndicator.visible = visible;
    if (data.selectionRing) data.selectionRing.visible = visible;
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
    // Still under the pointer: the hover keeps showing the range
    this.setRangeVisible(data, this.hoveredId === id);
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

    if (this.hoveredId === id) this.hoveredId = null;
    this.towers.delete(id);
  }

  /**
   * Visual update, once per RENDER frame. Drives the selection-ring pulse and
   * the GLTF mixer (LOD). NO gameplay-affecting state here: turret aim flows
   * through `advanceTurretAim()`, which is called per sub-step in game-time.
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

      // Selection ring (visual), also on the hovered tower
      if ((data.isSelected || data.id === this.hoveredId) && data.selectionRing) {
        const scale = 1 + Math.sin(this.animationTime) * 0.1;
        data.selectionRing.scale.setScalar(scale);
        data.selectionRing.rotation.z += deltaTime * 0.001;
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
    for (const data of this.towers.values()) {
      stepTurretAim(data, gameTimeStepMs);
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

    // Shortest angle difference
    return turretAimError(data) <= toleranceRadians;
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

    const fresh = createRangeIndicator(effectiveRange, terrainPos, this.rangeMaterial, this.terrainRaycaster);
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
   * Switch the muzzle flash light on or off (VFX setting muzzleFlash). The
   * light stays in the scene, dark as between shots: taking it out would
   * give every lit material a new shader program (see TowerMuzzleFlash).
   */
  setMuzzleFlashEnabled(enabled: boolean): void {
    this.muzzleFlash.setEnabled(enabled);
  }

  /**
   * Light the tower's shoot position with the pooled muzzle flash light for
   * 50 ms. The particles are spawned separately (ThreeEffectsRenderer).
   * Nothing while muzzle flashes are off.
   *
   * @param intensity - Light intensity, from the tower's MUZZLE_FLASH_PROFILES entry
   */
  triggerMuzzleFlash(towerId: string, intensity: number): void {
    if (!this.muzzleFlash.isEnabled) return;
    const data = this.towers.get(towerId);
    if (!data) return;

    const terrainPos = this.sync.geoToLocal(data.lat, data.lon, data.height);
    this.muzzleFlash.flash(terrainPos.x, data.tipY, terrainPos.z, intensity);
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
    this.muzzleFlash.dispose();

    // Clear map reference to allow GC
    this.towers.clear();
  }
}
