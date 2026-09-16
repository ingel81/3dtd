import { Injectable } from '@angular/core';
import { Object3D, AnimationClip, Mesh, Material, MeshStandardMaterial } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Unified model data structure for cached models
 */
export interface CachedModel {
  /** Original scene (template - do NOT modify directly) */
  scene: Object3D;
  /** Animation clips from model */
  animations: AnimationClip[];
  /** Reference count for cleanup */
  refCount: number;
  /** Model URL for debugging */
  url: string;
}

/**
 * Model clone options
 */
export interface CloneOptions {
  /** Use SkeletonUtils.clone for animated models (preserves skeleton bindings) */
  preserveSkeleton?: boolean;
}

/**
 * AssetManagerService - Centralized 3D model loading and caching
 *
 * Features:
 * - Single GLTFLoader instance (GLTF/GLB)
 * - Deduplicated model cache with reference counting
 * - Proper GPU resource disposal
 *
 * Usage:
 * 1. loadModel(url) - loads and caches model, returns CachedModel
 * 2. cloneModel(url) - returns a clone for instantiation
 * 3. releaseModel(url) - decrements ref count, disposes when 0
 */
@Injectable({ providedIn: 'root' })
export class AssetManagerService {
  private readonly gltfLoader = new GLTFLoader();

  // Model cache: URL -> CachedModel
  private readonly modelCache = new Map<string, CachedModel>();

  // Loading promises to prevent duplicate loads
  private readonly loadingPromises = new Map<string, Promise<CachedModel>>();

  /**
   * Load a model from URL (cached)
   * Returns existing cached model or loads new one
   */
  async loadModel(url: string): Promise<CachedModel> {
    // Return cached model
    const cached = this.modelCache.get(url);
    if (cached) {
      cached.refCount++;
      return cached;
    }

    // Return existing loading promise (deduplication)
    const existingPromise = this.loadingPromises.get(url);
    if (existingPromise) {
      const result = await existingPromise;
      result.refCount++;
      return result;
    }

    // Start new load
    const loadPromise = this.doLoadModel(url);
    this.loadingPromises.set(url, loadPromise);

    try {
      const model = await loadPromise;
      this.modelCache.set(url, model);
      return model;
    } finally {
      this.loadingPromises.delete(url);
    }
  }

  /**
   * Internal: perform actual model load
   */
  private async doLoadModel(url: string): Promise<CachedModel> {
    const gltf = await this.gltfLoader.loadAsync(url);
    return {
      scene: gltf.scene,
      animations: gltf.animations || [],
      refCount: 1,
      url,
    };
  }

  /**
   * Clone a cached model for instantiation
   * Materials are deep-cloned to prevent shared state issues (e.g., preview tinting)
   * @param url Model URL (must be loaded first)
   * @param options Clone options (preserveSkeleton for animated models)
   */
  cloneModel(url: string, options: CloneOptions = {}): Object3D | null {
    const cached = this.modelCache.get(url);
    if (!cached) {
      console.warn(`[AssetManager] Model not cached: ${url}`);
      return null;
    }

    // Use SkeletonUtils.clone for animated models to preserve skeleton bindings
    let clone: Object3D;
    if (options.preserveSkeleton) {
      clone = SkeletonUtils.clone(cached.scene) as Object3D;
    } else {
      clone = cached.scene.clone();
    }

    // Deep-clone materials to prevent shared state issues
    // (e.g., build preview tinting affecting placed towers)
    this.cloneMaterials(clone);

    return clone;
  }

  /**
   * Deep-clone all materials in a model
   * Prevents shared material state between instances
   */
  private cloneMaterials(object: Object3D): void {
    object.traverse((node) => {
      if ((node as Mesh).isMesh) {
        const mesh = node as Mesh;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mat) => mat.clone());
        } else if (mesh.material) {
          mesh.material = mesh.material.clone();
        }
      }
    });
  }

  /**
   * Get cached model without cloning (for read-only access)
   */
  getCachedModel(url: string): CachedModel | undefined {
    return this.modelCache.get(url);
  }

  /**
   * Check if model is cached
   */
  isCached(url: string): boolean {
    return this.modelCache.has(url);
  }

  /**
   * Check if model is currently loading
   */
  isModelLoading(url: string): boolean {
    return this.loadingPromises.has(url);
  }

  /**
   * Release a model reference
   * When refCount reaches 0, model is disposed from GPU memory
   */
  releaseModel(url: string): void {
    const cached = this.modelCache.get(url);
    if (!cached) return;

    cached.refCount--;

    if (cached.refCount <= 0) {
      this.disposeModel(cached);
      this.modelCache.delete(url);
    }
  }

  /**
   * Preload multiple models in parallel
   * @param urls Array of model URLs to preload
   * @returns Promise that resolves when all models are loaded
   */
  async preloadModels(urls: string[]): Promise<void> {
    await Promise.all(urls.map((url) => this.loadModel(url)));
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { count: number; urls: string[] } {
    return {
      count: this.modelCache.size,
      urls: Array.from(this.modelCache.keys()),
    };
  }

  /**
   * Clear entire cache (dispose all models)
   * Use with caution - only on scene cleanup
   */
  clearCache(): void {
    for (const cached of this.modelCache.values()) {
      this.disposeModel(cached);
    }
    this.modelCache.clear();
  }

  /**
   * Dispose service resources
   */
  dispose(): void {
    this.clearCache();
    this.loadingPromises.clear();
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  /**
   * Recursively dispose Three.js object and its resources
   */
  private disposeModel(cached: CachedModel): void {
    this.disposeObject(cached.scene);
  }

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
          this.disposeMaterial(mat);
        }
      }
    });
  }

  private disposeMaterial(mat: Material): void {
    const stdMat = mat as MeshStandardMaterial;

    // Dispose textures
    if (stdMat.map) stdMat.map.dispose();
    if (stdMat.normalMap) stdMat.normalMap.dispose();
    if (stdMat.roughnessMap) stdMat.roughnessMap.dispose();
    if (stdMat.metalnessMap) stdMat.metalnessMap.dispose();
    if (stdMat.aoMap) stdMat.aoMap.dispose();
    if (stdMat.emissiveMap) stdMat.emissiveMap.dispose();
    if (stdMat.envMap) stdMat.envMap.dispose();

    // Dispose material itself
    mat.dispose();
  }
}
