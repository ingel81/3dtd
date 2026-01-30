import {
  Scene,
  Object3D,
  AnimationMixer,
  AnimationClip,
  AnimationAction,
  Sprite,
  Mesh,
  MeshStandardMaterial,
  MeshBasicMaterial,
  SRGBColorSpace,
  Color,
  LoopRepeat,
  LoopOnce,
  SpriteMaterial,
  CanvasTexture,
  Material,
  Camera,
  Frustum,
  Matrix4,
  Texture,
} from 'three';
import { CoordinateSync } from './index';
import { EnemyTypeConfig, ENEMY_TYPES, EnemyTypeId } from '../../models/enemy-types';
import { AssetManagerService } from '../../services/asset-manager.service';

/**
 * Debug overrides for enemy visual properties
 */
export interface EnemyDebugOverrides {
  scale?: number;
  heightOffset?: number;
  healthBarOffset?: number;
  rotation?: number; // Y rotation in radians
  animationSpeed?: number; // Direct timeScale override
}

/**
 * Enemy render data - stored per enemy
 */
export interface EnemyRenderData {
  id: string;
  mesh: Object3D;
  mixer: AnimationMixer | null;
  animations: Map<string, AnimationClip>;
  currentAction: AnimationAction | null;
  healthBar: Sprite | null;
  healthBarBucket: number; // Cached bucket (0-100 in 10% steps) to avoid unnecessary updates
  typeConfig: EnemyTypeConfig;
  isDestroyed: boolean;
  // Animation variation
  isWalking: boolean; // true = Walk, false = Run
  animationVariationTimer: ReturnType<typeof setTimeout> | null;
  // Debug overrides (optional)
  debugOverrides?: EnemyDebugOverrides;
  // Last known movement heading (for debug rotation offset)
  lastHeading: number;
}

/**
 * ThreeEnemyRenderer - Renders enemies using Three.js
 *
 * For animated models (zombies), we clone SkinnedMesh per entity.
 * For non-animated models (tanks), we could use instancing in the future.
 *
 * Health bars are rendered as sprites above each enemy.
 */
export class ThreeEnemyRenderer {
  private scene: Scene;
  private sync: CoordinateSync;
  private assetManager: AssetManagerService;

  // Loaded model URLs for reference counting
  private loadedModelUrls = new Set<string>();

  // Active enemy renders
  private enemies = new Map<string, EnemyRenderData>();

  // Health bar texture - key format: "color_bucket" (e.g. "default_80" or "#ff0000_60")
  private healthBarTextures = new Map<string, CanvasTexture>();

  // Frustum culling for animations (reused to avoid allocations)
  private frustum = new Frustum();
  private projScreenMatrix = new Matrix4();

  // Material pool - shared materials per enemy type (reduces GPU state changes)
  // Key: typeId, Value: Array of materials in mesh traverse order
  private materialPool = new Map<string, Material[]>();

  // Debug: track which types have been logged
  private _loggedTypes = new Set<string>();

  // Display toggle flags
  private _showEnemies = true;
  private _showHealthBars = true;
  private _showAnimations = true;
  private _showTextures = true;
  private _useSkeletonClone = true;
  private _showAlphaBlend = true;
  private originalTextureMaps = new Map<Material, Texture | null>();
  private originalAlphaStates = new Map<Material, { transparent: boolean; depthWrite: boolean }>();

  constructor(scene: Scene, sync: CoordinateSync, assetManager: AssetManagerService) {
    this.scene = scene;
    this.sync = sync;
    this.assetManager = assetManager;
  }

  /**
   * Preload model template for an enemy type
   */
  async preloadModel(typeId: EnemyTypeId): Promise<void> {
    const config = ENEMY_TYPES[typeId];
    if (!config) {
      console.warn(`[ThreeEnemyRenderer] Unknown enemy type for preload: ${typeId}`);
      return;
    }

    // Skip if already loaded
    if (this.loadedModelUrls.has(config.modelUrl)) {
      return;
    }

    try {
      await this.assetManager.loadModel(config.modelUrl);
      this.loadedModelUrls.add(config.modelUrl);
    } catch (err) {
      console.error(`[ThreeEnemyRenderer] Failed to load model: ${typeId}`, err);
    }
  }

