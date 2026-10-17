/**
 * The editor's 3D view: its own renderer, scene and camera, independent of
 * the game's engine, and the frame loop. The parts do the rest: InputRouter
 * (pointer, wheel, keys to the tool or the camera), ViewPicker (what lies
 * under a screen point), ChangeApplier (the document's change notices to the
 * map view and the overlay, once a frame), ProgramWarmup (shader programs
 * ahead), TopDownRenderer (the map from above) and ViewExtras (trial wave,
 * sound, intro flight, game view).
 */
import { PCFShadowMap, PerspectiveCamera, SRGBColorSpace, Scene, Vector3, WebGLRenderer } from 'three';
import type { MapIntroView, MapObject, MapPoint } from '../../world/custom-map/map-document';
import { type BridgeDeck, bridgeDecks, deckHeightAt } from '../../world/custom-map/bridge-decks';
import { HeightField } from '../../world/custom-map/render/height-field';
import { waterLevelAt } from '../../world/custom-map/water-level';
import { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import { selectedEdges, selectedNodes, selectedSpawns, type EditorDocument, type Selection } from '../model/editor-document';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { heightAt as gridHeight } from '../../map-ops/grid';
import { dominantLayer } from '../../map-ops/paint-ops';
import { edgePolyline } from '../../map-ops/path-graph';
import type { EditorSettings, EditorTool, MapHit, ToolContext } from '../tools/tool';
import { CameraController } from './camera-controller';
import { ChangeApplier } from './change-applier';
import { EditorOverlay } from './editor-overlay';
import { InputRouter } from './input-router';
import { EditorMapView, mapToScene } from './map-view';
import { ProgramWarmup } from './program-warmup';
import { TopDownRenderer } from './top-down-renderer';
import { EDITOR_FOV, ViewExtras } from './view-extras';
import { ViewPicker } from './view-picker';
import { pixelRatioFor, readStoredQuality, storedKnobsFor, type QualityKnobs } from '../../three-engine/render-quality';
import { contourLines } from '../ops/contours';

export interface HoverInfo {
  x: number;
  y: number;
  height: number;
  material: string;
}

export interface CameraBookmark {
  x: number;
  y: number;
  z: number;
  distance: number;
  yaw: number;
  pitch: number;
}

export interface FrameStats {
  fps: number;
  triangles: number;
  drawCalls: number;
}

export interface ViewportCallbacks {
  status(message: string): void;
  /** The tool's line of help says something new */
  hintChanged(): void;
  box(box: { x0: number; y0: number; x1: number; y1: number } | null): void;
  lasso(points: readonly { x: number; y: number }[] | null): void;
  hover(info: HoverInfo | null): void;
  stats(stats: FrameStats): void;
  /** The camera moved (minimap frame) */
  camera(): void;
  /** The map's models and textures are in and its programs compiled */
  viewReady(): void;
  /** The WebGL context went (a driver reset, the GPU process restarted) or came back with a rebuilt view */
  contextLost(lost: boolean): void;
  /** The view painted its path mask from the map as it is now: the editor's worker keeps it from there (EditorPathMask) */
  pathMaskBuilt(view: EditorMapView): void;
  /** The view laid new roads or water: the path mask's texels that changed come from the worker */
  pathMaskChanged(): void;
}

export class EditorViewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(EDITOR_FOV, 1, 1, 20000);
  readonly controller = new CameraController();
  readonly overlay: EditorOverlay;
  view: EditorMapView;
  readonly ctx: ToolContext;
  readonly input: InputRouter;
  readonly picker: ViewPicker;
  readonly changes: ChangeApplier;
  readonly warmup: ProgramWarmup;
  readonly topDown: TopDownRenderer;
  readonly extras: ViewExtras;
  /** The bridge decks of the map as it stands, laid again after a change (walkHeightAt) */
  private decks: BridgeDeck[] | null = null;
  /** The symmetry the guides show, and whether the ground under them moved */
  private guideMode: string | null = null;
  /** What the height lines and grid show, and when they were drawn */
  private overlayKey = '';
  private overlayTime = 0;
  /** The hidden categories the view last showed */
  private hiddenKey = '';
  private raf = 0;
  private lastTime = 0;
  private frames = 0;
  private statsTime = 0;
  private hoverTime = 0;
  private readonly unsubscribe: (() => void)[] = [];
  private readonly resizeObserver: ResizeObserver;
  /** The game's quality level for custom maps (render-quality.ts) */
  private readonly quality: QualityKnobs;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly editor: EditorDocument,
    readonly catalog: CatalogIndex,
    readonly settings: EditorSettings,
    private readonly callbacks: ViewportCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: false });
    // The custom-map part of the game's quality level with the player's overrides, at a fixed resolution
    // (no dynamic one) and always MSAA
    this.quality = storedKnobsFor(readStoredQuality(), gpuNameOf(this.renderer), 'custom-map');
    this.renderer.setPixelRatio(pixelRatioFor({ ...this.quality, general: { ...this.quality.general, scale: 1 } }, 'custom-map', window.devicePixelRatio));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    MapAssetLibrary.useCompressedTextures(this.renderer);
    const heightAt = (x: number, y: number) => this.heightAt(x, y);
    const walkHeightAt = (x: number, y: number) => this.walkHeightAt(x, y);
    this.overlay = new EditorOverlay(heightAt, walkHeightAt);
    this.view = this.makeView();
    this.warmup = new ProgramWarmup(this.renderer, this.scene, this.camera, () => this.view);
    void this.warmup.view(() => callbacks.viewReady());
    this.scene.add(this.overlay.group);
    void this.warmup.overlay(this.overlay.group);
    this.extras = new ViewExtras({
      editor,
      camera: this.camera,
      controller: this.controller,
      heightAt,
      surfaceAt: (x, y) => this.surfaceAt(x, y),
      walkHeightAt,
      darkness: () => this.view.view.environment.darkness,
      status: (m) => callbacks.status(m),
    });
    this.scene.add(this.extras.trial.runners.group);
    this.picker = new ViewPicker(canvas, this.camera, this.controller, editor, catalog, this.overlay.tool.gizmo.handles, () => this.view, heightAt);
    this.ctx = this.buildContext();
    this.input = new InputRouter({
      canvas,
      controller: this.controller,
      editor,
      settings,
      ctx: this.ctx,
      fov: () => this.camera.fov,
      ground: (x, y) => this.picker.ground(x, y),
      interrupt: () => this.extras.intro.stop(),
      left: () => callbacks.hover(null),
    });
    this.changes = new ChangeApplier({
      rebuild: () => this.rebuildView(),
      layers: () => this.view.updateLayers(),
      heights: (rect) => this.view.updateHeights(rect),
      splat: (rect) => this.view.updateSplat(rect),
      water: () => {
        this.view.updateWater();
        this.callbacks.pathMaskChanged();
      },
      waterBody: (k, rect) => this.view.updateWaterBody(k, rect),
      objects: (ids) => (ids === 'all' ? this.view.setObjects() : this.view.objectsChanged(ids)),
      paths: () => {
        this.view.updatePaths();
        this.callbacks.pathMaskChanged();
      },
      environment: () => this.view.setEnvironment(),
      life: () => this.view.setLife(),
      soundChanged: () => this.extras.sound.mapChanged(),
      groundMoved: () => {
        this.guideMode = null;
        this.overlayKey = '';
      },
      redrape: () => this.overlay.redrape(),
      markers: () => {
        const doc = editor.doc;
        this.overlay.markers.set(doc, editor.selection);
        this.overlay.selection.set(doc, editor.selection, (asset) => catalog.object(asset).radius);
      },
      selection: () => this.overlay.selection.set(editor.doc, editor.selection, (asset) => catalog.object(asset).radius),
    });
    this.topDown = new TopDownRenderer({
      renderer: this.renderer,
      scene: this.scene,
      warmup: this.warmup,
      overlay: this.overlay.group,
      hidden: this.extras.trial.runners.group,
      view: () => this.view,
      terrain: () => editor.doc.terrain,
      flush: () => this.changes.flush(),
    });
    this.unsubscribe.push(
      editor.onChange((change) => {
        this.changes.add(change);
        this.decks = null;
      }),
      editor.onSelection(() => this.changes.selectionChanged()),
    );
    this.bindContext();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.frameMap(true);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  heightAt(x: number, y: number): number {
    return gridHeight(this.editor.doc.terrain, x, y);
  }

  /** The water's surface where water lies, else the ground: what the camera keeps above (CustomMapSurface.surfaceAtMap) */
  private surfaceAt(x: number, y: number): number {
    const ground = this.heightAt(x, y);
    return waterLevelAt(this.editor.doc.terrain, x, y, ground) ?? ground;
  }

  /**
   * Where an enemy walks at a map point: on a bridge deck where one spans
   * it, else on the ground. Routes and the trial wave go over a bridge, not
   * through the river under it. A preview: a road under a bridge shows its
   * walkers on the deck too, where the game keeps them on the ground
   * (CustomMapSurface.walkHeightAtMap, the route cut under the deck)
   */
  walkHeightAt(x: number, y: number): number {
    const { paths, terrain } = this.editor.doc;
    this.decks ??= bridgeDecks(paths, terrain, new HeightField(terrain.grid, terrain.width, terrain.depth));
    const deck = deckHeightAt(this.decks, x, y);
    return Number.isNaN(deck) ? this.heightAt(x, y) : deck;
  }

  setTool(tool: EditorTool): void {
    if (!this.input.setTool(tool)) return;
    this.overlay.brush.clear();
    // Road nodes are handles only where they are edited
    this.overlay.markers.setNodeHandles(tool.id === 'paths');
  }

  /** The whole document changed (opened another map, resized): rebuild the view */
  rebuildView(): void {
    this.decks = null;
    this.view.dispose();
    this.view = this.makeView();
    void this.warmup.view(() => this.callbacks.viewReady());
    // The new view shows everything until the hidden categories are applied again
    this.hiddenKey = '';
    this.changes.reset();
  }

  /** The map point the view looks at (the camera's target) */
  viewCenter(): { x: number; y: number } {
    const g = this.controller.goal.target;
    return { x: -g.x, y: g.z };
  }

  /** Where the camera looks from, to keep as a bookmark */
  cameraView(): CameraBookmark {
    const g = this.controller.goal;
    return { x: g.target.x, y: g.target.y, z: g.target.z, distance: g.distance, yaw: g.yaw, pitch: g.pitch };
  }

  /** Fly to a kept view; `snap` stands there at once (a view made anew) */
  showView(v: CameraBookmark, snap = false): void {
    const g = this.controller.goal;
    g.target.set(v.x, v.y, v.z);
    g.distance = v.distance;
    g.yaw = v.yaw;
    g.pitch = v.pitch;
    if (snap) this.controller.snap();
  }

  /** Where the camera stands and the point it looks at now, in map space (the intro's views) */
  introView(): MapIntroView {
    const c = this.camera.position;
    const t = this.controller.current.target;
    const r = (v: number) => Math.round(v * 100) / 100 || 0;
    return { x: r(-c.x), y: r(c.z), h: r(c.y), lookX: r(-t.x), lookY: r(t.z), lookH: r(t.y) };
  }

  /** Frame the whole map */
  frameMap(snap = false): void {
    const t = this.editor.doc.terrain;
    this.controller.maxDistance = Math.max(t.width, t.depth) * 3;
    this.controller.focus(new Vector3(0, this.heightAt(0, 0), 0), Math.max(t.width, t.depth) * 0.52);
    if (snap) this.controller.snap();
  }

  focusOn(p: MapPoint, radius = 60): void {
    this.controller.focus(mapToScene(p.x, p.y, this.heightAt(p.x, p.y)), radius);
  }

  /** Frame what is selected, else the whole map */
  focusSelection(): void {
    const focus = selectionFocus(this.editor.doc, this.editor.selection);
    if (focus) this.focusOn(focus.center, focus.radius);
    else this.frameMap();
  }

  dispose(): void {
    this.warmup.dispose();
    this.extras.dispose();
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const u of this.unsubscribe) u();
    this.input.dispose();
    this.view.dispose();
    this.overlay.dispose();
    this.renderer.dispose();
    // Browsers keep only a few WebGL contexts: give this one back now, not when it is collected
    this.renderer.forceContextLoss();
  }

  // -------------------------------------------------------------------------

  private makeView(): EditorMapView {
    const view = new EditorMapView(this.editor.doc, this.scene, this.renderer);
    view.view.applyQuality(this.quality.customMaps);
    view.onPathMaskBuilt(() => this.callbacks.pathMaskBuilt(view));
    return view;
  }

  private buildContext(): ToolContext {
    const p = this.picker;
    return {
      editor: this.editor,
      settings: this.settings,
      catalog: this.catalog,
      overlay: this.overlay.tool,
      heightAt: (x, y) => this.heightAt(x, y),
      pick: (q) => p.pick(q),
      status: (m) => this.callbacks.status(m),
      hintChanged: () => this.callbacks.hintChanged(),
      setBox: (b) => this.callbacks.box(b),
      setLasso: (points) => this.callbacks.lasso(points),
      objectVisible: (o) => this.objectVisible(o),
      pickGizmo: (q) => p.gizmo(q),
      metresPerPixel: (at) => p.metresPerPixel(at),
      toScreen: (x, y, z) => p.toScreen(x, y, z),
      boxToMap: (box) => p.boxToMap(box),
    };
  }

  /** The canvas's own events; pointer, wheel and keys go to the InputRouter */
  private bindContext(): void {
    const c = this.canvas;
    type CanvasEvents = HTMLElementEventMap & { webglcontextlost: WebGLContextEvent; webglcontextrestored: Event };
    const on = <K extends keyof CanvasEvents & string>(type: K, fn: (e: CanvasEvents[K]) => void) => {
      c.addEventListener(type, fn as EventListener);
      this.unsubscribe.push(() => c.removeEventListener(type, fn as EventListener));
    };
    on('contextmenu', (e) => e.preventDefault());
    // A driver reset takes the GPU's copies; the textures keep no pixels after their upload, so the view is built anew
    on('webglcontextlost', (e) => {
      e.preventDefault();
      this.callbacks.contextLost(true);
    });
    on('webglcontextrestored', () => {
      this.rebuildView();
      this.callbacks.contextLost(false);
    });
  }

  private resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // The resize cleared the drawing buffer after this frame's draw: drawn again, else the browser shows it black
    if (this.warmup.shows(this.view)) this.renderer.render(this.scene, this.camera);
  }

  private loop(time: number): void {
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = time;

    this.input.moveByKeys(dt);
    this.syncHidden();
    const t = this.editor.doc.terrain;
    const g = this.controller.goal.target;
    g.x = Math.max(-t.width / 2, Math.min(t.width / 2, g.x));
    g.z = Math.max(-t.depth / 2, Math.min(t.depth / 2, g.z));
    // On the water's surface over a lake or the sea, so a close view stays above it, not under it on the bed
    this.controller.setGroundHeight(this.surfaceAt(-g.x, g.z));
    if (this.controller.update(dt)) this.callbacks.camera();
    if (!this.extras.intro.frame(dt)) this.controller.apply(this.camera);
    // The map's haze starts behind what the camera looks at: from afar the whole map stays readable
    this.view.view.environment.setClearAir(this.controller.current.distance * 1.15);

    // One ground raycast per frame for the tool and the cursor
    const tp = this.input.frame(dt);
    this.changes.flush();
    this.refreshOverlays(time);
    if (this.guideMode !== this.settings.symmetry()) {
      this.guideMode = this.settings.symmetry();
      const t = this.editor.doc.terrain;
      this.overlay.guides.set(this.settings.symmetry(), t.width, t.depth);
    }

    const brush = this.settings.brush();
    const showBrush = !!tp?.hit && !!this.input.tool?.brushVisible(this.ctx);
    this.overlay.brush.set(showBrush ? tp!.hit : null, brush.radius, brush.falloff);
    this.overlay.setViewDistance(this.controller.current.distance);
    this.overlay.update(dt);
    this.view.view.setAnimationPaused(this.settings.view().still);
    this.view.update(dt, this.camera, this.controller.current.target);
    this.extras.update(dt);
    if (this.warmup.shows(this.view)) this.renderer.render(this.scene, this.camera);

    this.reportHover(time, tp?.hit ?? null);
    this.reportStats(time);
  }

  /** Height lines and grid, redrawn at most twice a second while the ground changes */
  private refreshOverlays(time: number): void {
    const v = this.settings.view();
    const key = `${v.contours}:${v.contourStep}:${v.grid}:${v.gridStep}`;
    if (key === this.overlayKey || time - this.overlayTime < 500) return;
    this.overlayKey = key;
    this.overlayTime = time;
    const t = this.editor.doc.terrain;
    this.overlay.contours.set(v.contours ? contourLines(t, v.contourStep) : null);
    this.overlay.grid.set(v.grid ? v.gridStep : 0, t.width, t.depth, t.grid.cellSize * 2);
  }

  private objectVisible(o: MapObject): boolean {
    const hidden = this.settings.view().hidden;
    return !hidden?.length || !hidden.includes(this.catalog.object(o.asset).category);
  }

  /** Hidden categories changed: the view shows the rest */
  private syncHidden(): void {
    const key = (this.settings.view().hidden ?? []).join('|');
    if (key === this.hiddenKey) return;
    this.hiddenKey = key;
    this.view.setVisible(key ? (o) => this.objectVisible(o) : null);
  }

  private reportHover(time: number, hit: MapHit | null): void {
    if (time - this.hoverTime < 80) return;
    this.hoverTime = time;
    if (!hit) {
      this.callbacks.hover(null);
      return;
    }
    const t = this.editor.doc.terrain;
    const layer = t.layers[dominantLayer(t, hit.x, hit.y)];
    this.callbacks.hover({ x: hit.x, y: hit.y, height: hit.z, material: layer ? this.catalog.material(layer.material).name : '' });
  }

  private reportStats(time: number): void {
    this.frames++;
    if (!this.statsTime) this.statsTime = time;
    if (time - this.statsTime < 500) return;
    const fps = (this.frames * 1000) / (time - this.statsTime);
    this.frames = 0;
    this.statsTime = time;
    const info = this.renderer.info.render;
    this.callbacks.stats({ fps: Math.round(fps), triangles: info.triangles, drawCalls: info.calls });
  }
}

