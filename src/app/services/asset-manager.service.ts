import { Injectable, signal, computed } from '@angular/core';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Unified model data structure for cached models
 */
export interface CachedModel {
  /** Original scene (template - do NOT modify directly) */
  scene: THREE.Object3D;
  /** Animation clips from model */
  animations: THREE.AnimationClip[];
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
 * Loading progress info
 */
interface LoadingProgress {
  url: string;
  loaded: number;
  total: number;
}

/**
 * AssetManagerService - Centralized 3D model loading and caching
 *
 * Features:
 * - Single GLTFLoader and FBXLoader instance
 * - Deduplicated model cache with reference counting
 * - Proper GPU resource disposal
 * - Loading progress tracking
 * - Support for both GLTF/GLB and FBX formats
 *
 * Usage:
 * 1. loadModel(url) - loads and caches model, returns CachedModel
 * 2. cloneModel(url) - returns a clone for instantiation
 * 3. releaseModel(url) - decrements ref count, disposes when 0
 */
@Injectable({ providedIn: 'root' })
export class AssetManagerService {
  // Loaders (single instances)
  private readonly gltfLoader = new GLTFLoader();
  private readonly fbxLoader = new FBXLoader();

  // Model cache: URL -> CachedModel
  private readonly modelCache = new Map<string, CachedModel>();

  // Loading promises to prevent duplicate loads
  private readonly loadingPromises = new Map<string, Promise<CachedModel>>();

  // Progress tracking
  private readonly loadingProgress = new Map<string, LoadingProgress>();

  // Signals for UI feedback
  readonly isLoading = signal(false);
  readonly loadingCount = signal(0);
  readonly totalModelsLoaded = signal(0);

  // Computed: loading percentage (0-100)
  readonly loadingPercentage = computed(() => {
    let totalLoaded = 0;
    let totalSize = 0;
    for (const progress of this.loadingProgress.values()) {
      totalLoaded += progress.loaded;
      totalSize += progress.total || progress.loaded;
    }
    return totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 0;
  });

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
      this.totalModelsLoaded.update((n) => n + 1);
      return model;
    } finally {
      this.loadingPromises.delete(url);
      this.loadingProgress.delete(url);
      this.updateLoadingState();
    }
  }

  /**
   * Internal: perform actual model load
   */
  private async doLoadModel(url: string): Promise<CachedModel> {
    this.loadingCount.update((n) => n + 1);
    this.updateLoadingState();

    try {
      const extension = url.split('.').pop()?.toLowerCase();
      let scene: THREE.Object3D;
      let animations: THREE.AnimationClip[];

      if (extension === 'fbx') {
        // FBX loading
        const fbx = await this.fbxLoader.loadAsync(url, (event) => {
          this.updateProgress(url, event.loaded, event.total);
        });
        scene = fbx;
        animations = fbx.animations || [];
      } else {
        // GLTF/GLB loading (default)
        const gltf = await this.gltfLoader.loadAsync(url, (event) => {
          this.updateProgress(url, event.loaded, event.total);
        });
        scene = gltf.scene;
        animations = gltf.animations || [];
      }

      return {
        scene,
        animations,
        refCount: 1,
        url,
      };
    } finally {
      this.loadingCount.update((n) => n - 1);
      this.updateLoadingState();
    }
  }

  /**
   * Clone a cached model for instantiation
   * Materials are deep-cloned to prevent shared state issues (e.g., preview tinting)
   * @param url Model URL (must be loaded first)
   * @param options Clone options (preserveSkeleton for animated models)
   */
  cloneModel(url: string, options: CloneOptions = {}): THREE.Object3D | null {
    const cached = this.modelCache.get(url);
    if (!cached) {
      console.warn(`[AssetManager] Model not cached: ${url}`);
      return null;
    }

    // Use SkeletonUtils.clone for animated models to preserve skeleton bindings
    let clone: THREE.Object3D;
    if (options.preserveSkeleton) {
      clone = SkeletonUtils.clone(cached.scene) as THREE.Object3D;
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
  private cloneMaterials(object: THREE.Object3D): void {
    object.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) {
        const mesh = node as THREE.Mesh;
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
   * Apply standard FBX material colors
   * Call this after cloning an FBX model
   */
  applyFbxMaterials(model: THREE.Object3D): void {
    const materialColors: Record<string, number> = {
      lightwood: 0xc4a574,
      wood: 0xa0784a,
      darkwood: 0x6b4423,
      celing: 0xcd5c5c, // Common typo in model files
      ceiling: 0xcd5c5c,
      roof: 0xcd5c5c,
      stone: 0x808080,
      metal: 0x707070,
    };

    model.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

        materials.forEach((mat) => {
          const matWithColor = mat as THREE.MeshStandardMaterial;
          if (matWithColor.color) {
            const matName = mat.name.toLowerCase();

            let color: number | undefined;
            for (const [key, value] of Object.entries(materialColors)) {
              if (matName.includes(key)) {
                color = value;
                break;
              }
            }

            matWithColor.color.setHex(color ?? 0xb8956e); // Default wood color
            if ('transparent' in mat) mat.transparent = false;
            if ('opacity' in mat) (mat as THREE.MeshStandardMaterial).opacity = 1.0;
          }
        });
      }
    });
  }

  /**
   * Check if URL is an FBX file
   */
  isFbxModel(url: string): boolean {
    return url.toLowerCase().endsWith('.fbx');
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
    this.totalModelsLoaded.set(0);
  }

  /**
   * Dispose service resources
   */
  dispose(): void {
    this.clearCache();
    this.loadingPromises.clear();
    this.loadingProgress.clear();
  }

  // ========================================
  // PRIVATE HELPERS
  // ========================================

  private updateProgress(url: string, loaded: number, total: number): void {
    this.loadingProgress.set(url, { url, loaded, total });
  }

  private updateLoadingState(): void {
    this.isLoading.set(this.loadingCount() > 0);
  }

  /**
   * Recursively dispose Three.js object and its resources
   */
  private disposeModel(cached: CachedModel): void {
    this.disposeObject(cached.scene);
  }

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
          this.disposeMaterial(mat);
        }
      }
    });
  }

  private disposeMaterial(mat: THREE.Material): void {
    const stdMat = mat as THREE.MeshStandardMaterial;

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