  /**
   * Preload all enemy type models
   */
  async preloadAllModels(): Promise<void> {
    const types = Object.keys(ENEMY_TYPES) as EnemyTypeId[];
    await Promise.all(types.map((t) => this.preloadModel(t)));
  }

  /**
   * Create enemy render - spawns mesh in scene
   *
   * @param id - Unique enemy ID
   * @param typeId - Enemy type
   * @param lat - Latitude
   * @param lon - Longitude
   * @param height - Terrain height
   */
  async create(
    id: string,
    typeId: EnemyTypeId,
    lat: number,
    lon: number,
    height: number
  ): Promise<EnemyRenderData | null> {
    const config = ENEMY_TYPES[typeId];
    if (!config) {
      console.error(`[ThreeEnemyRenderer] Unknown enemy type: ${typeId}`);
      return null;
    }

    // Load model via AssetManager (cached)
    let cachedModel;
    try {
      cachedModel = await this.assetManager.loadModel(config.modelUrl);
      this.loadedModelUrls.add(config.modelUrl);
    } catch (err) {
      console.error(`[ThreeEnemyRenderer] Failed to load model: ${typeId}`, err);
      return null;
    }

    // Clone the model using SkeletonUtils for proper SkinnedMesh support
    // Regular .clone() breaks skeleton bindings for animated models
    const mesh = this.assetManager.cloneModel(config.modelUrl, { preserveSkeleton: this._useSkeletonClone });
    if (!mesh) {
      console.error(`[ThreeEnemyRenderer] Failed to clone model: ${typeId}`);
      return null;
    }
    mesh.scale.setScalar(config.scale);

    // Apply materials from pool (or initialize pool for first instance)
    if (!this.materialPool.has(typeId)) {
      this.initMaterialPool(typeId, mesh, config);
    } else {
      this.applyPooledMaterials(typeId, mesh);
    }

    // Position in local coordinates
    const localPos = this.sync.geoToLocal(lat, lon, height + config.heightOffset);
    mesh.position.copy(localPos);

    // Ensure all meshes are visible
    mesh.visible = true;
    let nodeCount = 0;
    mesh.traverse((node) => {
      node.visible = true;
      nodeCount++;
    });

    // Log node count for first enemy of each type (debug)
    if (!this._loggedTypes.has(typeId)) {
      this._loggedTypes.add(typeId);
      console.log(`[EnemyRenderer] ${typeId} scene nodes per enemy: ${nodeCount}`);
    }

    // Add to scene (skip if enemies are detached)
    if (this._showEnemies) {
      this.scene.add(mesh);
    }

    // Setup animation mixer if model has animations AND config allows it
    let mixer: AnimationMixer | null = null;
    const animations = new Map<string, AnimationClip>();

    if (config.hasAnimations && cachedModel.animations && cachedModel.animations.length > 0) {
      mixer = new AnimationMixer(mesh);
      for (const clip of cachedModel.animations) {
        animations.set(clip.name, clip);
      }
    }

    // Create health bar sprite
    const healthBar = this.createHealthBarSprite(config);
    healthBar.position.copy(localPos);
    healthBar.position.y += config.healthBarOffset;
    healthBar.visible = this._showHealthBars;
    if (this._showEnemies) {
      this.scene.add(healthBar);
    }

    // Apply current animation toggle state
    if (mixer && !this._showAnimations) {
      mixer.timeScale = 0;
    }

    const renderData: EnemyRenderData = {
      id,
      mesh,
      mixer,
      animations,
      currentAction: null,
      healthBar,
      healthBarBucket: 100, // Initial: full health
      typeConfig: config,
      isDestroyed: false,
      isWalking: true,
      animationVariationTimer: null,
      lastHeading: 0,
    };

    this.enemies.set(id, renderData);
    return renderData;
  }

