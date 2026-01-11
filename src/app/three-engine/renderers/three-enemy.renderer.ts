import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CoordinateSync } from './index';
import { EnemyTypeConfig, ENEMY_TYPES, EnemyTypeId } from '../../models/enemy-types';

/**
 * Unified model data structure for both GLTF and FBX
 */
interface LoadedModel {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

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
  private gltfLoader: GLTFLoader;
  private fbxLoader: FBXLoader;

  // Cached model templates per enemy type
  private modelTemplates = new Map<string, LoadedModel>();
  private loadingPromises = new Map<string, Promise<LoadedModel>>();

  // Active enemy renders
  private enemies = new Map<string, EnemyRenderData>();

  // Health bar texture
  private healthBarTextures = new Map<number, THREE.CanvasTexture>();

  constructor(scene: THREE.Scene, sync: CoordinateSync) {
    this.scene = scene;
    this.sync = sync;
    this.gltfLoader = new GLTFLoader();
    this.fbxLoader = new FBXLoader();
  }

  /**
   * Load model based on file extension (supports .glb, .gltf, .fbx)
   */
  private async loadModel(url: string): Promise<LoadedModel> {
    const extension = url.split('.').pop()?.toLowerCase();

    if (extension === 'fbx') {
      const fbx = await this.fbxLoader.loadAsync(url);
      return {
        scene: fbx,
        animations: fbx.animations || [],
      };
    } else {
      // Default to GLTF/GLB
      const gltf = await this.gltfLoader.loadAsync(url);
      return {
        scene: gltf.scene,
        animations: gltf.animations || [],
      };
    }
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

    if (this.modelTemplates.has(typeId) || this.loadingPromises.has(typeId)) {
      return;
    }

    const promise = this.loadModel(config.modelUrl);
    this.loadingPromises.set(typeId, promise);

    try {
      const model = await promise;
      this.modelTemplates.set(typeId, model);
    } catch (err) {
      console.error(`[ThreeEnemyRenderer] Failed to load model: ${typeId}`, err);
    } finally {
      this.loadingPromises.delete(typeId);
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

    // Ensure model is loaded
    let model = this.modelTemplates.get(typeId);
    if (!model) {
      // Load on-demand
      const promise = this.loadingPromises.get(typeId) || this.loadModel(config.modelUrl);
      if (!this.loadingPromises.has(typeId)) {
        this.loadingPromises.set(typeId, promise);
      }
      try {
        model = await promise;
        this.modelTemplates.set(typeId, model);
      } catch (err) {
        console.error(`[ThreeEnemyRenderer] Failed to load model: ${typeId}`, err);
        return null;
      } finally {
        this.loadingPromises.delete(typeId);
      }
    }

    // Clone the model using SkeletonUtils for proper SkinnedMesh support
    // Regular .clone() breaks skeleton bindings for animated models
    const mesh = SkeletonUtils.clone(model.scene) as THREE.Object3D;
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

    if (config.hasAnimations && model.animations && model.animations.length > 0) {
      mixer = new THREE.AnimationMixer(mesh);
      for (const clip of model.animations) {
        animations.set(clip.name, clip);
      }
    }

    // Create health bar sprite
    const healthBar = this.createHealthBarSprite(1.0);
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
      typeConfig: config,
      isDestroyed: false,
      isWalking: true,
      animationVariationTimer: null,
    };

    this.enemies.set(id, renderData);
    return renderData;
  }

  /**
   * Update enemy position and rotation
   */
  update(
    id: string,
    lat: number,
    lon: number,
    height: number,
    heading: number,
    healthPercent: number
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
      this.updateHealthBarTexture(data.healthBar, healthPercent);
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
      data.healthBar.material.dispose();
    }

    // Stop animations
    if (data.mixer) {
      data.mixer.stopAllAction();
    }

    this.enemies.delete(id);
  }

  /**
   * Update all animation mixers
   * Call this every frame with delta time in seconds
   */
  updateAnimations(deltaTime: number): void {
    for (const data of this.enemies.values()) {
      if (data.mixer && !data.isDestroyed) {
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
  private createHealthBarSprite(healthPercent: number): THREE.Sprite {
    const texture = this.getHealthBarTexture(healthPercent);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // Always visible
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(6, 1, 1); // Width x Height
    return sprite;
  }

  /**
   * Update health bar sprite texture
   */
  private updateHealthBarTexture(sprite: THREE.Sprite, healthPercent: number): void {
    const texture = this.getHealthBarTexture(healthPercent);
    (sprite.material as THREE.SpriteMaterial).map = texture;
    (sprite.material as THREE.SpriteMaterial).needsUpdate = true;
  }

  /**
   * Get or create health bar texture for a health percentage
   * Uses 10% buckets to reduce texture count
   */
  private getHealthBarTexture(healthPercent: number): THREE.CanvasTexture {
    // Round to 10% bucket
    const bucket = Math.round(healthPercent * 10) * 10;
    const key = Math.max(0, Math.min(100, bucket));

    let texture = this.healthBarTextures.get(key);
    if (!texture) {
      texture = this.createHealthBarTexture(key / 100);
      this.healthBarTextures.set(key, texture);
    }
    return texture;
  }

  /**
   * Create health bar canvas texture
   */
  private createHealthBarTexture(healthPercent: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    const width = 64;
    const height = 12;
    canvas.width = width;
    canvas.height = height;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    // Health fill
    const healthWidth = (width - 4) * Math.max(0, Math.min(1, healthPercent));
    let fillColor: string;
    if (healthPercent > 0.6) {
      fillColor = '#22c55e'; // Green
    } else if (healthPercent > 0.3) {
      fillColor = '#eab308'; // Yellow
    } else {
      fillColor = '#ef4444'; // Red
    }

    ctx.fillStyle = fillColor;
    ctx.fillRect(2, 2, healthWidth, height - 4);

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
    this.modelTemplates.clear();
    for (const texture of this.healthBarTextures.values()) {
      texture.dispose();
    }
    this.healthBarTextures.clear();
  }
}
