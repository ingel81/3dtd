import { Injectable, inject } from '@angular/core';
import {
  Scene,
  PerspectiveCamera,
  Group,
  AnimationMixer,
  WebGLRenderer,
  SRGBColorSpace,
  Color,
  AmbientLight,
  DirectionalLight,
  Box3,
  Vector3,
  Light,
  Object3D,
  Mesh,
} from 'three';
import { AssetManagerService } from './asset-manager.service';

export interface PreviewConfig {
  modelUrl: string;
  scale?: number;
  rotationSpeed?: number; // radians per second, 0 = no rotation
  cameraDistance?: number;
  cameraAngle?: number; // pitch angle in radians (0 = horizontal)
  animationName?: string; // Name of animation to play (e.g., 'Idle', 'Walk')
  animationTimeScale?: number;
  backgroundColor?: number; // hex color or transparent if not set
  lightIntensity?: number;
  groundModel?: boolean; // If true, model stands on ground (y=0) instead of centered
}

interface PreviewInstance {
  id: string;
  canvas: HTMLCanvasElement;
  scene: Scene;
  camera: PerspectiveCamera;
  model: Group | null;
  mixer: AnimationMixer | null;
  config: PreviewConfig;
  animating: boolean;
}

/**
 * Service for rendering 3D model previews.
 *
 * Uses a single shared WebGL renderer to render multiple preview canvases
 * sequentially. This is more performant than creating multiple WebGL contexts.
 */
@Injectable()
export class ModelPreviewService {
  private readonly assetManager = inject(AssetManagerService);

  private renderer: WebGLRenderer | null = null;
  private previews = new Map<string, PreviewInstance>();
  private animationFrameId: number | null = null;
  private lastTime = 0;

  // Track loaded model URLs for this service
  private loadedModelUrls = new Set<string>();

  /**
   * Initialize the shared renderer.
   * Must be called before creating previews.
   */
  initialize(): void {
    if (this.renderer) return;

    // Create an off-screen canvas for the shared renderer
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;

    this.renderer = new WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;

    // Start animation loop
    this.startAnimationLoop();
  }

  /**
   * Create a preview for a model and render it to the provided canvas.
   */
  async createPreview(
    id: string,
    targetCanvas: HTMLCanvasElement,
    config: PreviewConfig
  ): Promise<void> {
    if (!this.renderer) {
      this.initialize();
    }

    // Remove existing preview with same ID
    if (this.previews.has(id)) {
      this.destroyPreview(id);
    }

    // Create scene
    const scene = new Scene();
    if (config.backgroundColor !== undefined) {
      scene.background = new Color(config.backgroundColor);
    }

    // Create camera
    const aspect = targetCanvas.width / targetCanvas.height;
    const camera = new PerspectiveCamera(45, aspect, 0.1, 100);
    const distance = config.cameraDistance ?? 5;
    const angle = config.cameraAngle ?? Math.PI / 6; // 30 degrees default
    camera.position.set(0, Math.sin(angle) * distance, Math.cos(angle) * distance);
    camera.lookAt(0, 0, 0);

    // Add lights
    const ambientLight = new AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new DirectionalLight(
      0xffffff,
      config.lightIntensity ?? 1.0
    );
    directionalLight.position.set(2, 4, 3);
    scene.add(directionalLight);

    // Add rim light for better definition
    const rimLight = new DirectionalLight(0x88ccff, 0.3);
    rimLight.position.set(-2, 1, -2);
    scene.add(rimLight);

    const preview: PreviewInstance = {
      id,
      canvas: targetCanvas,
      scene,
      camera,
      model: null,
      mixer: null,
      config,
      animating: true,
    };

    this.previews.set(id, preview);

    // Load model
    await this.loadModel(preview, config.modelUrl);

    // Initial render
    this.renderPreview(preview);
  }