  /**
   * Update enemy position, rotation, and animation speed
   */
  update(
    id: string,
    lat: number,
    lon: number,
    height: number,
    heading: number,
    healthPercent: number,
    currentSpeed?: number
  ): void {
    const data = this.enemies.get(id);
    if (!data || data.isDestroyed) return;

    // Skip position/visual updates when enemies are hidden
    if (!this._showEnemies) return;

    // Use debug overrides if present, otherwise use typeConfig
    const heightOffset = data.debugOverrides?.heightOffset ?? data.typeConfig.heightOffset;
    const healthBarOffset = data.debugOverrides?.healthBarOffset ?? data.typeConfig.healthBarOffset;

    // Update position
    const localPos = this.sync.geoToLocal(lat, lon, height + heightOffset);
    data.mesh.position.copy(localPos);

    // Store heading for debug rotation offset calculations
    data.lastHeading = heading;

    // Update rotation (movement heading + config offset + debug offset)
    const configOffset = data.typeConfig.headingOffset ?? 0;
    const debugOffset = data.debugOverrides?.rotation ?? 0;
    data.mesh.rotation.y = heading + configOffset + debugOffset;

    // Update health bar position and value
    if (data.healthBar) {
      data.healthBar.position.copy(localPos);
      data.healthBar.position.y += healthBarOffset;
      this.updateHealthBarTexture(data, healthPercent);
    }

    // Update animation speed based on movement speed (skip if debug override is set)
    if (currentSpeed !== undefined && data.currentAction && data.typeConfig.baseSpeed > 0) {
      if (data.debugOverrides?.animationSpeed !== undefined) {
        // Use debug override directly
        data.currentAction.timeScale = data.debugOverrides.animationSpeed;
      } else {
        const baseAnimSpeed = data.typeConfig.animationSpeed ?? 1.0;

        // For run animation: use effective base speed (baseSpeed × runSpeedMultiplier)
        // This prevents the run animation from being sped up by the multiplier
        // (the run animation is already inherently faster in the model)
        let effectiveBaseSpeed = data.typeConfig.baseSpeed;
        if (!data.isWalking && data.typeConfig.runSpeedMultiplier) {
          effectiveBaseSpeed = data.typeConfig.baseSpeed * data.typeConfig.runSpeedMultiplier;
        }

        const speedRatio = currentSpeed / effectiveBaseSpeed;
        data.currentAction.timeScale = baseAnimSpeed * speedRatio;
      }
    }
  }

  /**
   * Start walk animation
   */
  startWalkAnimation(id: string): void {
    const data = this.enemies.get(id);
    if (!data || !data.mixer || !data.typeConfig.walkAnimation) return;

    // Start with walk animation
    this.playMovementAnimation(data, true);

    // Start animation variation timer if enabled
    if (data.typeConfig.animationVariation && data.typeConfig.runAnimation) {
      this.scheduleAnimationVariation(data);
    }
  }

  /**
   * Start run animation (public method for debug control)
   */
  startRunAnimation(id: string): void {
    const data = this.enemies.get(id);
    if (!data || !data.mixer || !data.typeConfig.runAnimation) return;
    this.playMovementAnimation(data, false);
  }

  /**
   * Play idle animation (stops movement animation)
   */
  playIdleAnimation(id: string): void {
    const data = this.enemies.get(id);
    if (!data || !data.mixer) return;

    // Stop animation variation timer
    if (data.animationVariationTimer) {
      clearTimeout(data.animationVariationTimer);
      data.animationVariationTimer = null;
    }

    // Stop current animation
    if (data.currentAction) {
      data.currentAction.stop();
      data.currentAction = null;
    }

    // Play idle animation if available
    const idleClip = data.animations.get(data.typeConfig.idleAnimation ?? '');
    if (idleClip) {
      const action = data.mixer.clipAction(idleClip);
      action.reset();
      action.setLoop(LoopRepeat, Infinity);
      action.timeScale = data.typeConfig.animationSpeed ?? 1.0;
      action.play();
      data.currentAction = action;
    }
  }

