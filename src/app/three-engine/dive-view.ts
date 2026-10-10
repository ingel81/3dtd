import { Matrix4, PerspectiveCamera, Vector3, type Fog, type Material, type Mesh, type Texture, type WebGLRenderer } from 'three';
import type { TilesRenderer } from '3d-tiles-renderer';
import { tilesPending } from './tiles-internals';

/** UnloadTilesPlugin's delay, which its typings leave out (0.5.2) */
interface UnloadDelay {
  delay: number;
}

/** The game's view distance, fog and refinement falloff at rest (keep in sync with the engine's) */
export const VIEW_DISTANCE = 8000;
export const FOG_NEAR = VIEW_DISTANCE * 0.25;
export const FOG_FAR = VIEW_DISTANCE * 0.75;
export const ERROR_FALLOFF = 24;
/** Hidden tiles keep their GPU data this long at rest (tiles-renderer-setup.ts) */
const UNLOAD_DELAY_MS = 2000;
/** And this long while a dive is warmed or flown: the warmed tiles must still be on the GPU when the camera comes */
const DIVE_UNLOAD_DELAY_MS = 60_000;

/** Waiting for a warm-up camera's tiles: idle this long counts as done */
const IDLE_MS = 300;
/** Main-thread time per frame the warm-up spends uploading tile textures */
const UPLOAD_BUDGET_MS = 4;

/**
 * The game camera's dive from the globe into the tiles and its rise back out
 * (docs/GLOBE_PLAN.md, Übergabe in Nadir-Sicht). Owned by the engine.
 *
 * - **Scale** `m` (altitude over the landing altitude, 1 at rest): view
 *   distance and fog grow with it, the refinement falloff shrinks with it
 *   (from high up every tile is "far", the falloff would leave all of them
 *   coarse). At m = 1 everything is what the game uses, so the landing has
 *   no jump.
 * - **Warm-up**: cameras along the dive's path registered with the tiles
 *   renderer one after another, each until its tiles are loaded. Together
 *   they would mix their levels of detail (the renderer refines for the
 *   most demanding camera), so a coarse view's own tiles would never load.
 */
export class DiveView {
  /** Longest off-screen draw of a warm-up step, ms (`__globe.timing()`) */
  static readonly timing: { prerender?: number } = {};

  private scale = 1;
  private holding = false;
  private warmCamera: PerspectiveCamera | null = null;
  /** The warm-up under way, and the number of the latest asked for */
  private warming: Promise<void> = Promise.resolve();
  private warmToken = 0;
  private disposed = false;

  constructor(
    private readonly deps: {
      tiles: () => TilesRenderer | null;
      renderer: WebGLRenderer;
      camera: PerspectiveCamera;
      fog: () => Fog | null;
      /** Draw the scene once from `camera`, off screen: its tiles go to the GPU now, not when the dive shows them */
      prerender: (camera: PerspectiveCamera) => void;
    },
  ) {}

  /** The current scale, 1 at rest */
  get m(): number {
    return this.scale;
  }

  /**
   * Set the scale for the camera's altitude (see class). Hidden tiles stay
   * on the GPU while m > 1 or a warm-up holds them.
   */
  setScale(m: number): void {
    this.scale = Math.max(1, m);
    const fog = this.deps.fog();
    if (fog) {
      fog.near = FOG_NEAR * this.scale;
      fog.far = FOG_FAR * this.scale;
    }
    const tiles = this.deps.tiles();
    if (tiles) tiles.errorFalloff = ERROR_FALLOFF / this.scale;
    this.updateUnloadDelay();
  }

  /** The far plane the camera needs at this scale */
  viewDistance(): number {
    return VIEW_DISTANCE * this.scale;
  }

  /**
   * Load the tiles each pose (a camera world matrix in the scene's frame)
   * sees, one pose after the other, each until nothing is queued, downloading
   * or parsing for `IDLE_MS`, or `stepTimeoutMs` passed. Resolves when all
   * are done; the warmed tiles stay on the GPU until release().
   */
  warm(poses: readonly Matrix4[], stepTimeoutMs = 6000): Promise<void> {
    // One warm-up at a time: a newer one ends the one before at its next step
    const token = ++this.warmToken;
    const before = this.warming;
    this.warming = before.then(() => this.warmNow(poses, stepTimeoutMs, token));
    return this.warming;
  }

