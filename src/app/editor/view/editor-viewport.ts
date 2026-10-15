/**
 * The editor's 3D view: its own renderer, scene and camera, independent of
 * the game's engine. It feeds pointer input to the active tool, raycasts the
 * ground once per frame, collects the document's change notices and hands
 * them to the map view once per frame (only the touched chunks), and keeps
 * the overlay (brush, markers, routes) in step.
 */
import { TRIAL_TYPES, TrialRunners } from './trial-runners';
import {
  Color,
  Group,
  MathUtils,
  type Object3D,
  PCFShadowMap,
  OrthographicCamera,
  PerspectiveCamera,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { SPAWN_COLORS } from '../../configs/map-constants.config';
import type { MapObject, MapPoint } from '../../world/custom-map/map-document';
import { type BridgeDeck, bridgeDecks, deckHeightAt } from '../../world/custom-map/bridge-decks';
import { HeightField } from '../../world/custom-map/render/height-field';
import { MapAssetLibrary } from '../../world/custom-map/render/map-asset-library';
import type { CatalogIndex } from '../catalog/asset-catalog';
import { mergeChanges, selectedEdges, selectedNodes, selectedSpawns, type DocChange, type EditorDocument } from '../model/editor-document';
import { heightAt as gridHeight } from '../model/grid';
import { stepRadius } from '../ops/brush';
import { dominantLayer } from '../ops/paint-ops';
import { edgePolyline, nearestOnPolyline, spawnRoutes } from '../ops/path-graph';
import type { EditorSettings, EditorTool, MapHit, PickResult, ToolContext, ToolPointer } from '../tools/tool';
import { CameraController, type OrbitState } from './camera-controller';
import { EditorOverlay } from './editor-overlay';
import { idle } from './idle';
import { EditorMapView, mapToScene } from './map-view';
import { pixelRatioFor, readStoredQuality, storedKnobsFor, type QualityKnobs } from '../../three-engine/render-quality';
import { contourLines } from '../ops/contours';
import { programsReady } from '../../three-engine/programs-ready';

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
  settingsChanged(): void;
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
}


/** Milliseconds between two sky rebuilds while an environment slider moves */
const ENV_INTERVAL_MS = 100;
/** Milliseconds between two water rebuilds while a brush changes the masks */
const WATER_INTERVAL_MS = 120;
const FOV = 50;
/**
 * The game's start view (three-engine/camera-rig.ts applyStartPosition):
 * over the HQ from the south, 400 m up and 145 m back, about 70 degrees
 * down, with the game camera's 60 degree field of view
 */
const GAME_VIEW = { height: 400, back: 145, fov: 60 };
/** Keys that fly the view while the right button is held */
const FLY_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e']);