  /**
   * Apply debug overrides to an enemy (live update)
   */
  applyDebugOverrides(id: string, overrides: EnemyDebugOverrides): void {
    const data = this.enemies.get(id);
    if (!data) return;

    // Get old values for delta calculation
    const oldHeightOffset = data.debugOverrides?.heightOffset ?? data.typeConfig.heightOffset;
    const oldHealthBarOffset = data.debugOverrides?.healthBarOffset ?? data.typeConfig.healthBarOffset;

    // Store new overrides
    data.debugOverrides = { ...overrides };

    // Apply scale immediately
    if (overrides.scale !== undefined) {
      data.mesh.scale.setScalar(overrides.scale);
    }

    // Apply heightOffset delta immediately
    if (overrides.heightOffset !== undefined) {
      const delta = overrides.heightOffset - oldHeightOffset;
      data.mesh.position.y += delta;
      if (data.healthBar) {
        data.healthBar.position.y += delta;
      }
    }

    // Apply healthBarOffset delta immediately (additional to height change)
    if (overrides.healthBarOffset !== undefined) {
      const barDelta = overrides.healthBarOffset - oldHealthBarOffset;
      if (data.healthBar) {
        data.healthBar.position.y += barDelta;
      }
    }

    // Apply rotation offset immediately (adds to movement heading + config offset)
    if (overrides.rotation !== undefined) {
      const configOffset = data.typeConfig.headingOffset ?? 0;
      data.mesh.rotation.y = data.lastHeading + configOffset + overrides.rotation;
    }

    // Apply animation speed immediately
    if (overrides.animationSpeed !== undefined && data.currentAction) {
      data.currentAction.timeScale = overrides.animationSpeed;
    }
  }

  /**
   * Set animation speed for an enemy based on movement speed
   */
  setAnimationSpeed(id: string, speed: number): void {
    const data = this.enemies.get(id);
    if (!data || !data.currentAction) return;

    const baseAnimSpeed = data.typeConfig.animationSpeed ?? 1.0;
    const speedRatio = speed / data.typeConfig.baseSpeed;
    data.currentAction.timeScale = baseAnimSpeed * speedRatio;
  }

  /**
   * Set animation timeScale directly (for debug panel)
   */
  setAnimationTimeScale(id: string, timeScale: number): void {
    const data = this.enemies.get(id);
    if (!data || !data.currentAction) return;

    data.currentAction.timeScale = timeScale;
  }

  /**
   * Play walk or run animation
   */
  private playMovementAnimation(data: EnemyRenderData, isWalk: boolean): void {
    if (!data.mixer || data.isDestroyed) return;

    const animName = isWalk ? data.typeConfig.walkAnimation : data.typeConfig.runAnimation;
    if (!animName) return;

    const clip = data.animations.get(animName);
    if (!clip) return;

    // Stop previous action completely to prevent accumulation
    if (data.currentAction) {
      data.currentAction.stop();
    }

    const action = data.mixer.clipAction(clip);
    action.reset();
    action.setLoop(LoopRepeat, Infinity);
    action.timeScale = data.typeConfig.animationSpeed ?? 1.0;

    // Random start time for variety (only on first play, not on variation switch)
    if (data.typeConfig.randomAnimationStart && !data.currentAction) {
      action.time = Math.random() * clip.duration;
    }

    action.play();
    data.currentAction = action;
    data.isWalking = isWalk;
  }

  /**
   * Schedule next animation variation (walk <-> run switch)
   */
  private scheduleAnimationVariation(data: EnemyRenderData): void {
    if (data.isDestroyed) return;

    // Clear any existing timer first to prevent accumulation
    if (data.animationVariationTimer) {
      clearTimeout(data.animationVariationTimer);
      data.animationVariationTimer = null;
    }

    // Random interval between 3-8 seconds
    const delay = 3000 + Math.random() * 5000;

    data.animationVariationTimer = setTimeout(() => {
      if (!data.isDestroyed && data.mixer) {
        // Switch animation
        this.playMovementAnimation(data, !data.isWalking);
        // Schedule next switch
        this.scheduleAnimationVariation(data);
      }
    }, delay);
  }