/** The middle of points and half the larger side of the box around them */
function boundsOf(points: readonly MapPoint[], least: number): { center: MapPoint; radius: number } | null {
  if (!points.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, radius: Math.max(least, (x1 - x0) / 2, (y1 - y0) / 2) };
}

/** Where the camera frames a selection and how wide; null frames the whole map */
function selectionFocus(doc: CustomMapDocument, s: Selection): { center: MapPoint; radius: number } | null {
  if (s?.kind === 'objects') {
    const ids = new Set(s.ids);
    const found = boundsOf(doc.objects.filter((o) => ids.has(o.id)), 30);
    if (found) return found;
  }
  if (s?.kind === 'paths' || s?.kind === 'spawns') {
    // Several nodes, roads or spawns: the box around them
    const nodeIds = new Set(selectedNodes(s));
    const edgeIds = new Set(selectedEdges(s));
    const spawnIds = new Set(selectedSpawns(s));
    const found = boundsOf(
      [
        ...doc.paths.nodes.filter((n) => nodeIds.has(n.id)),
        ...doc.paths.edges.filter((e) => edgeIds.has(e.id)).flatMap((e) => edgePolyline(doc.paths, e)),
        ...doc.spawns.filter((sp) => spawnIds.has(sp.id)),
      ],
      40,
    );
    if (found) return found;
  }
  if (s?.kind === 'spawn') {
    const sp = doc.spawns.find((x) => x.id === s.id);
    if (sp) return { center: sp, radius: 60 };
  }
  if (s?.kind === 'hq') return { center: doc.hq, radius: 60 };
  if (s?.kind === 'node') {
    const n = doc.paths.nodes.find((x) => x.id === s.id);
    if (n) return { center: n, radius: 40 };
  }
  if (s?.kind === 'edge') {
    const e = doc.paths.edges.find((x) => x.id === s.id);
    if (e) return boundsOf(edgePolyline(doc.paths, e), 40);
  }
  return null;
}

/** The GPU's name as WebGL reports it */
function gpuNameOf(renderer: WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}