export class EditorViewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 1, 20000);
  readonly controller = new CameraController();
  readonly overlay: EditorOverlay;
  view: EditorMapView;
  private tool: EditorTool | null = null;
  private pending: DocChange | null = null;
  /** When the view last took the environment, and whether a newer one waits (sliders move faster than the sky rebuilds) */
  private envAt = 0;
  private envWaiting = false;
  /** The same for water: a brush that fills pools changes the masks every frame */
  private waterAt = 0;
  private waterWaiting = false;
  private routesDirty = true;
  /** The bridge decks of the map as it stands, laid again after a change (walkHeightAt) */
  private decks: BridgeDeck[] | null = null;
  /** The symmetry the guides show, and whether the ground under them moved */
  private guideMode: string | null = null;
  /** What the height lines and grid show, and when they were drawn */
  private overlayKey = '';
  private overlayTime = 0;
  private markersDirty = true;
  private pointer: { clientX: number; clientY: number; shift: boolean; ctrl: boolean; alt: boolean; button: number } | null = null;
  private pointerMoved = false;
  private toolDrag = false;
  private cameraDrag: { mode: 'rotate' | 'pan'; x: number; y: number } | null = null;
  private lastHit: MapHit | null = null;
  private raf = 0;
  private lastTime = 0;
  private frames = 0;
  private statsTime = 0;
  private hoverTime = 0;
  private readonly keysDown = new Set<string>();
  /** Set once the viewport is gone: late promises (the warm-up) must not reach the page */
  private disposed = false;
  /** Assets whose programs were compiled ahead */
  private readonly warmed = new Set<string>();
  /**
   * Settles once the top-down picture's programs are built (warmUpView):
   * renderTopDown waits for it, a picture before would link them all in one
   * frame (1.2 s at the editor's start)
   */
  private topDownWarm: Promise<void> = Promise.resolve();
  /** Stands in for renderTopDown's target when compiling its programs ahead (sRGB, any size) */
  private readonly topDownProbe = new WebGLRenderTarget(1, 1, { colorSpace: SRGBColorSpace });
  /** Tools take no input (a terrain job runs) */
  private locked = false;
  /** The view before the game camera took over, to go back to */
  private beforeGameView: OrbitState | null = null;
  /** The trial wave's runners */
  private readonly trial: TrialRunners;
  /** The hidden categories the view last showed */
  private hiddenKey = '';
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly unsubscribe: (() => void)[] = [];
  private readonly resizeObserver: ResizeObserver;
  readonly ctx: ToolContext;
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
    this.overlay = new EditorOverlay((x, y) => this.heightAt(x, y), (x, y) => this.walkHeightAt(x, y));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    MapAssetLibrary.useCompressedTextures(this.renderer);
    this.view = new EditorMapView(editor.doc, this.scene, this.renderer);
    this.view.view.applyQuality(this.quality.customMaps);
    void this.warmUpView();
    this.scene.add(this.overlay.group);
    void this.warmOverlay();
    this.trial = new TrialRunners((x, y) => this.walkHeightAt(x, y));
    this.scene.add(this.trial.group);
    this.ctx = this.buildContext();
    this.unsubscribe.push(
      editor.onChange((change) => {
        this.pending = this.pending ? mergeChanges(this.pending, change) : change;
        this.decks = null;
      }),
      editor.onSelection(() => {
        this.markersDirty = true;
      }),
    );
    this.bindInput();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.frameMap(true);
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  heightAt(x: number, y: number): number {
    return gridHeight(this.editor.doc.terrain, x, y);
  }

  /**
   * Where an enemy walks at a map point: on a bridge deck where one spans
   * it, as the game's CustomMapSurface lays it, else on the ground. Routes
   * and the trial wave go over a bridge, not through the river under it.
   */
  walkHeightAt(x: number, y: number): number {
    const { paths, terrain } = this.editor.doc;
    this.decks ??= bridgeDecks(paths, terrain, new HeightField(terrain.grid, terrain.width, terrain.depth));
    const deck = deckHeightAt(this.decks, x, y);
    return Number.isNaN(deck) ? this.heightAt(x, y) : deck;
  }

  setTool(tool: EditorTool): void {
    if (this.tool === tool) return;
    this.tool?.deactivate?.(this.ctx);
    this.tool = tool;
    tool.activate?.(this.ctx);
    this.overlay.setBrush(null, 0, 0);
  }

  get activeTool(): EditorTool | null {
    return this.tool;
  }

  /** The whole document changed (opened another map, resized): rebuild the view */
  rebuildView(): void {
    this.decks = null;
    this.view.dispose();
    this.view = new EditorMapView(this.editor.doc, this.scene, this.renderer);
    this.view.view.applyQuality(this.quality.customMaps);
    void this.warmUpView();
    // The old view's materials went with it, and with them their programs
    this.warmed.clear();
    // The new view shows everything until the hidden categories are applied again
    this.hiddenKey = '';
    this.pending = null;
    this.routesDirty = true;
    this.markersDirty = true;
  }

  /** Where the camera looks from, to keep as a bookmark */
  /** The map point the view looks at (the camera's target) */
  viewCenter(): { x: number; y: number } {
    const g = this.controller.goal.target;
    return { x: -g.x, y: g.z };
  }

  cameraView(): CameraBookmark {
    const g = this.controller.goal;
    return { x: g.target.x, y: g.target.y, z: g.target.z, distance: g.distance, yaw: g.yaw, pitch: g.pitch };
  }

  /** Fly to a kept view */
  showView(v: CameraBookmark): void {
    const g = this.controller.goal;
    g.target.set(v.x, v.y, v.z);
    g.distance = v.distance;
    g.yaw = v.yaw;
    g.pitch = v.pitch;
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
    const doc = this.editor.doc;
    const s = this.editor.selection;
    if (s?.kind === 'objects') {
      const objs = doc.objects.filter((o) => s.ids.includes(o.id));
      if (objs.length) {
        const xs = objs.map((o) => o.x);
        const ys = objs.map((o) => o.y);
        const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
        this.focusOn(c, Math.max(30, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2));
        return;
      }
    }
    if (s?.kind === 'paths' || s?.kind === 'spawns') {
      // Several nodes, roads or spawns: the box around them
      const nodeIds = new Set(selectedNodes(s));
      const edgeIds = new Set(selectedEdges(s));
      const spawnIds = new Set(selectedSpawns(s));
      const pts = [
        ...doc.paths.nodes.filter((n) => nodeIds.has(n.id)),
        ...doc.paths.edges.filter((e) => edgeIds.has(e.id)).flatMap((e) => edgePolyline(doc.paths, e)),
        ...doc.spawns.filter((sp) => spawnIds.has(sp.id)),
      ];
      if (pts.length) {
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
        this.focusOn(c, Math.max(40, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2));
        return;
      }
    }
    if (s?.kind === 'spawn') {
      const sp = doc.spawns.find((x) => x.id === s.id);
      if (sp) return this.focusOn(sp);
    }
    if (s?.kind === 'hq') return this.focusOn(doc.hq);
    if (s?.kind === 'node') {
      const n = doc.paths.nodes.find((x) => x.id === s.id);
      if (n) return this.focusOn(n, 40);
    }
    if (s?.kind === 'edge') {
      const e = doc.paths.edges.find((x) => x.id === s.id);
      if (e) {
        const line = edgePolyline(doc.paths, e);
        const xs = line.map((p) => p.x);
        const ys = line.map((p) => p.y);
        return this.focusOn(
          { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 },
          Math.max(40, (Math.max(...xs) - Math.min(...xs)) / 2, (Math.max(...ys) - Math.min(...ys)) / 2),
        );
      }
    }
    this.frameMap();
  }

  /**
   * Global keys the shell passes on: the tool first, then the camera.
   * Esc drops what is half done and the selection; false when there was
   * neither (the shell then goes to Look).
   */
  key(e: KeyboardEvent): boolean {
    // Flying with the right button held takes W A S D Q E before any tool
    const k = e.key.toLowerCase();
    if (this.cameraDrag?.mode === 'rotate' && FLY_KEYS.has(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.keysDown.add(`fly:${k}`);
      return true;
    }
    // A locked view (a terrain job, a map another tab edits) takes no edits by key either: Delete, Ctrl+D, End …
    if (!this.locked && this.tool?.key?.(e, this.ctx)) return true;
    if (e.key === 'Escape') {
      const dropped = this.tool?.cancel?.(this.ctx) ?? false;
      const selected = this.editor.selection !== null;
      this.editor.select(null);
      return dropped || selected;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    const b = this.settings.brush;
    switch (e.key) {
      case '[':
        b.radius = stepRadius(b.radius, -1);
        this.callbacks.settingsChanged();
        return true;
      case ']':
        b.radius = stepRadius(b.radius, 1);
        this.callbacks.settingsChanged();
        return true;
      case '{':
        b.strength = Math.max(0.05, Math.round((b.strength - 0.1) * 100) / 100);
        this.callbacks.settingsChanged();
        return true;
      case '}':
        b.strength = Math.min(1, Math.round((b.strength + 0.1) * 100) / 100);
        this.callbacks.settingsChanged();
        return true;
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        this.keysDown.add(e.key);
        return true;
    }
    return false;
  }

  keyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.key);
    this.keysDown.delete(`fly:${e.key.toLowerCase()}`);
  }

  /**
   * Compiles the overlay's programs (brush rings, handles, gizmo, lines)
   * before a tool first shows them: a first compile stalled the frame of a
   * tool switch by up to 70 ms on the GPU
   */
  /**
   * Compiles the map's programs, then tells the page the view is ready.
   * After that, in idle moments, what the editor will need next: the
   * top-down picture's programs (minimap, previews; a render target and no
   * fog make them programs of their own) and the terrain shader's variants
   * with more material layers, which a first stroke with a new biome or
   * material switches to. All of it off the main thread where the driver
   * allows (compileAsync); linked in the frame they cost seconds.
   */
  private async warmUpView(): Promise<void> {
    const view = this.view;
    let topDownWarm!: () => void;
    this.topDownWarm = new Promise<void>((resolve) => (topDownWarm = resolve));
    try {
      await view.warmUp(this.renderer, this.scene, this.camera);
      if (this.disposed || view !== this.view) return;
      this.callbacks.viewReady();
      await idle(2000);
      if (this.disposed || view !== this.view) return;
      await this.compileForViews(this.scene, false);
      topDownWarm();
      await idle(2000);
      if (this.disposed || view !== this.view) return;
      const twins = [...view.terrainLayerTwins(), ...view.effectTwins()];
      if (twins.length) {
        const group = new Group();
        for (const t of twins) group.add(t);
        await this.compileForViews(group);
      }
    } catch {
      // A view replaced or lost while compiling
    } finally {
      topDownWarm();
    }
  }

  /**
   * Compiles `object`'s programs for the pictures the editor draws: the view
   * and renderTopDown, whose render target, missing fog and hidden effects
   * (their point lights with them) give other programs. The view's twice:
   * with the map's point lights as they are (`screen`) and in the other
   * state, as a night (or a first lamp after dark) changes their number and
   * every lit material links new programs in that frame (3.9 s in the
   * showreel review). compileAsync builds them before it returns its
   * promise, so target, fog and lights change only around the call.
   */
  private compileForViews(object: Object3D, screen = true): Promise<unknown> {
    const r = this.renderer;
    const jobs: Promise<unknown>[] = [];
    this.view.withEitherLights((current) => {
      if (screen || !current) jobs.push(r.compileAsync(object, this.camera, this.scene));
    });
    const fog = this.scene.fog;
    const previous = r.getRenderTarget();
    try {
      this.scene.fog = null;
      this.view.setParticlesVisible(false);
      r.setRenderTarget(this.topDownProbe);
      jobs.push(r.compileAsync(object, this.camera, this.scene));
    } finally {
      r.setRenderTarget(previous);
      this.view.setParticlesVisible(true);
      this.scene.fog = fog;
    }
    // The view keeps drawing meanwhile, which makes compileAsync settle early (programsReady)
    return Promise.all(jobs).then(() => programsReady(r));
  }

  private async warmOverlay(): Promise<void> {
    const hidden: { visible: boolean }[] = [];
    this.overlay.group.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    // compileAsync gathers the programs at once; the parts hide again before the next frame draws
    let done: Promise<unknown>;
    try {
      done = this.renderer.compileAsync(this.overlay.group, this.camera, this.scene);
    } finally {
      for (const o of hidden) o.visible = false;
    }
    await done.catch(() => undefined);
  }

  /** While a terrain job runs or another tab edits the map, tools take no input (the view still turns and zooms) */
  setLocked(on: boolean): void {
    this.locked = on;
    if (on && this.toolDrag) {
      this.toolDrag = false;
      this.tool?.cancel?.(this.ctx);
    }
  }

  /** Whether a tool holds the pointer (a stroke, a drag): slow extras wait */
  get dragging(): boolean {
    return this.toolDrag;
  }

  /** Compiles the programs of assets before they are placed, so the first stroke with them does not stall */
  warmUpAssets(assetIds: string[]): void {
    const fresh = assetIds.filter((id) => !this.warmed.has(id));
    if (!fresh.length) return;
    for (const id of fresh) this.warmed.add(id);
    void this.view.warmUpAssets(this.renderer, this.scene, this.camera, fresh, (o) => this.compileForViews(o)).catch(() => undefined);
  }

  /** Whether the trial wave walks */
  get trialRunning(): boolean {
    return this.trial.active;
  }

  /** How much faster than real time the trial wave walks (1, 2, 4, 8); changes a running wave at once */
  get trialSpeed(): number {
    return this.trial.speed;
  }

  set trialSpeed(speed: number) {
    this.trial.speed = speed;
  }

  /**
   * The trial wave on or off: the enemies of the map's first wave (or a
   * mix of speeds) walk every spawn's route at their real speed.
   */
  toggleTrial(): void {
    if (this.trial.active) {
      this.trial.stop();
      this.callbacks.status('Trial wave stopped');
      return;
    }
    const doc = this.editor.doc;
    // Each route's runners in the colour of its spawn, as on the minimap
    const found = spawnRoutes(doc);
    const routes = doc.spawns.flatMap((sp, k) => {
      const r = found.get(sp.id);
      return r ? [{ ...r, color: '#' + new Color(SPAWN_COLORS[k % SPAWN_COLORS.length]).getHexString() }] : [];
    });
    if (!routes.length) {
      this.callbacks.status('No spawn reaches the HQ: draw a road first');
      return;
    }
    const waves = doc.gameplay?.waves;
    const first = waves?.kind === 'table' ? waves.table.waves[0] : undefined;
    const types = this.trial.start(routes, first ? Object.keys(first.enemies) : TRIAL_TYPES);
    const t = TrialRunners.timing(routes, types);
    this.callbacks.status(
      `Trial wave: ${types.map((x) => x.name).join(', ')} on ${routes.length} ${routes.length === 1 ? 'route' : 'routes'}; ` +
        `the HQ in ${Math.round(t.fastest)} to ${Math.round(t.slowest)} s (P stops, + and - change the speed)`,
    );
  }

  /** Whether the right button is turning the view (keys fly then) */
  get flying(): boolean {
    return this.cameraDrag?.mode === 'rotate';
  }

  /** Whether the view shows what the game shows at the start */
  get inGameView(): boolean {
    return this.beforeGameView !== null;
  }

  /** The game's start view over the HQ, or back to the view before */
  toggleGameView(): void {
    const c = this.controller;
    if (this.beforeGameView) {
      c.setGoal(this.beforeGameView);
      this.beforeGameView = null;
      this.setFov(FOV);
      this.callbacks.status('Editor view');
      return;
    }
    this.beforeGameView = c.saveGoal();
    const hq = this.editor.doc.hq;
    c.setGoal({
      target: mapToScene(hq.x, hq.y, this.heightAt(hq.x, hq.y)),
      distance: Math.hypot(GAME_VIEW.height, GAME_VIEW.back),
      yaw: 0,
      pitch: Math.atan2(GAME_VIEW.height, GAME_VIEW.back),
    });
    this.setFov(GAME_VIEW.fov);
    this.callbacks.status('Game view: where the game starts (C goes back)');
  }

  private setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /**
   * The map from straight above into a canvas: the minimap, the PNG preview
   * and the thumbnails. `overlay` adds spawns, HQ and roads' markers. Once
   * its programs are built (topDownWarm); the pixels come back without
   * waiting for the GPU (readRenderTargetPixelsAsync): a synchronous read
   * held the main thread 65 to 140 ms until the whole map was drawn, after
   * every stroke (the minimap) and every autosave (the thumbnail)
   */
  async renderTopDown(width: number, height = width, overlay = false, area?: { x0: number; y0: number; x1: number; y1: number }): Promise<HTMLCanvasElement> {
    await this.topDownWarm;
    if (this.disposed) throw new Error('The view is gone');
    const t = this.editor.doc.terrain;
    this.flush();
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
    const fog = this.scene.fog;
    this.scene.fog = null;
    // Put back as they were after: someone else may hold the overlay hidden
    const overlayShown = this.overlay.group.visible;
    this.overlay.group.visible = overlay;
    // Particles and glows seen from above would cover the ground as a bright square
    this.view.setParticlesVisible(false);
    this.trial.group.visible = false;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, cam);
    this.view.setParticlesVisible(true);
    this.trial.group.visible = true;
    const pixels = new Uint8Array(width * height * 4);
    const read = this.renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height, pixels);
    this.renderer.setRenderTarget(null);
    this.overlay.group.visible = overlayShown;
    this.scene.fog = fog;
    try {
      await read;
    } finally {
      target.dispose();
    }
    if (this.disposed) throw new Error('The view is gone');
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

  /** The ground point the camera looks at and how far the view reaches (minimap frame) */
  viewFootprint(): MapPoint[] {
    const out: MapPoint[] = [];
    for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const hit = this.rayAtNdc(x, y);
      if (hit) out.push(hit);
    }
    return out;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const u of this.unsubscribe) u();
    this.tool?.deactivate?.(this.ctx);
    this.view.dispose();
    this.overlay.dispose();
    this.trial.dispose();
    this.topDownProbe.dispose();
    this.renderer.dispose();
    // Browsers keep only a few WebGL contexts: give this one back now, not when it is collected
    this.renderer.forceContextLoss();
  }

  // -------------------------------------------------------------------------

  private buildContext(): ToolContext {
    return {
      editor: this.editor,
      settings: this.settings,
      catalog: this.catalog,
      overlay: this.overlay,
      heightAt: (x, y) => this.heightAt(x, y),
      pick: (p) => this.pick(p),
      status: (m) => this.callbacks.status(m),
      settingsChanged: () => this.callbacks.settingsChanged(),
      setBox: (b) => this.callbacks.box(b),
      setLasso: (points) => this.callbacks.lasso(points),
      objectVisible: (o) => this.objectVisible(o),
      pickGizmo: (p) => {
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width) return null;
        this.ndc.set(((p.clientX - rect.left) / rect.width) * 2 - 1, -((p.clientY - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(this.ndc, this.camera);
        return this.overlay.transform.pick(this.raycaster);
      },
      metresPerPixel: (at) => {
        const d = this.camera.position.distanceTo(mapToScene(at.x, at.y, this.heightAt(at.x, at.y)));
        return (2 * d * Math.tan(MathUtils.degToRad(this.camera.fov / 2))) / Math.max(1, this.canvas.clientHeight);
      },
      toScreen: (x, y, z) => {
        const v = mapToScene(x, y, z).project(this.camera);
        if (v.z > 1 || v.z < -1) return null;
        const rect = this.canvas.getBoundingClientRect();
        return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
      },
      boxToMap: (box) => {
        const rect = this.canvas.getBoundingClientRect();
        const corners = [
          [box.x0, box.y0],
          [box.x1, box.y0],
          [box.x1, box.y1],
          [box.x0, box.y1],
        ].map(([cx, cy]) => this.rayAtNdc(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1));
        return corners.every((c) => c) ? (corners as MapPoint[]) : null;
      },
    };
  }

  private bindInput(): void {
    const c = this.canvas;
    type CanvasEvents = HTMLElementEventMap & { webglcontextlost: WebGLContextEvent; webglcontextrestored: Event };
    const on = <K extends keyof CanvasEvents & string>(type: K, fn: (e: CanvasEvents[K]) => void, opts?: AddEventListenerOptions) => {
      c.addEventListener(type, fn as EventListener, opts);
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
    on('pointerdown', (e) => this.onPointerDown(e));
    on('pointermove', (e) => this.onPointerMove(e));
    on('pointerup', (e) => this.onPointerUp(e));
    on('pointercancel', (e) => this.onPointerUp(e));
    on('pointerleave', () => {
      if (!this.toolDrag && !this.cameraDrag) {
        this.pointer = null;
        this.callbacks.hover(null);
      }
    });
    on('wheel', (e) => this.onWheel(e), { passive: false });
  }

  private toolPointer(e: { clientX: number; clientY: number; button: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, hit: MapHit | null): ToolPointer {
    return { hit, clientX: e.clientX, clientY: e.clientY, button: e.button, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
  }

  private onPointerDown(e: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    this.trackPointer(e);
    const pan = e.button === 1 || (e.button === 2 && e.shiftKey);
    if (e.button === 0 && this.tool && !this.locked) {
      const hit = this.raycastClient(e.clientX, e.clientY);
      this.lastHit = hit;
      if (this.tool.pointerDown?.(this.toolPointer(e, hit), this.ctx)) {
        this.toolDrag = true;
        this.canvas.setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
    }
    if (e.button === 2 && !pan && this.tool) {
      // A right click may end something in the tool (a road being drawn); a drag still turns the view
      const hit = this.lastHit;
      this.tool.pointerDown?.(this.toolPointer(e, hit), this.ctx);
    }
    if (e.button === 1 || e.button === 2) {
      this.cameraDrag = { mode: pan ? 'pan' : 'rotate', x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    this.trackPointer(e);
    const drag = this.cameraDrag;
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.mode === 'rotate') this.controller.rotate(dx, dy);
      else this.controller.pan(dx, dy, this.canvas.clientHeight, this.camera.fov);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.trackPointer(e);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.toolDrag) {
      this.toolDrag = false;
      const hit = this.raycastClient(e.clientX, e.clientY);
      this.tool?.pointerMove?.(this.toolPointer(e, hit), this.ctx);
      this.tool?.pointerUp?.(this.toolPointer(e, hit), this.ctx);
    }
    if (this.cameraDrag) for (const k of FLY_KEYS) this.keysDown.delete(`fly:${k}`);
    this.cameraDrag = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    // Ctrl and the wheel size the brush where one shows (Ctrl+wheel would zoom the page otherwise)
    if ((e.ctrlKey || e.metaKey) && this.tool?.brushVisible(this.ctx)) {
      const b = this.settings.brush;
      b.radius = stepRadius(b.radius, e.deltaY < 0 ? 1 : -1);
      this.callbacks.settingsChanged();
      return;
    }
    const steps = Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100 || 1);
    const hit = this.raycastClient(e.clientX, e.clientY);
    this.controller.zoom(steps, hit ? mapToScene(hit.x, hit.y, hit.z) : null);
  }

  private trackPointer(e: PointerEvent): void {
    this.pointer = { clientX: e.clientX, clientY: e.clientY, shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, button: e.button };
    this.pointerMoved = true;
  }

  private raycastClient(clientX: number, clientY: number): MapHit | null {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return this.rayAtNdc(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  private rayAtNdc(x: number, y: number): MapHit | null {
    this.ndc.set(x, y);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.view.raycast(this.raycaster.ray);
  }

  private pick(p: ToolPointer): PickResult | null {
    const hit = p.hit;
    if (!hit) return null;
    const doc = this.editor.doc;
    // A pick radius that grows with the view distance, so markers stay clickable from far
    const reach = Math.max(4, this.controller.current.distance * 0.015);
    let best: { d: number; r: PickResult } | null = null;
    const consider = (d: number, r: PickResult) => {
      if (!best || d < best.d) best = { d, r };
    };
    const hq = Math.hypot(doc.hq.x - hit.x, doc.hq.y - hit.y);
    if (hq <= Math.max(8, reach)) consider(hq - 4, { kind: 'hq' });
    for (const s of doc.spawns) {
      const d = Math.hypot(s.x - hit.x, s.y - hit.y);
      if (d <= Math.max(6, reach)) consider(d - 3, { kind: 'spawn', id: s.id });
    }
    for (const n of doc.paths.nodes) {
      const d = Math.hypot(n.x - hit.x, n.y - hit.y);
      if (d <= reach) consider(d - 2, { kind: 'node', id: n.id });
    }
    // Objects by their models; the footprint where the ray misses a thin one
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((p.clientX - rect.left) / rect.width) * 2 - 1, -((p.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const modelHit = this.view.pickObject(this.raycaster.ray);
    if (modelHit) consider(0, { kind: 'object', id: modelHit });
    for (const o of doc.objects) {
      const r = this.catalog.object(o.asset).radius * o.scale;
      const d = Math.hypot(o.x - hit.x, o.y - hit.y);
      if (d <= Math.max(r, 1)) consider(d + 0.5, { kind: 'object', id: o.id });
    }
    if (!best) {
      for (const e of doc.paths.edges) {
        const on = nearestOnPolyline(edgePolyline(doc.paths, e), hit);
        if (on && on.dist <= e.width / 2 + reach * 0.5) consider(on.dist + 1, { kind: 'edge', id: e.id });
      }
    }
    return (best as { d: number; r: PickResult } | null)?.r ?? null;
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
  }

  private applyWater(): void {
    this.waterWaiting = false;
    this.waterAt = performance.now();
    this.view.updateWater();
  }

  private applyEnvironment(): void {
    this.envWaiting = false;
    this.envAt = performance.now();
    this.view.setEnvironment();
  }

  /** Hand the collected changes to the view */
  private flush(): void {
    if (this.envWaiting && performance.now() - this.envAt >= ENV_INTERVAL_MS) this.applyEnvironment();
    if (this.waterWaiting && performance.now() - this.waterAt >= WATER_INTERVAL_MS) this.applyWater();
    const c = this.pending;
    if (!c) {
      if (this.markersDirty) this.refreshMarkers();
      return;
    }
    this.pending = null;
    const v = this.view;
    if (c.terrain) {
      // A new terrain (resize): the renderer builds its ground anew
      this.rebuildView();
    } else {
      if (c.layers) v.updateLayers();
      if (c.heights) v.updateHeights(c.heights);
      if (c.splat) v.updateSplat(c.splat);
      if (c.water) {
        if (performance.now() - this.waterAt >= WATER_INTERVAL_MS) this.applyWater();
        else this.waterWaiting = true;
      } else if (c.bodies && c.bodyRect) {
        // A pool brush on one body: just that surface (about a millisecond)
        for (const k of c.bodies) v.updateWaterBody(k, c.bodyRect);
      }
      if (c.objects) {
        // A list goes in place where it can; new objects rebuild at most every few frames
        if (c.objects === 'all') v.setObjects();
        else v.updateObjects(c.objects);
      }
      if (c.paths) v.updatePaths();
      if (c.environment) {
        if (performance.now() - this.envAt >= ENV_INTERVAL_MS) this.applyEnvironment();
        else this.envWaiting = true;
      }
    }
    // Water lifts a bridge deck over it: the routes over the bridge follow
    if (c.paths || c.markers || c.heights || c.terrain || c.water || c.bodies) this.routesDirty = true;
    if (c.heights || c.terrain) {
      this.guideMode = null;
      this.overlayKey = '';
    }
    if (Object.entries(c).every(([k, v]) => k === 'objects' || v === undefined)) {
      // Objects alone leave spawns, HQ and roads as they are (a gizmo drag every frame): only the rings follow
      this.overlay.updateSelection(this.editor.doc, this.editor.selection, (asset) => this.catalog.object(asset).radius);
      return;
    }
    this.markersDirty = true;
    this.refreshMarkers();
  }

  private refreshMarkers(): void {
    const doc = this.editor.doc;
    this.markersDirty = false;
    this.overlay.updateMarkers(doc, this.editor.selection);
    this.overlay.updateSelection(doc, this.editor.selection, (asset) => this.catalog.object(asset).radius);
    if (this.routesDirty) {
      this.routesDirty = false;
      this.overlay.setRoutes(this.settings.paths.showRoutes ? [...spawnRoutes(doc).values()] : []);
    }
  }

  /** Routes on or off (the switch in the path panel) */
  refreshRoutes(): void {
    this.routesDirty = true;
    this.markersDirty = true;
  }

  private loop(time: number): void {
    this.raf = requestAnimationFrame((t) => this.loop(t));
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = time;

    this.moveByKeys(dt);
    this.syncHidden();
    const t = this.editor.doc.terrain;
    const g = this.controller.goal.target;
    g.x = Math.max(-t.width / 2, Math.min(t.width / 2, g.x));
    g.z = Math.max(-t.depth / 2, Math.min(t.depth / 2, g.z));
    this.controller.setGroundHeight(this.heightAt(-g.x, g.z));
    if (this.controller.update(dt)) this.callbacks.camera();
    this.controller.apply(this.camera);
    // The map's haze starts behind what the camera looks at: from afar the whole map stays readable
    this.view.view.environment.setClearAir(this.controller.current.distance * 1.15);

    // One ground raycast per frame for the tool and the cursor
    const p = this.pointer;
    let tp: ToolPointer | null = null;
    if (p && !this.cameraDrag) {
      const hit = this.pointerMoved || this.toolDrag ? this.raycastClient(p.clientX, p.clientY) : this.lastHit;
      this.lastHit = hit;
      tp = { hit, clientX: p.clientX, clientY: p.clientY, button: p.button, shift: p.shift, ctrl: p.ctrl, alt: p.alt };
      if (this.toolDrag && this.pointerMoved) this.tool?.pointerMove?.(tp, this.ctx);
      this.pointerMoved = false;
    }
    this.tool?.frame?.(dt, tp, this.ctx);
    this.flush();
    this.refreshOverlays(time);
    if (this.guideMode !== this.settings.symmetry) {
      this.guideMode = this.settings.symmetry;
      const t = this.editor.doc.terrain;
      this.overlay.setSymmetry(this.settings.symmetry, t.width, t.depth);
    }

    const brush = this.settings.brush;
    const showBrush = !!tp?.hit && !!this.tool?.brushVisible(this.ctx);
    this.overlay.setBrush(showBrush ? tp!.hit : null, brush.radius, brush.falloff);
    this.overlay.setViewDistance(this.controller.current.distance);
    this.overlay.update(dt);
    this.view.view.setAnimationPaused(this.settings.view.still);
    this.view.update(dt, this.camera, this.controller.current.target);
    this.trial.update(dt);
    this.renderer.render(this.scene, this.camera);

    this.reportHover(time, tp?.hit ?? null);
    this.reportStats(time);
  }

  /** Height lines and grid, redrawn at most twice a second while the ground changes */
  private refreshOverlays(time: number): void {
    const v = this.settings.view;
    const key = `${v.contours}:${v.contourStep}:${v.grid}:${v.gridStep}`;
    if (key === this.overlayKey || time - this.overlayTime < 500) return;
    this.overlayKey = key;
    this.overlayTime = time;
    const t = this.editor.doc.terrain;
    this.overlay.setContours(v.contours ? contourLines(t, v.contourStep) : null);
    this.overlay.setGrid(v.grid ? v.gridStep : 0, t.width, t.depth, t.grid.cellSize * 2);
  }

  private objectVisible(o: MapObject): boolean {
    const hidden = this.settings.view.hidden;
    return !hidden?.length || !hidden.includes(this.catalog.object(o.asset).category);
  }

  /** Hidden categories changed: the view shows the rest */
  private syncHidden(): void {
    const key = (this.settings.view.hidden ?? []).join('|');
    if (key === this.hiddenKey) return;
    this.hiddenKey = key;
    this.view.setVisible(key ? (o) => this.objectVisible(o) : null);
  }

  private moveByKeys(dt: number): void {
    if (!this.keysDown.size) return;
    const speed = this.controller.goal.distance * 0.9 * dt;
    let right = 0;
    let forward = 0;
    if (this.keysDown.has('ArrowUp')) forward += speed;
    if (this.keysDown.has('ArrowDown')) forward -= speed;
    if (this.keysDown.has('ArrowRight')) right += speed;
    if (this.keysDown.has('ArrowLeft')) right -= speed;
    // Flying: faster with Shift, Q and E change the height above the ground
    const fly = (this.pointer?.shift ? 3 : 1) * speed;
    let up = 0;
    if (this.keysDown.has('fly:w')) forward += fly;
    if (this.keysDown.has('fly:s')) forward -= fly;
    if (this.keysDown.has('fly:d')) right += fly;
    if (this.keysDown.has('fly:a')) right -= fly;
    if (this.keysDown.has('fly:e')) up += fly;
    if (this.keysDown.has('fly:q')) up -= fly;
    this.controller.fly(forward, right, up);
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

/** The GPU's name as WebGL reports it */
function gpuNameOf(renderer: WebGLRenderer): string {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
}