  private async warmNow(poses: readonly Matrix4[], stepTimeoutMs: number, token: number): Promise<void> {
    const tiles = this.deps.tiles();
    if (!tiles) return;
    const current = () => !this.disposed && token === this.warmToken;
    this.holding = true;
    this.updateUnloadDelay();
    // The dive flies without the falloff high up; warm the same tiles it will show
    tiles.errorFalloff = 0;
    const scale = new Vector3();
    try {
      for (const pose of poses) {
        if (!current()) return;
        const camera = new PerspectiveCamera(this.deps.camera.fov, this.deps.camera.aspect, 1, 1e7);
        pose.decompose(camera.position, camera.quaternion, scale);
        camera.updateMatrixWorld(true);
        this.warmCamera = camera;
        tiles.setCamera(camera);
        tiles.setResolutionFromRenderer(camera, this.deps.renderer);
        await this.untilIdle(tiles, stepTimeoutMs, current);
        // Textures first, a few per frame: one step can bring a hundred of them
        if (current()) await this.uploadTextures(tiles, current);
        if (current()) {
          const t0 = performance.now();
          this.deps.prerender(camera);
          DiveView.timing.prerender = Math.max(DiveView.timing.prerender ?? 0, performance.now() - t0);
        }
        tiles.deleteCamera(camera);
        this.warmCamera = null;
      }
    } finally {
      if (this.warmCamera) tiles.deleteCamera(this.warmCamera);
      this.warmCamera = null;
      tiles.errorFalloff = ERROR_FALLOFF / this.scale;
    }
  }

  /** The warmed tiles may leave the GPU again (after the dive) */
  release(): void {
    this.holding = false;
    this.updateUnloadDelay();
  }

  private updateUnloadDelay(): void {
    const unload = this.deps.tiles()?.getPluginByName('UNLOAD_TILES_PLUGIN') as UnloadDelay | null | undefined;
    if (unload) unload.delay = this.holding || this.scale > 1 ? DIVE_UNLOAD_DELAY_MS : UNLOAD_DELAY_MS;
  }

  /** Textures the warm-up uploaded; a tile's texture goes up once */
  private readonly uploaded = new WeakSet<Texture>();

  /**
   * Upload the textures of the tiles shown now (for the warm camera and the
   * game's), UPLOAD_BUDGET_MS a frame, so the off-screen draw after it only
   * moves geometry and the globe in front keeps its frames.
   */
  private uploadTextures(tiles: TilesRenderer, current: () => boolean): Promise<void> {
    const queue: Texture[] = [];
    tiles.group.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh || !mesh.visible) return;
      for (const material of (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as (Material & { map?: Texture | null })[]) {
        const map = material?.map;
        if (map && !this.uploaded.has(map)) {
          this.uploaded.add(map);
          queue.push(map);
        }
      }
    });
    return new Promise((resolve) => {
      const step = () => {
        if (!current()) return resolve();
        const start = performance.now();
        while (queue.length > 0 && performance.now() - start < UPLOAD_BUDGET_MS) {
          this.deps.renderer.initTexture(queue.pop()!);
        }
        if (queue.length === 0) return resolve();
        requestAnimationFrame(step);
      };
      step();
    });
  }

  private untilIdle(tiles: TilesRenderer, timeoutMs: number, current: () => boolean): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      let idleSince: number | null = null;
      // A frame or two must pass before the traversal has seen the camera
      let frames = 0;
      let sawBusy = false;
      const check = () => {
        if (!current()) return resolve();
        const now = performance.now();
        const busy = tilesPending(tiles) > 0;
        sawBusy ||= busy;
        frames++;
        // Everything this camera sees was there already: done
        if (!sawBusy && frames >= 4) return resolve();
        if (busy || frames < 3) idleSince = null;
        else idleSince ??= now;
        if ((idleSince !== null && now - idleSince >= IDLE_MS) || now - start > timeoutMs) return resolve();
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  }

  dispose(): void {
    this.disposed = true;
    const tiles = this.deps.tiles();
    if (tiles && this.warmCamera) tiles.deleteCamera(this.warmCamera);
    this.warmCamera = null;
  }
}
