import { Injectable, inject } from '@angular/core';
import {
  Scene,
  PerspectiveCamera,
  Group,
  AnimationClip,
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
import { FramePacer } from '../../utils/frame-pacer';
import { PREVIEW_MANIFEST, PREVIEW_SHEET_DIR, previewViewKey, type PreviewSheetEntry, type PreviewSheetManifest } from './preview-sheets';

export interface PreviewConfig {
  modelUrl: string;
  scale?: number;
  cameraDistance?: number;
  cameraAngle?: number; // pitch angle in radians (0 = horizontal)
  animationName?: string; // Name of animation to play (e.g., 'Idle', 'Walk')
  animationTimeScale?: number;
  backgroundColor?: number; // hex color or transparent if not set
  lightIntensity?: number;
  groundModel?: boolean; // If true, model stands on ground (y=0) instead of centered
  offsetY?: number; // Vertical offset for camera target (shifts view up/down)
  /**
   * Whether the host currently hides the canvas (e.g. its panel is under
   * `display: none`). Read every frame; while true the preview is not drawn,
   * since nothing could show it.
   */
  isHidden?: () => boolean;
}

/**
 * One turn of a preview, baked once: TURN_FRAMES pictures of a full turn,
 * played at PLAYBACK_FPS, one turn in TURN_FRAMES / PLAYBACK_FPS seconds.
 *
 * Why baked (TODO E73): rendering every preview live meant a render on a
 * second WebGL context plus a drawImage copy out of it per preview and
 * frame, and the copy stalls on the GPU the map needs. In Firefox that cost
 * about 6 ms a frame with one enemy group in the wave panel (69 instead of
 * 124 FPS, 4800 enemies). Baked, playing a turn is a copy between two 2D
 * canvases of a few kB; the WebGL renderer works only while a turn bakes.
 * 144 frames at 24 FPS (TODO E76): 2.5 degrees a step, one turn in 6 s.
 * The game's own views come baked with the build (preview-sheets.ts); a
 * turn bakes here only for a view without a sheet.
 */
export const TURN_FRAMES = 144;
export const PLAYBACK_FPS = 24;
/** Frames per row of a turn's sheet: a grid, since one row of 144 wide cards would pass the browsers' canvas limits */
export const SHEET_COLUMNS = 12;
/** Frames rendered into a turn per display frame while one bakes: a turn is done in a few frames without a hitch */
const BAKE_PER_FRAME = 6;
/** Baked pixels per CSS pixel at most: previews are small, a sharper turn costs memory for every frame of it */
const MAX_BAKE_RATIO = 1.25;

/** The frame of a turn to show at `timeMs`: the turn plays at PLAYBACK_FPS, looping, over the frames baked so far */
export function turnFrameAt(timeMs: number, baked: number): number {
  if (baked <= 0) return -1;
  const frame = Math.floor((timeMs * PLAYBACK_FPS) / 1000) % TURN_FRAMES;
  return frame < baked ? frame : baked - 1;
}

/** The size a turn bakes at for a canvas of `width` x `height` physical pixels, `cssWidth` CSS pixels wide */
export function bakeSize(width: number, height: number, cssWidth: number): { width: number; height: number } {
  const ratio = cssWidth > 0 ? Math.min(width / cssWidth, MAX_BAKE_RATIO) : 1;
  const scale = cssWidth > 0 ? (cssWidth * ratio) / width : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Start the configured clip on `model` and measure the model in the clip's
 * first frame, the pose the preview shows; the requested clip or else the
 * first one, none without `animationName`. A fresh SkeletonUtils clone keeps
 * stale bone world matrices until updateMatrixWorld(true): measured before
 * it, the tank came out 88 x 194 x 139 m with its centre 43 m to the side,
 * so the preview turned it on a wide circle out of view.
 */
export function measurePreviewModel(
  model: Object3D,
  clips: readonly AnimationClip[],
  config: Pick<PreviewConfig, 'animationName' | 'animationTimeScale'>
): { box: Box3; mixer: AnimationMixer | null } {
  let mixer: AnimationMixer | null = null;
  if (config.animationName && clips.length > 0) {
    mixer = new AnimationMixer(model);
    const clip = clips.find((a) => a.name === config.animationName) ?? clips[0];
    const action = mixer.clipAction(clip);
    action.timeScale = config.animationTimeScale ?? 1.0;
    action.play();
    mixer.update(0);
  }
  model.updateMatrixWorld(true);
  return { box: new Box3().setFromObject(model), mixer };
}

/** The scene a turn is baked from; dropped once the turn is complete */
interface BakeJob {
  scene: Scene;
  camera: PerspectiveCamera;
  pivot: Group | null;
  mixer: AnimationMixer | null;
  loaded: boolean;
}

/**
 * A baked turn: its frames in a grid on one 2D canvas, or on the picture of
 * a sheet rendered ahead, shared by every preview of the same model and view
 */
interface Turn {
  sheet: HTMLCanvasElement | ImageBitmap;
  width: number;
  height: number;
  /** Frames baked so far, TURN_FRAMES when done */
  baked: number;
  job: BakeJob | null;
}

interface PreviewInstance {
  canvas: HTMLCanvasElement;
  turn: Turn;
  config: PreviewConfig;
  /** Frame on the canvas, -1 before the first */
  shown: number;
}

/**
 * Service for 3D model previews (tower cards, wave groups).
 *
 * Each model and view bakes one turn once with a single shared WebGL
 * renderer; the previews then play their turn from a 2D sprite sheet (see
 * TURN_FRAMES).
 */
@Injectable()
export class ModelPreviewService {
  private readonly assetManager = inject(AssetManagerService);

  private renderer: WebGLRenderer | null = null;
  private previews = new Map<string, PreviewInstance>();
  /** Baked turns by model and view (turnKey) */
  private turns = new Map<string, Turn>();
  private animationFrameId: number | null = null;
  private readonly pacer = new FramePacer(PLAYBACK_FPS);
  // Renderer buffer is sized to the largest turn we've ever baked.
  // Smaller ones render into a viewport rect; we never reallocate
  // (setSize is expensive because canvas.width = N reallocates the
  // WebGL drawing buffer).
  private rendererCapacityCss = 0;

  // Track loaded model URLs for this service
  private loadedModelUrls = new Set<string>();
  /** The sheets rendered ahead by their view (previewViewKey); empty when the manifest is missing */
  private sheets: Promise<Map<string, PreviewSheetEntry>> | null = null;

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
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = SRGBColorSpace;

    // Start animation loop
    this.startAnimationLoop();
  }

  /**
   * Show a model's turn on the provided canvas. The turn bakes on first
   * use and is reused by every later preview of the same model and view.
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

    const view = previewViewKey(config);
    const sheet = (await this.sheetsByView()).get(view);
    let turn: Turn;
    if (sheet) {
      turn = this.sheetTurn(sheet);
    } else {
      const cssWidth = targetCanvas.getBoundingClientRect?.().width ?? 0;
      const size = bakeSize(targetCanvas.width, targetCanvas.height, cssWidth);
      const key = turnKey(view, size);
      turn = this.turns.get(key) ?? this.startTurn(config, size);
      this.turns.set(key, turn);
    }
    this.previews.set(id, { canvas: targetCanvas, turn, config, shown: -1 });

    if (turn.job && !turn.job.loaded) await this.loadModel(turn.job, config);
  }

  /** The manifest of the sheets rendered ahead, read once */
  private sheetsByView(): Promise<Map<string, PreviewSheetEntry>> {
    this.sheets ??= fetch(PREVIEW_MANIFEST)
      .then((response) => (response.ok ? (response.json() as Promise<PreviewSheetManifest>) : null))
      .then((manifest) => {
        const byView = new Map<string, PreviewSheetEntry>();
        // A manifest of another frame count or layout plays wrong: none then, every turn bakes
        if (manifest?.frames !== TURN_FRAMES || manifest.columns !== SHEET_COLUMNS) return byView;
        for (const entry of Object.values(manifest.sheets)) byView.set(entry.view, entry);
        return byView;
      })
      .catch(() => new Map<string, PreviewSheetEntry>());
    return this.sheets;
  }

  /**
   * The turn of a sheet rendered ahead: shown once its picture is decoded
   * (off the main thread, createImageBitmap); until then the preview stays empty.
   */
  private sheetTurn(entry: PreviewSheetEntry): Turn {
    const key = `sheet:${entry.file}`;
    const known = this.turns.get(key);
    if (known) return known;
    const placeholder = document.createElement('canvas');
    const turn: Turn = { sheet: placeholder, width: entry.width, height: entry.height, baked: 0, job: null };
    this.turns.set(key, turn);
    void fetch(`${PREVIEW_SHEET_DIR}/${entry.file}`)
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(String(response.status)))))
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        turn.sheet = bitmap;
        turn.baked = TURN_FRAMES;
      })
      .catch((error) => console.error(`[ModelPreview] Failed to load sheet: ${entry.file}`, error));
    return turn;
  }

  /**
   * Bake a whole turn at once, for the sheets rendered ahead
   * (tools/preview-sheets/bake.ts): the sheet's canvas, TURN_FRAMES frames in
   * SHEET_COLUMNS columns, each `size` large.
   */
  async bakeSheet(config: PreviewConfig, size: { width: number; height: number }): Promise<HTMLCanvasElement> {
    if (!this.renderer) this.initialize();
    const turn = this.startTurn(config, size);
    await this.loadModel(turn.job!, config);
    const sheet = turn.sheet as HTMLCanvasElement;
    this.bakeFrames(turn, TURN_FRAMES);
    return sheet;
  }

  /** A turn to bake: its scene, camera, lights and an empty sheet */
  private startTurn(config: PreviewConfig, size: { width: number; height: number }): Turn {
    const scene = new Scene();
    if (config.backgroundColor !== undefined) {
      scene.background = new Color(config.backgroundColor);
    }

    const camera = new PerspectiveCamera(45, size.width / size.height, 0.1, 100);
    const distance = config.cameraDistance ?? 5;
    const angle = config.cameraAngle ?? Math.PI / 6; // 30 degrees default
    camera.position.set(0, Math.sin(angle) * distance, Math.cos(angle) * distance);
    camera.lookAt(0, 0, 0);

    scene.add(new AmbientLight(0xffffff, 0.6));
    const directionalLight = new DirectionalLight(0xffffff, config.lightIntensity ?? 1.0);
    directionalLight.position.set(2, 4, 3);
    scene.add(directionalLight);
    // Rim light for better definition
    const rimLight = new DirectionalLight(0x88ccff, 0.3);
    rimLight.position.set(-2, 1, -2);
    scene.add(rimLight);

    const sheet = document.createElement('canvas');
    sheet.width = size.width * SHEET_COLUMNS;
    sheet.height = size.height * Math.ceil(TURN_FRAMES / SHEET_COLUMNS);
    return { sheet, width: size.width, height: size.height, baked: 0, job: { scene, camera, pivot: null, mixer: null, loaded: false } };
  }

  /**
   * Load a model into a turn's scene.
   */
  private async loadModel(job: BakeJob, config: PreviewConfig): Promise<void> {
    const modelUrl = config.modelUrl;
    try {
      // Load via AssetManager (cached)
      const needsAnimation = !!config.animationName;
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

      const scale = config.scale ?? 1;
      model.scale.set(scale, scale, scale);

      // Measure after scaling, in the pose the preview shows
      const { box, mixer } = measurePreviewModel(model, cachedModel.animations, config);
      job.mixer = mixer;
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());

      // Center the model horizontally, optionally ground it
      model.position.x = -center.x;
      model.position.z = -center.z;

      let lookAtY = 0;
      if (config.groundModel) {
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
      job.scene.add(pivot);
      job.pivot = pivot; // Rotate the pivot, not the model

      // Camera looks at model center
      const maxDim = Math.max(size.x, size.y, size.z);
      const fov = job.camera.fov * (Math.PI / 180);
      const autoDistance = maxDim / (2 * Math.tan(fov / 2)) * 1.8;

      const finalDistance = config.cameraDistance ?? autoDistance;
      const angle = config.cameraAngle ?? Math.PI / 6;
      const offsetY = config.offsetY ?? 0;
      const targetY = lookAtY + offsetY;
      job.camera.position.set(
        0,
        targetY + Math.sin(angle) * finalDistance,
        Math.cos(angle) * finalDistance
      );
      job.camera.lookAt(0, targetY, 0);
    } catch (error) {
      console.error(`[ModelPreview] Failed to load model: ${modelUrl}`, error);
    } finally {
      job.loaded = true;
    }
  }

  /**
   * Bake the next frames of a turn: the model turned by the frame's share of
   * a full turn, the clip advanced by the frame's time, rendered and copied
   * into the turn's cell of the sheet. The copy out of WebGL happens here
   * only, TURN_FRAMES times per turn.
   */
  private bakeFrames(turn: Turn, count: number): void {
    const job = turn.job;
    if (!this.renderer || !job) return;
    const { width, height } = turn;
    if (Math.max(width, height) > this.rendererCapacityCss) {
      this.rendererCapacityCss = Math.max(width, height);
      this.renderer.setSize(this.rendererCapacityCss, this.rendererCapacityCss, false);
    }
    const capacity = this.rendererCapacityCss;
    // Render into the TOP of the buffer (high WebGL y == 2D-image y=0).
    this.renderer.setViewport(0, capacity - height, width, height);
    this.renderer.setScissor(0, capacity - height, width, height);
    this.renderer.setScissorTest(true);
    // A turn that bakes has a canvas for its sheet (startTurn)
    const ctx = (turn.sheet as HTMLCanvasElement).getContext('2d');
    const frameSeconds = 1 / PLAYBACK_FPS;
    for (let i = 0; i < count && turn.baked < TURN_FRAMES; i++) {
      const frame = turn.baked;
      if (job.pivot) job.pivot.rotation.y = (frame / TURN_FRAMES) * Math.PI * 2;
      if (frame > 0) job.mixer?.update(frameSeconds);
      this.renderer.render(job.scene, job.camera);
      const [x, y] = sheetCell(frame, width, height);
      ctx?.drawImage(this.renderer.domElement, 0, 0, width, height, x, y, width, height);
      turn.baked++;
    }
    if (turn.baked >= TURN_FRAMES) {
      this.disposeJob(job);
      turn.job = null;
    }
  }

  /** Copy a preview's frame of its turn onto its canvas, when it changed */
  private drawPreview(preview: PreviewInstance, frame: number): void {
    if (frame < 0 || frame === preview.shown) return;
    const ctx = preview.canvas.getContext('2d');
    if (!ctx) return;
    const { sheet, width, height } = preview.turn;
    ctx.clearRect(0, 0, preview.canvas.width, preview.canvas.height);
    const [x, y] = sheetCell(frame, width, height);
    ctx.drawImage(sheet, x, y, width, height, 0, 0, preview.canvas.width, preview.canvas.height);
    preview.shown = frame;
  }

  /**
   * Start the loop: turns still baking get a few frames each display frame,
   * the previews step at PLAYBACK_FPS.
   */
  private startAnimationLoop(): void {
    this.pacer.reset();
    const animate = (time: number) => {
      for (const turn of this.turns.values()) {
        if (turn.job?.loaded) this.bakeFrames(turn, BAKE_PER_FRAME);
      }
      if (this.pacer.shouldRun(time)) {
        for (const preview of this.previews.values()) {
          // Nothing can show a canvas that has left the DOM (its card
          // re-rendered, until the next re-init destroys the preview) or one
          // its host reports hidden
          if (!preview.canvas.isConnected || preview.config.isHidden?.()) continue;
          this.drawPreview(preview, turnFrameAt(time, preview.turn.baked));
        }
      }
      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.animationFrameId = requestAnimationFrame(animate);
  }

  /**
   * Destroy a specific preview. Its turn stays for the next preview of the
   * same model and view.
   */
  destroyPreview(id: string): void {
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

    this.previews.clear();
    for (const turn of this.turns.values()) {
      if (turn.job) this.disposeJob(turn.job);
      // A sheet's decoded picture (sheetTurn); a baked turn's canvas has no close
      if ('close' in turn.sheet) turn.sheet.close();
    }
    this.turns.clear();

    // Release model references from AssetManager
    for (const url of this.loadedModelUrls) {
      this.assetManager.releaseModel(url);
    }
    this.loadedModelUrls.clear();

    // Dispose renderer
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
      this.rendererCapacityCss = 0;
    }
  }

  /** Drop a bake's scene: the model's geometry and materials, the lights, the clip */
  private disposeJob(job: BakeJob): void {
    job.mixer?.stopAllAction();
    if (job.pivot) {
      job.scene.remove(job.pivot);
      this.disposeObject(job.pivot);
    }
    job.scene.traverse((obj) => {
      if (obj instanceof Light) {
        obj.dispose?.();
      }
    });
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

/** The same model seen the same way (previewViewKey) at the same size bakes the same turn */
function turnKey(view: string, size: { width: number; height: number }): string {
  return JSON.stringify([view, size.width, size.height]);
}

/** Top-left of a frame's cell on its turn's sheet */
function sheetCell(frame: number, width: number, height: number): [number, number] {
  return [(frame % SHEET_COLUMNS) * width, Math.floor(frame / SHEET_COLUMNS) * height];
}
