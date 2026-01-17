import * as THREE from 'three';
import { CoordinateSync } from './index';
import { EnemyTypeConfig, ENEMY_TYPES, EnemyTypeId } from '../../models/enemy-types';
import { AssetManagerService } from '../../services/asset-manager.service';

/**
 * Enemy render data - stored per enemy
 */
export interface EnemyRenderData {
  id: string;
  mesh: THREE.Object3D;
  mixer: THREE.AnimationMixer | null;
  animations: Map<string, THREE.AnimationClip>;
  currentAction: THREE.AnimationAction | null;
  healthBar: THREE.Sprite | null;
  healthBarBucket: number; // Cached bucket (0-100 in 10% steps) to avoid unnecessary updates
  typeConfig: EnemyTypeConfig;
  isDestroyed: boolean;
  // Animation variation
  isWalking: boolean; // true = Walk, false = Run
  animationVariationTimer: ReturnType<typeof setTimeout> | null;
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
  private scene: THREE.Scene;
  private sync: CoordinateSync;
  private assetManager: AssetManagerService;

  // Loaded model URLs for reference counting
  private loadedModelUrls = new Set<string>();

  // Active enemy renders
  private enemies = new Map<string, EnemyRenderData>();

  // Health bar texture - key format: "color_bucket" (e.g. "default_80" or "#ff0000_60")
  private healthBarTextures = new Map<string, THREE.CanvasTexture>();

  // Frustum culling for animations (reused to avoid allocations)
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene, sync: CoordinateSync, assetManager: AssetManagerService) {
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
    const mesh = this.assetManager.cloneModel(config.modelUrl, { preserveSkeleton: true });
    if (!mesh) {
      console.error(`[ThreeEnemyRenderer] Failed to clone model: ${typeId}`);
      return null;
    }
    mesh.scale.setScalar(config.scale);

    // Enable shadows and apply material adjustments
    mesh.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const meshNode = node as THREE.Mesh;
        meshNode.castShadow = true;
        meshNode.receiveShadow = true;

        // Convert to unlit material for cartoon models
        if (config.unlit) {
          const oldMaterial = meshNode.material as THREE.MeshStandardMaterial;
          if (oldMaterial) {
            // Fix texture colorspace for correct colors
            if (oldMaterial.map) {
              oldMaterial.map.colorSpace = THREE.SRGBColorSpace;
            }
            const basicMaterial = new THREE.MeshBasicMaterial({
              map: oldMaterial.map,
              color: 0xffffff, // White to show texture colors unchanged
              transparent: oldMaterial.transparent,
              opacity: oldMaterial.opacity,
              side: oldMaterial.side,
            });
            meshNode.material = basicMaterial;
            oldMaterial.dispose();
          }
        } else {
          // Handle any material type (FBX often uses MeshPhongMaterial)
          const material = meshNode.material as THREE.Material & {
            map?: THREE.Texture;
            metalness?: number;
            roughness?: number;
            emissive?: THREE.Color;
            emissiveIntensity?: number;
          };

          if (material) {
            // Fix texture colorspace for correct colors
            if (material.map) {
              material.map.colorSpace = THREE.SRGBColorSpace;
              material.map.needsUpdate = true;
            }

            // For MeshStandardMaterial: reduce metalness for vibrant colors
            if ('metalness' in material) {
              material.metalness = 0;
              material.roughness = 0.8;
            }

            // Apply emissive effect if configured
            if (config.emissiveIntensity && config.emissiveIntensity > 0) {
              if ('emissive' in material && 'emissiveIntensity' in material) {
                const emissiveColor = config.emissiveColor || '#ffffff';
                material.emissive = new THREE.Color(emissiveColor);
                material.emissiveIntensity = config.emissiveIntensity;
              }
            }
          }
        }
      }
    });

    // Position in local coordinates
    const localPos = this.sync.geoToLocal(lat, lon, height + config.heightOffset);
    mesh.position.copy(localPos);

    // Ensure all meshes are visible and disable frustum culling for small objects
    mesh.visible = true;
    mesh.traverse((node) => {
      node.visible = true;
      node.frustumCulled = false; // Disable culling - entities are small and might be culled incorrectly
    });

    // Add to scene
    this.scene.add(mesh);

    // Setup animation mixer if model has animations AND config allows it
    let mixer: THREE.AnimationMixer | null = null;
    const animations = new Map<string, THREE.AnimationClip>();

    if (config.hasAnimations && cachedModel.animations && cachedModel.animations.length > 0) {
      mixer = new THREE.AnimationMixer(mesh);
      for (const clip of cachedModel.animations) {
        animations.set(clip.name, clip);
      }
    }

    // Create health bar sprite
    const healthBar = this.createHealthBarSprite(config);
    healthBar.position.copy(localPos);
    healthBar.position.y += config.healthBarOffset;
    this.scene.add(healthBar);

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

    // Update position
    const localPos = this.sync.geoToLocal(lat, lon, height + data.typeConfig.heightOffset);
    data.mesh.position.copy(localPos);

    // Update rotation (heading + offset)
    const totalHeading = heading + (data.typeConfig.headingOffset ?? 0);
    data.mesh.rotation.y = totalHeading;

    // Update health bar position and value
    if (data.healthBar) {
      data.healthBar.position.copy(localPos);
      data.healthBar.position.y += data.typeConfig.healthBarOffset;
      this.updateHealthBarTexture(data, healthPercent);
    }

    // Update animation speed based on movement speed
    if (currentSpeed !== undefined && data.currentAction && data.typeConfig.baseSpeed > 0) {
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
    action.setLoop(THREE.LoopRepeat, Infinity);
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
    action.setLoop(THREE.LoopOnce, 1);
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
  updateAnimations(deltaTime: number, camera: THREE.Camera): void {
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
  private createHealthBarSprite(config: EnemyTypeConfig): THREE.Sprite {
    const isBoss = !!config.bossName;
    const texture = this.getHealthBarTexture(1.0, config);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Always visible
    });
    const sprite = new THREE.Sprite(material);
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
    const material = data.healthBar!.material as THREE.SpriteMaterial;
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
  ): THREE.CanvasTexture {
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
  ): THREE.CanvasTexture {
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
  ): THREE.CanvasTexture {
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

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
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
          if (stdMat.roughnessMap) stdMat.roughnessMap.dispose();
          if (stdMat.metalnessMap) stdMat.metalnessMap.dispose();
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

    for (const texture of this.healthBarTextures.values()) {
      texture.dispose();
    }
    this.healthBarTextures.clear();
  }
}
