import { ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { PCFShadowMap, PerspectiveCamera, SRGBColorSpace, Scene, Timer, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createDemoMap } from '../demo-map';
import { CustomMapView } from '../render/custom-map-view';
import { MapAssetLibrary } from '../render/map-asset-library';
import { mapToScene } from '../render/map-coords';

/** Camera spots on the demo map: camera and target in map space (x, y, height) */
const VIEWS: Record<string, [number, number, number, number, number, number]> = {
  overview: [-60, -330, 260, 20, -40, 0],
  game: [40, -260, 170, 40, -120, 0],
  village: [-10, -210, 60, 60, -135, 0],
  river: [-120, -40, 30, -40, 20, 0],
  cliff: [60, 70, 45, 160, 160, 30],
  forest: [-200, 20, 40, -150, 80, 10],
  ground: [20, -100, 6, 45, -128, 2],
  trees: [30, -20, 12, 70, 20, 6],
  houses: [30, -115, 14, 55, -150, 2],
  bridge: [-70, -15, 14, -36, 22, 0],
};

/**
 * Dev page `/map-preview`: the demo map in the custom map renderer with an
 * orbit camera and frame numbers. `?view=village` picks a camera spot
 * (VIEWS), `?seed=3` another demo map. E2E probes read
 * `window.__mapPreview` (view, renderer, stats).
 */
@Component({
  selector: 'app-map-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #canvas class="canvas"></canvas>
    <div class="stats">{{ stats() }}</div>
  `,
  styles: `
    :host { position: fixed; inset: 0; display: block; background: var(--td-bg-dark); }
    .canvas { width: 100%; height: 100%; display: block; }
    .stats {
      position: absolute; left: 8px; top: 8px; padding: 4px 8px;
      font-size: var(--td-fs-small); line-height: 1.4;
      color: var(--td-text-primary); background: var(--td-panel-shadow);
      white-space: pre; pointer-events: none;
    }
  `,
})
export class MapPreviewComponent implements OnDestroy {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly zone = inject(NgZone);
  readonly stats = signal('lädt …');
  private renderer: WebGLRenderer | null = null;
  private view: CustomMapView | null = null;
  private controls: OrbitControls | null = null;
  private frame = 0;
  private stopped = false;

  constructor() {
    afterNextRender(() => this.zone.runOutsideAngular(() => void this.start()));
  }

  ngOnDestroy(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.controls?.dispose();
    this.view?.dispose();
    this.renderer?.dispose();
  }

  private async start(): Promise<void> {
    const canvas = this.canvas().nativeElement;
    const params = new URLSearchParams(location.search);
    const renderer = new WebGLRenderer({
      canvas,
      // As the game's canvas (CANVAS_RENDERER_OPTIONS): the map must look right with log depth
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
      stencil: true,
    });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;

    const scene = new Scene();
    const camera = new PerspectiveCamera(55, 1, 0.5, 8000);
    const controls = new OrbitControls(camera, canvas);
    this.controls = controls;
    controls.enableDamping = true;

    const t0 = performance.now();
    const doc = createDemoMap(Number(params.get('seed') ?? 7));
    const tGen = performance.now() - t0;
    const view = new CustomMapView(doc, MapAssetLibrary.shared(), {
      anisotropy: renderer.capabilities.getMaxAnisotropy(),
    });
    this.view = view;
    scene.add(view.group);
    view.environment.apply(scene, renderer);

    const spot = VIEWS[params.get('view') ?? 'overview'] ?? VIEWS['overview'];
    const lift = (x: number, y: number, h: number): Vector3 => mapToScene(x, y, view.heightAt(x, y) + h, new Vector3());
    camera.position.copy(lift(spot[0], spot[1], spot[2]));
    controls.target.copy(lift(spot[3], spot[4], spot[5]));
    controls.update();

    const resize = (): void => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    const timer = new Timer();
    let frames = 0;
    let fpsTime = performance.now();
    let fps = 0;
    let ready = false;
    let tReady = 0;
    void view.ready.then(() => {
      ready = true;
      tReady = performance.now() - t0;
    });
    (window as unknown as { __mapPreview: unknown }).__mapPreview = {
      view,
      renderer,
      camera,
      controls,
      isReady: () => ready,
      frames: () => frames,
    };

    const loop = (): void => {
      if (this.stopped) return;
      this.frame = requestAnimationFrame(loop);
      timer.update();
      controls.update();
      view.update(timer.getDelta(), camera, controls.target);
      renderer.render(scene, camera);
      frames++;
      const now = performance.now();
      if (now - fpsTime > 500) {
        fps = ((frames - (this.lastFrames ?? 0)) * 1000) / (now - fpsTime);
        this.lastFrames = frames;
        fpsTime = now;
        const info = renderer.info.render;
        this.zone.run(() =>
          this.stats.set(
            `${doc.meta.name}  ${ready ? 'bereit' : 'lädt'}\n` +
              `${fps.toFixed(0)} fps  ${info.calls} draws  ${(info.triangles / 1000).toFixed(0)}k tris\n` +
              `Objekte ${doc.objects.length}  Generator ${tGen.toFixed(0)} ms  geladen ${tReady.toFixed(0)} ms`,
          ),
        );
      }
    };
    loop();
  }

  private lastFrames: number | null = null;
}