  /**
   * Play death animation
   */
  playDeathAnimation(id: string): void {
    const data = this.enemies.get(id);
    if (!data || !data.mixer || !data.typeConfig.deathAnimation) return;

    // Stop animation variation timer
    if (data.animationVariationTimer) {
      clearTimeout(data.animationVariationTimer);
      data.animationVariationTimer = null;
    }

    const clip = data.animations.get(data.typeConfig.deathAnimation);
    if (!clip) return;

    // Stop current action
    if (data.currentAction) {
      data.currentAction.fadeOut(0.2);
    }

    const action = data.mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    data.currentAction = action;

    // Hide health bar
    if (data.healthBar) {
      data.healthBar.visible = false;
    }
  }

  /**
   * Remove enemy from scene
   */
  remove(id: string): void {
    const data = this.enemies.get(id);
    if (!data) return;

    data.isDestroyed = true;

    // Clear animation variation timer
    if (data.animationVariationTimer) {
      clearTimeout(data.animationVariationTimer);
      data.animationVariationTimer = null;
    }

    // Remove mesh
    this.scene.remove(data.mesh);
    this.disposeObject(data.mesh);

    // Remove health bar
    if (data.healthBar) {
      this.scene.remove(data.healthBar);
      // Note: texture is cached in healthBarTextures and reused, don't dispose it
      data.healthBar.material.dispose();
    }

    // Clean up animation mixer completely
    if (data.mixer) {
      data.mixer.stopAllAction();
      // Uncache all clips to free internal references
      for (const clip of data.animations.values()) {
        data.mixer.uncacheClip(clip);
      }
      // Uncache root object to remove all cached data for this mesh
      data.mixer.uncacheRoot(data.mesh);
    }

    // Clear animation references
    data.animations.clear();
    data.currentAction = null;
    data.mixer = null;

    this.enemies.delete(id);
  }

  /**
   * Update all animation mixers with frustum culling
   * Only animates enemies visible to the camera
   */
  updateAnimations(deltaTime: number, camera: Camera): void {
    // Skip all mixer updates when enemies are hidden or animations disabled
    if (!this._showEnemies || !this._showAnimations) return;

    // Update frustum from camera
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    for (const data of this.enemies.values()) {
      if (!data.mixer || data.isDestroyed) continue;

      // Check if enemy mesh is in camera frustum
      if (this.frustum.containsPoint(data.mesh.position)) {
        data.mixer.update(deltaTime);
      }
    }
  }

  /**
   * Get enemy render data
   */
  get(id: string): EnemyRenderData | undefined {
    return this.enemies.get(id);
  }

  /**
   * Get current speed multiplier based on animation state (walk vs run)
   * Returns 1.0 for walk, runSpeedMultiplier for run
   */
  getSpeedMultiplier(id: string): number {
    const data = this.enemies.get(id);
    if (!data) return 1.0;

    // If running and has runSpeedMultiplier, return it
    if (!data.isWalking && data.typeConfig.runSpeedMultiplier) {
      return data.typeConfig.runSpeedMultiplier;
    }

    return 1.0;
  }

  /**
   * Get all enemy IDs
   */
  getAllIds(): string[] {
    return Array.from(this.enemies.keys());
  }

  /**
   * Get count of active enemies
   */
  get count(): number {
    return this.enemies.size;
  }

  /**
   * Clear all enemies
   */
  clear(): void {
    for (const id of this.enemies.keys()) {
      this.remove(id);
    }
  }