  /**
   * Load a model into a preview instance.
   */
  private async loadModel(preview: PreviewInstance, modelUrl: string): Promise<void> {
    try {
      // Load via AssetManager (cached)
      const needsAnimation = !!preview.config.animationName;
      const cachedModel = await this.assetManager.loadModel(modelUrl);
      this.loadedModelUrls.add(modelUrl);

      // Clone the model - use preserveSkeleton for animated models
      const model = this.assetManager.cloneModel(modelUrl, {
        preserveSkeleton: needsAnimation,
      });
      if (!model) {
        console.error(`[ModelPreview] Failed to clone model: ${modelUrl}`);
        return;
      }

      // Apply FBX materials if needed
      if (this.assetManager.isFbxModel(modelUrl)) {
        this.assetManager.applyFbxMaterials(model);
      }
      const scale = preview.config.scale ?? 1;
      model.scale.set(scale, scale, scale);

      // Calculate bounding box after scaling
      const box = new Box3().setFromObject(model);
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());

      // Center the model horizontally, optionally ground it
      model.position.x = -center.x;
      model.position.z = -center.z;

      let lookAtY = 0;
      if (preview.config.groundModel) {
        // Model stands on ground, camera looks at vertical center
        model.position.y = -box.min.y;
        lookAtY = size.y / 2;
      } else {
        // Model fully centered
        model.position.y = -center.y;
        lookAtY = 0;
      }

      // Wrap in a pivot group for rotation around center
      const pivot = new Group();
      pivot.add(model);
      preview.scene.add(pivot);
      preview.model = pivot; // Rotate the pivot, not the model

      // Camera looks at model center
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = preview.camera.fov * (Math.PI / 180);
      const autoDistance = maxDim / (2 * Math.tan(fov / 2)) * 1.8;

      const finalDistance = preview.config.cameraDistance ?? autoDistance;
      const angle = preview.config.cameraAngle ?? Math.PI / 6;
      preview.camera.position.set(
        0,
        lookAtY + Math.sin(angle) * finalDistance,
        Math.cos(angle) * finalDistance
      );
      preview.camera.lookAt(0, lookAtY, 0);

      // Setup animation if specified
      if (preview.config.animationName && cachedModel.animations.length > 0) {
        preview.mixer = new AnimationMixer(model);

        // Find the requested animation
        let clip = cachedModel.animations.find(
          (a) => a.name === preview.config.animationName
        );

        // Fallback to first animation if not found
        if (!clip && cachedModel.animations.length > 0) {
          clip = cachedModel.animations[0];
        }

        if (clip) {
          const action = preview.mixer.clipAction(clip);
          action.timeScale = preview.config.animationTimeScale ?? 1.0;
          action.play();
        }
      }
    } catch (error) {
      console.error(`[ModelPreview] Failed to load model: ${modelUrl}`, error);
    }
  }

  /**
   * Render a single preview to its target canvas.
   */
  private renderPreview(preview: PreviewInstance): void {
    if (!this.renderer || !preview.animating) return;

    const width = preview.canvas.width;
    const height = preview.canvas.height;

    // Set renderer size AND update internal canvas dimensions
    this.renderer.setSize(width, height, true);

    // Update camera aspect
    preview.camera.aspect = width / height;
    preview.camera.updateProjectionMatrix();

    // Render scene
    this.renderer.render(preview.scene, preview.camera);

    // Copy rendered image to target canvas
    const ctx = preview.canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      // Draw the entire source canvas to the entire target canvas
      ctx.drawImage(
        this.renderer.domElement,
        0, 0, this.renderer.domElement.width, this.renderer.domElement.height,
        0, 0, width, height
      );
    }
  }

  /**
   * Start the animation loop for all previews.
   */
  private startAnimationLoop(): void {
    const animate = (time: number) => {
      const deltaTime = this.lastTime ? (time - this.lastTime) / 1000 : 0;
      this.lastTime = time;

      for (const preview of this.previews.values()) {
        if (!preview.animating) continue;

        // Update rotation
        if (preview.model && preview.config.rotationSpeed) {
          preview.model.rotation.y += preview.config.rotationSpeed * deltaTime;
        }

        // Update animation mixer
        if (preview.mixer) {
          preview.mixer.update(deltaTime);
        }

        // Render
        this.renderPreview(preview);
      }

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Pause a specific preview's animation.
   */
  pausePreview(id: string): void {
    const preview = this.previews.get(id);
    if (preview) {
      preview.animating = false;
    }
  }

  /**
   * Resume a specific preview's animation.
   */
  resumePreview(id: string): void {
    const preview = this.previews.get(id);
    if (preview) {
      preview.animating = true;
    }
  }

  /**
   * Destroy a specific preview.
   */
  destroyPreview(id: string): void {
    const preview = this.previews.get(id);
    if (!preview) return;

    preview.animating = false;

    // Dispose Three.js objects
    if (preview.model) {
      preview.scene.remove(preview.model);
      this.disposeObject(preview.model);
    }

    if (preview.mixer) {
      preview.mixer.stopAllAction();
    }

    // Dispose scene lights
    preview.scene.traverse((obj) => {
      if (obj instanceof Light) {
        obj.dispose?.();
      }
    });

    this.previews.delete(id);
  }

  /**
   * Dispose all resources.
   */
  dispose(): void {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Destroy all previews
    for (const id of this.previews.keys()) {
      this.destroyPreview(id);
    }

    // Release model references from AssetManager
    for (const url of this.loadedModelUrls) {
      this.assetManager.releaseModel(url);
    }
    this.loadedModelUrls.clear();

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
  }

  /**
   * Recursively dispose Three.js object.
   */
  private disposeObject(obj: Object3D): void {
    obj.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
    });
  }
}
