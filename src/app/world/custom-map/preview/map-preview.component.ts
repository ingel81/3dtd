import { QUALITY_TABLE, type QualityLevel } from '../../../three-engine/render-quality';
import { ChangeDetectionStrategy, Component, ElementRef, NgZone, OnDestroy, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { PCFShadowMap, PerspectiveCamera, SRGBColorSpace, Scene, Timer, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PostProcessingPipeline } from '../../../three-engine/post-processing/post-processing-pipeline';
import { createDemoMap } from '../demo-map';
import { createPerfMap } from '../perf-map';
import type { MapBiome } from '../map-document';
import { createAssetShowcase } from './asset-showcase';
import { MapStore } from '../map-store';
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
  edge: [-180, 60, 60, -330, 170, 0],
  falls: [110, -150, 18, 130, -108, 8],
  stream: [-110, -110, 30, -90, -60, 0],
  glare: [140, 60, 45, 40, -40, 0],
  showcase: [0, -150, 30, 0, -80, 0],
};

/**
 * Dev page `/map-preview`: the demo map in the custom map renderer with an
 * orbit camera and frame numbers. `?view=village` picks a camera spot
 * (VIEWS), `?seed=3` another demo map, `?sky=dusk` another sky preset,
 * `?weather=rain|snow|fog` (`&strength=0.7`), `?effects=refraction,seaWaves` (map-effects.ts), `?quality=low|medium|high|ultra` (the level's custom map knobs, render-quality.ts), `?biome=hell|moon|mars|arctic|…`, `?post=bloom` through the game's
 * post-processing chain. `?showcase=winter` (a catalogue tag) or
 * `?assets=tree-*,rock-large&materials=snow,ice` lines up catalogue assets on a
 * flat map instead (asset-showcase.ts). `?map=<id>` shows a shipped map instead
 * of the demo valley, `?cam=x,y,h,tx,ty,th` puts the camera and its target at
 * map points (heights over the ground there), `?clean` hides the numbers. E2E probes read
 * `window.__mapPreview` (view, renderer, stats).
 */
@Component({
  selector: 'app-map-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #canvas class="canvas"></canvas>
    @if (!clean) {
      <div class="stats">{{ stats() }}</div>
    }
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
  readonly clean = new URLSearchParams(location.search).has('clean');
  private renderer: WebGLRenderer | null = null;
  private view: CustomMapView | null = null;
  private controls: OrbitControls | null = null;
  private post: PostProcessingPipeline | null = null;
  private resize: (() => void) | null = null;
  private frame = 0;
  /** The page went (ngOnDestroy): a start still loading its map builds nothing more */
  private stopped = false;

  constructor() {
    afterNextRender(() => this.zone.runOutsideAngular(() => void this.start()));
  }

  ngOnDestroy(): void {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    if (this.resize) window.removeEventListener('resize', this.resize);
    this.resize = null;
    this.post?.dispose();
    this.post = null;
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
    const showcase = params.get('showcase') ?? undefined;
    const assets = params.get('assets')?.split(',');
    const showMaterials = params.get('materials')?.split(',');
    const mapId = params.get('map');
    const doc = mapId
      ? (await new MapStore().load(mapId, 'shipped')).doc
      : showcase || assets || showMaterials
        ? createAssetShowcase(await MapAssetLibrary.shared().catalog(), {
            tag: showcase,
            objects: assets,
            materials: showMaterials,
          })
        : params.get('big')
          ? createPerfMap(Number(params.get('big')), Number(params.get('objects') ?? 20000))
          : createDemoMap(Number(params.get('seed') ?? 7));
    // Left while the map loaded: ngOnDestroy took renderer and controls already, nothing more is built
    if (this.stopped) return;
    const tGen = performance.now() - t0;
    const weather = params.get('weather');
    if (weather === 'rain' || weather === 'snow' || weather === 'fog') {
      doc.environment.weather = weather;
      doc.environment.weatherStrength = Number(params.get('strength') ?? 0.7);
    }
    const biome = params.get('biome');
    if (biome) doc.environment.biome = biome as MapBiome;
    const sky = params.get('sky');
    if (sky === 'day' || sky === 'dusk' || sky === 'night' || sky === 'overcast') {
      doc.environment.sky = sky;
      if (sky === 'dusk') doc.environment.sunElevation = 9;
    }
    // `?effects=refraction,seaWaves,lavaGlow,shadowCascade` turns on the switchable effects (map-effects.ts)
    const effects = Object.fromEntries((params.get('effects') ?? '').split(',').filter(Boolean).map((e) => [e, true]));
    const view = new CustomMapView(doc, MapAssetLibrary.shared(), {
      anisotropy: renderer.capabilities.getMaxAnisotropy(),
      renderer,
      effects,
    });
    this.view = view;
    // `?quality=ultra`: a quality level's custom map knobs (grass, shadows, detail, effects)
    const level = params.get('quality');
    if (level && level in QUALITY_TABLE) view.applyQuality(QUALITY_TABLE[level as QualityLevel].customMaps);
    view.attach(scene);
    view.environment.apply(scene, renderer);

    const cam = params.get('cam')?.split(',').map(Number);
    const spot =
      cam?.length === 6 && cam.every(Number.isFinite)
        ? (cam as [number, number, number, number, number, number])
        : (VIEWS[params.get('view') ?? (doc.meta.id === 'asset-showcase' ? 'showcase' : 'overview')] ?? VIEWS['overview']);
    const lift = (x: number, y: number, h: number): Vector3 => mapToScene(x, y, view.heightAt(x, y) + h, new Vector3());
    camera.position.copy(lift(spot[0], spot[1], spot[2]));
    controls.target.copy(lift(spot[3], spot[4], spot[5]));
    controls.update();

    // ?post=bloom|grade: through the game's post-processing chain, as the map renders in the game
    const postMode = params.get('post');
    const post = postMode ? new PostProcessingPipeline(renderer, scene, camera) : null;
    this.post = post;
    if (post && postMode === 'bloom') post.setBloomEnabled(true);
    if (post && postMode === 'grade') post.setColorGradingPreset('warm-sunset');

    const resize = (): void => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      post?.setSize(w, h);
    };
    resize();
    this.resize = resize;
    window.addEventListener('resize', resize);

    const timer = new Timer();
    let frames = 0;
    let fpsTime = performance.now();
    let fps = 0;
    let ready = false;
    let tReady = 0;
    let programs = 0;
    void view.ready
      .then(() => view.warmUp(renderer, scene, camera))
      .then((n) => {
        programs = n;
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
      if (post?.needsRender()) post.render();
      else renderer.render(scene, camera);
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
              `Objekte ${doc.objects.length}  Generator ${tGen.toFixed(0)} ms  geladen ${tReady.toFixed(0)} ms  Shader ${programs}`,
          ),
        );
      }
    };
    loop();
  }

  private lastFrames: number | null = null;
}
