/**
 * The editor's 3D view: its own renderer, scene and camera, independent of
 * the game's engine. It feeds pointer input to the active tool, raycasts the
 * ground once per frame, collects the document's change notices and hands
 * them to the map view once per frame (only the touched chunks), and keeps
 * the overlay (brush, markers, routes) in step.
 */
import {
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
import type { MapPoint } from '../../world/custom-map/map-document';
import type { CatalogIndex } from '../catalog/asset-catalog';
import { mergeChanges, type DocChange, type EditorDocument } from '../model/editor-document';
import { heightAt as gridHeight } from '../model/grid';
import { stepRadius } from '../ops/brush';
import { dominantLayer } from '../ops/paint-ops';
import { edgePolyline, nearestOnPolyline, spawnRoutes } from '../ops/path-graph';
import type { EditorSettings, EditorTool, MapHit, PickResult, ToolContext, ToolPointer } from '../tools/tool';
import { CameraController } from './camera-controller';
import { EditorOverlay } from './editor-overlay';
import { EditorMapView, mapToScene } from './map-view';

export interface HoverInfo {
  x: number;
  y: number;
  height: number;
  material: string;
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
  hover(info: HoverInfo | null): void;
  stats(stats: FrameStats): void;
  /** The camera moved (minimap frame) */
  camera(): void;
}


const FOV = 50;

export class EditorViewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 1, 20000);
  readonly controller = new CameraController();
  readonly overlay: EditorOverlay;
  view: EditorMapView;
  private tool: EditorTool | null = null;
  private pending: DocChange | null = null;
  private routesDirty = true;
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
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly unsubscribe: (() => void)[] = [];
  private readonly resizeObserver: ResizeObserver;
  readonly ctx: ToolContext;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    readonly editor: EditorDocument,
    readonly catalog: CatalogIndex,
    readonly settings: EditorSettings,
    private readonly callbacks: ViewportCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.overlay = new EditorOverlay((x, y) => this.heightAt(x, y));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.view = new EditorMapView(editor.doc, this.scene, this.renderer);
    this.scene.add(this.overlay.group);
    this.ctx = this.buildContext();
    this.unsubscribe.push(
      editor.onChange((change) => {
        this.pending = this.pending ? mergeChanges(this.pending, change) : change;
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
    this.view.dispose();
    this.view = new EditorMapView(this.editor.doc, this.scene, this.renderer);
    this.pending = null;
    this.routesDirty = true;
    this.markersDirty = true;
  }

  /** Frame the whole map */
  frameMap(snap = false): void {
    const t = this.editor.doc.terrain;
    this.controller.maxDistance = Math.max(t.width, t.depth) * 3;
    this.controller.focus(new Vector3(0, this.heightAt(0, 0), 0), Math.max(t.width, t.depth) * 0.42);
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

  /** Global keys the shell passes on: the tool first, then the camera */
  key(e: KeyboardEvent): boolean {
    if (this.tool?.key?.(e, this.ctx)) return true;
    if (e.key === 'Escape') {
      this.tool?.cancel?.(this.ctx);
      this.editor.select(null);
      return true;
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
      case 'f':
      case 'F':
        this.focusSelection();
        return true;
      case 't':
      case 'T':
        this.controller.setTopDown(!this.controller.isTopDown);
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
  }

  /**
   * The map from straight above into a canvas: the minimap, the PNG preview
   * and the thumbnails. `overlay` adds spawns, HQ and roads' markers.
   */
  renderTopDown(width: number, height = width, overlay = false): HTMLCanvasElement {
    const t = this.editor.doc.terrain;
    this.flush();
    const cam = new OrthographicCamera(-t.width / 2, t.width / 2, t.depth / 2, -t.depth / 2, 1, 20000);
    cam.position.set(0, 5000, 0);
    // North (+z) at the top, east (-x) to the right
    cam.up.set(0, 0, 1);
    cam.lookAt(0, 0, 0);
    const target = new WebGLRenderTarget(width, height, { colorSpace: SRGBColorSpace });
    const fog = this.scene.fog;
    this.scene.fog = null;
    this.overlay.group.visible = overlay;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, cam);
    const pixels = new Uint8Array(width * height * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
    this.renderer.setRenderTarget(null);
    this.overlay.group.visible = true;
    this.scene.fog = fog;
    target.dispose();
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
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    for (const u of this.unsubscribe) u();
    this.tool?.deactivate?.(this.ctx);
    this.view.dispose();
    this.overlay.dispose();
    this.renderer.dispose();
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
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      c.addEventListener(type, fn as EventListener, opts);
      this.unsubscribe.push(() => c.removeEventListener(type, fn as EventListener));
    };
    on('contextmenu', (e) => e.preventDefault());
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
    if (e.button === 0 && this.tool) {
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
      else this.controller.pan(dx, dy, this.canvas.clientHeight, FOV);
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
    this.cameraDrag = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
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

  /** Hand the collected changes to the view */
  private flush(): void {
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
      if (c.water) v.updateWater();
      if (c.objects) {
        if (c.objects === 'all' || c.objects.length > 32) v.setObjects();
        else v.updateObjects(c.objects);
      }
      if (c.paths) v.updatePaths();
      if (c.environment) v.setEnvironment();
    }
    if (c.paths || c.markers || c.heights || c.terrain) this.routesDirty = true;
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
    const t = this.editor.doc.terrain;
    const g = this.controller.goal.target;
    g.x = Math.max(-t.width / 2, Math.min(t.width / 2, g.x));
    g.z = Math.max(-t.depth / 2, Math.min(t.depth / 2, g.z));
    this.controller.setGroundHeight(this.heightAt(-g.x, g.z));
    if (this.controller.update(dt)) this.callbacks.camera();
    this.controller.apply(this.camera);

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

    const brush = this.settings.brush;
    const showBrush = !!tp?.hit && !!this.tool?.brushVisible(this.ctx);
    this.overlay.setBrush(showBrush ? tp!.hit : null, brush.radius, brush.falloff);
    this.overlay.setViewDistance(this.controller.current.distance);
    this.overlay.update(dt);
    this.view.update(dt, this.camera, this.controller.current.target);
    this.renderer.render(this.scene, this.camera);

    this.reportHover(time, tp?.hit ?? null);
    this.reportStats(time);
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
    this.controller.move(right, forward);
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

