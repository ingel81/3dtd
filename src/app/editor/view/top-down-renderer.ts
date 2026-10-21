/**
 * The map from straight above into a canvas: the minimap, the PNG download,
 * stamps and the agent's picture, drawn by the view's renderer into a target
 * of its own.
 */
import { OrthographicCamera, SRGBColorSpace, WebGLRenderTarget, type Group, type Scene, type WebGLRenderer } from 'three';
import type { MapTerrain } from '../../world/custom-map/map-document';
import { mapToScene, type EditorMapView } from './map-view';
import type { ProgramWarmup } from './program-warmup';

export interface TopDownHost {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly warmup: ProgramWarmup;
  /** Spawns, HQ and road markers (shown on request) */
  readonly overlay: Group;
  /** What a picture from above leaves out (the trial wave) */
  readonly hidden: Group;
  /** The map view now (the flush may rebuild it) */
  view(): EditorMapView;
  terrain(): MapTerrain;
  /** Hands the waiting changes to the view, so the picture shows them */
  flush(): void;
}

export class TopDownRenderer {
  constructor(private readonly host: TopDownHost) {}

  /**
   * `overlay` adds spawns, HQ and roads' markers. Once its programs are
   * built (ProgramWarmup.topDownReady); the pixels come back without
   * waiting for the GPU (readRenderTargetPixelsAsync): a synchronous read
   * held the main thread 65 to 140 ms until the whole map was drawn, after
   * every stroke (the minimap)
   */
  async render(width: number, height = width, overlay = false, area?: { x0: number; y0: number; x1: number; y1: number }): Promise<HTMLCanvasElement> {
    const h = this.host;
    await h.warmup.topDownReady;
    if (h.warmup.gone) throw new Error('The view is gone');
    const { renderer, scene } = h;
    const t = h.terrain();
    h.flush();
    const view = h.view();
    const a = area ?? { x0: -t.width / 2, y0: -t.depth / 2, x1: t.width / 2, y1: t.depth / 2 };
    const hw = Math.abs(a.x1 - a.x0) / 2;
    const hd = Math.abs(a.y1 - a.y0) / 2;
    const cam = new OrthographicCamera(-hw, hw, hd, -hd, 1, 20000);
    const c = mapToScene((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2, 0);
    cam.position.set(c.x, 5000, c.z);
    // North (+z) at the top, east (-x) to the right
    cam.up.set(0, 0, 1);
    cam.lookAt(c.x, 0, c.z);
    const target = new WebGLRenderTarget(width, height, { colorSpace: SRGBColorSpace });
    const fog = scene.fog;
    scene.fog = null;
    // Put back as they were after: someone else may hold the overlay hidden
    const overlayShown = h.overlay.visible;
    h.overlay.visible = overlay;
    // Particles and glows seen from above would cover the ground as a bright square
    view.setParticlesVisible(false);
    h.hidden.visible = false;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
    view.setParticlesVisible(true);
    h.hidden.visible = true;
    const pixels = new Uint8Array(width * height * 4);
    const read = renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, pixels);
    renderer.setRenderTarget(null);
    h.overlay.visible = overlayShown;
    scene.fog = fog;
    try {
      await read;
    } finally {
      target.dispose();
    }
    if (h.warmup.gone) throw new Error('The view is gone');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const c2d = canvas.getContext('2d')!;
    const image = c2d.createImageData(width, height);
    // Render targets read bottom row first
    for (let row = 0; row < height; row++) {
      image.data.set(pixels.subarray((height - 1 - row) * width * 4, (height - row) * width * 4), row * width * 4);
    }
    c2d.putImageData(image, 0, 0);
    return canvas;
  }
}