  /**
   * Create health bar sprite
   */
  private createHealthBarSprite(config: EnemyTypeConfig): Sprite {
    const isBoss = !!config.bossName;
    const texture = this.getHealthBarTexture(1.0, config);
    const material = new SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Always visible
    });
    const sprite = new Sprite(material);
    // Boss healthbar is larger to accommodate text
    sprite.scale.set(isBoss ? 10 : 6, isBoss ? 2.5 : 1, 1);
    return sprite;
  }

  /**
   * Update health bar sprite texture (only if bucket changed)
   */
  private updateHealthBarTexture(data: EnemyRenderData, healthPercent: number): void {
    // Calculate bucket (0-100 in 10% steps)
    const bucket = Math.max(0, Math.min(100, Math.round(healthPercent * 10) * 10));

    // Skip update if bucket hasn't changed
    if (bucket === data.healthBarBucket) return;

    data.healthBarBucket = bucket;
    const config = data.typeConfig;
    const cacheKey = this.getHealthBarCacheKey(config, bucket);
    const texture =
      this.healthBarTextures.get(cacheKey) ??
      this.createAndCacheTexture(bucket / 100, config, cacheKey);
    const material = data.healthBar!.material as SpriteMaterial;
    material.map = texture;
    material.needsUpdate = true;
  }

  /**
   * Generate cache key for health bar texture
   */
  private getHealthBarCacheKey(config: EnemyTypeConfig, bucket: number): string {
    const color = config.healthBarColor ?? 'default';
    const boss = config.bossName ?? '';
    const immune = config.immunityPercent ?? 0;
    return `${color}_${boss}_${immune}_${bucket}`;
  }

  /**
   * Create and cache health bar texture for a bucket
   */
  private createAndCacheTexture(
    healthPercent: number,
    config: EnemyTypeConfig,
    cacheKey: string
  ): CanvasTexture {
    const texture = this.createHealthBarTexture(healthPercent, config);
    this.healthBarTextures.set(cacheKey, texture);
    return texture;
  }

  /**
   * Get or create health bar texture for a health percentage
   * Uses 10% buckets to reduce texture count
   */
  private getHealthBarTexture(
    healthPercent: number,
    config: EnemyTypeConfig
  ): CanvasTexture {
    // Round to 10% bucket
    const bucket = Math.round(healthPercent * 10) * 10;
    const bucketClamped = Math.max(0, Math.min(100, bucket));
    const cacheKey = this.getHealthBarCacheKey(config, bucketClamped);

    let texture = this.healthBarTextures.get(cacheKey);
    if (!texture) {
      texture = this.createHealthBarTexture(bucketClamped / 100, config);
      this.healthBarTextures.set(cacheKey, texture);
    }
    return texture;
  }

  /**
   * Create health bar canvas texture
   * @param healthPercent - Health percentage (0-1)
   * @param config - Enemy type config for boss styling
   */
  private createHealthBarTexture(
    healthPercent: number,
    config: EnemyTypeConfig
  ): CanvasTexture {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    const isBoss = !!config.bossName;
    const width = isBoss ? 128 : 64;
    const height = isBoss ? 32 : 12;
    canvas.width = width;
    canvas.height = height;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    // Boss text labels
    if (isBoss) {
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 10px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(config.bossName!, 4, 11);

      if (config.immunityPercent !== undefined && config.immunityPercent > 0) {
        ctx.textAlign = 'right';
        ctx.fillText(`Immune ${config.immunityPercent}%`, width - 4, 11);
      }
    }

    // Health bar position (below text for boss, full height for normal)
    const barY = isBoss ? 16 : 2;
    const barHeight = isBoss ? 12 : height - 4;
    const barWidth = width - 4;

    // Health fill
    const healthWidth = barWidth * Math.max(0, Math.min(1, healthPercent));
    let fillColor: string;
    if (config.healthBarColor) {
      fillColor = config.healthBarColor;
    } else if (healthPercent > 0.6) {
      fillColor = '#22c55e'; // Green
    } else if (healthPercent > 0.3) {
      fillColor = '#eab308'; // Yellow
    } else {
      fillColor = '#ef4444'; // Red
    }

    ctx.fillStyle = fillColor;
    ctx.fillRect(2, barY, healthWidth, barHeight);

    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  /**
   * Initialize materials for an enemy type and cache in pool
   * Called once per enemy type when first instance is created
   */
  private initMaterialPool(typeId: string, mesh: Object3D, config: EnemyTypeConfig): void {
    const materials: Material[] = [];

    mesh.traverse((node) => {
      if ((node as Mesh).isMesh) {
        const meshNode = node as Mesh;

        if (config.unlit) {
          // Convert to unlit material for cartoon models
          const oldMaterial = meshNode.material as MeshStandardMaterial;
          if (oldMaterial) {
            if (oldMaterial.map) {
              oldMaterial.map.colorSpace = SRGBColorSpace;
            }
            const basicMaterial = new MeshBasicMaterial({
              map: oldMaterial.map,
              color: 0xffffff,
              transparent: oldMaterial.transparent,
              opacity: oldMaterial.opacity,
              side: oldMaterial.side,
            });
            meshNode.material = basicMaterial;
            oldMaterial.dispose();
          }
        } else {
          // Configure material properties
          const material = meshNode.material as Material & {
            map?: Texture;
            metalness?: number;
            roughness?: number;
            emissive?: Color;
            emissiveIntensity?: number;
          };

          if (material) {
            if (material.map) {
              material.map.colorSpace = SRGBColorSpace;
              material.map.needsUpdate = true;
            }
            if ('metalness' in material) {
              material.metalness = 0;
              material.roughness = 0.8;
            }
            if (config.emissiveIntensity && config.emissiveIntensity > 0) {
              if ('emissive' in material && 'emissiveIntensity' in material) {
                const emissiveColor = config.emissiveColor || '#ffffff';
                material.emissive = new Color(emissiveColor);
                material.emissiveIntensity = config.emissiveIntensity;
              }
            }
          }
        }

        // Store material in pool
        materials.push(meshNode.material as Material);
      }
    });

    this.materialPool.set(typeId, materials);
  }

  /**
   * Apply pooled materials to a cloned mesh
   * Disposes the cloned materials to free memory
   */
  private applyPooledMaterials(typeId: string, mesh: Object3D): void {
    const pooledMaterials = this.materialPool.get(typeId);
    if (!pooledMaterials) return;

    let index = 0;
    mesh.traverse((node) => {
      if ((node as Mesh).isMesh) {
        const meshNode = node as Mesh;

        // Dispose cloned material (from AssetManager.cloneModel)
        if (meshNode.material) {
          (meshNode.material as Material).dispose();
        }

        // Use pooled material (shared across all instances of this type)
        if (index < pooledMaterials.length) {
          meshNode.material = pooledMaterials[index];
        }
        index++;
      }
    });
  }

  /**
   * Recursively dispose Three.js object (geometry only)
   * Note: Materials are NOT disposed here - they belong to the material pool
   * and are shared across all instances of the same enemy type
   */
  private disposeObject(obj: Object3D): void {
    obj.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      // Materials are pooled and shared - DO NOT dispose them here
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

    // Dispose pooled materials and their textures
    for (const materials of this.materialPool.values()) {
      for (const mat of materials) {
        const stdMat = mat as MeshStandardMaterial;
        if (stdMat.map) stdMat.map.dispose();
        if (stdMat.normalMap) stdMat.normalMap.dispose();
        if (stdMat.roughnessMap) stdMat.roughnessMap.dispose();
        if (stdMat.metalnessMap) stdMat.metalnessMap.dispose();
        mat.dispose();
      }
    }
    this.materialPool.clear();

    for (const texture of this.healthBarTextures.values()) {
      texture.dispose();
    }
    this.healthBarTextures.clear();
  }

  // =====================================================
  // DISPLAY TOGGLES
  // =====================================================

  /**
   * Toggle health bar visibility for all enemies (immediate)
   */
  setHealthBarsVisible(visible: boolean): void {
    this._showHealthBars = visible;
    for (const data of this.enemies.values()) {
      if (data.healthBar && !data.isDestroyed) {
        data.healthBar.visible = visible && this._showEnemies;
      }
    }
  }

  get showHealthBars(): boolean {
    return this._showHealthBars;
  }

  /**
   * Toggle enemy animations (immediate)
   * When disabled, all mixers stop updating but enemies still move along paths.
   */
  setAnimationsEnabled(enabled: boolean): void {
    this._showAnimations = enabled;
    for (const data of this.enemies.values()) {
      if (data.mixer && !data.isDestroyed) {
        data.mixer.timeScale = enabled ? 1 : 0;
      }
    }
  }

  get showAnimations(): boolean {
    return this._showAnimations;
  }

  /**
   * Toggle enemy mesh visibility (immediate).
   * When hidden, meshes and health bars are removed from the scene graph entirely
   * to avoid Three.js traversal overhead. Re-adding restores them.
   */
  setEnemiesVisible(visible: boolean): void {
    if (this._showEnemies === visible) return;
    this._showEnemies = visible;

    if (visible) {
      this.attachAllToScene();
    } else {
      this.detachAllFromScene();
    }
  }

  get showEnemies(): boolean {
    return this._showEnemies;
  }

  /**
   * Toggle textures on/off for all enemy materials (immediate).
   * When disabled, all texture maps are removed → flat white rendering.
   * Isolates GPU texture sampling overhead.
   */
  setTexturesEnabled(enabled: boolean): void {
    if (this._showTextures === enabled) return;
    this._showTextures = enabled;

    for (const materials of this.materialPool.values()) {
      for (const mat of materials) {
        const typed = mat as Material & { map?: Texture | null };
        if (enabled) {
          const original = this.originalTextureMaps.get(mat);
          if (original !== undefined) {
            typed.map = original;
          }
        } else {
          this.originalTextureMaps.set(mat, typed.map ?? null);
          typed.map = null;
        }
        mat.needsUpdate = true;
      }
    }
  }

  get showTextures(): boolean {
    return this._showTextures;
  }

  /**
   * Toggle skeleton cloning for new enemies.
   * When disabled, uses Object3D.clone() instead of SkeletonUtils.clone().
   * Animations will break but isolates skeleton clone CPU cost.
   * Only affects newly spawned enemies.
   */
  setSkeletonCloningEnabled(enabled: boolean): void {
    this._useSkeletonClone = enabled;
  }

  get useSkeletonClone(): boolean {
    return this._useSkeletonClone;
  }

  /**
   * Toggle alpha blending on/off for all enemy materials (immediate).
   * When disabled, forces opaque rendering with depth writes.
   * Isolates alpha-blend overdraw cost (e.g. Penguin model uses BLEND).
   */
  setAlphaBlendEnabled(enabled: boolean): void {
    if (this._showAlphaBlend === enabled) return;
    this._showAlphaBlend = enabled;

    for (const materials of this.materialPool.values()) {
      for (const mat of materials) {
        if (enabled) {
          const original = this.originalAlphaStates.get(mat);
          if (original) {
            mat.transparent = original.transparent;
            mat.depthWrite = original.depthWrite;
          }
        } else {
          this.originalAlphaStates.set(mat, {
            transparent: mat.transparent,
            depthWrite: mat.depthWrite,
          });
          mat.transparent = false;
          mat.depthWrite = true;
        }
        mat.needsUpdate = true;
      }
    }
  }

  get showAlphaBlend(): boolean {
    return this._showAlphaBlend;
  }

  /**
   * Remove all enemy meshes and health bars from the scene graph (without destroying them).
   * Enemies still exist in the enemies Map and can be re-attached.
   */
  private detachAllFromScene(): void {
    for (const data of this.enemies.values()) {
      if (data.isDestroyed) continue;
      this.scene.remove(data.mesh);
      if (data.healthBar) {
        this.scene.remove(data.healthBar);
      }
    }
  }

  /**
   * Re-add all enemy meshes and health bars to the scene graph.
   */
  private attachAllToScene(): void {
    for (const data of this.enemies.values()) {
      if (data.isDestroyed) continue;
      this.scene.add(data.mesh);
      if (data.healthBar) {
        this.scene.add(data.healthBar);
        data.healthBar.visible = this._showHealthBars;
      }
    }
  }
}
