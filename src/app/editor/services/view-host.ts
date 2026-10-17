/**
 * The editor's 3D view for the session: it makes the view on the page's
 * canvas and lets it go when the page goes (the game shows), keeps the
 * camera for the next view of the same map and the kept views 1 to 9, and
 * hands the view's reports (hover, frame stats, box and lasso) to signals.
 * The page reaches the view only through EditorViewPort; the class
 * EditorViewport is a detail of view/.
 */
import { signal, type NgZone, type Signal } from '@angular/core';
import type { MapIntro, MapIntroView, MapPoint } from '../../world/custom-map/map-document';
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import type { BuildAreas } from '../../map-ops/validation/build-areas';
import type { SpawnRoutes } from './editor-routes';
import type { EditorPathMask } from './editor-path-mask';
import type { EditorDocument } from '../model/editor-document';
import { patch, type EditorSettings, type EditorTool, type ToolContext } from '../tools/tool';
import { EditorViewport, type CameraBookmark, type FrameStats, type HoverInfo } from '../view/editor-viewport';
import type { EditorNotices } from './editor-notices';

const BOOKMARK_KEY = '3dtd-editor-views:';

/** What the page may do with the view: camera, trial wave, pictures, keys, and what the view reports */
export interface EditorViewPort {
  readonly viewLost: Signal<boolean>;
  readonly viewRev: Signal<number>;
  readonly viewShown: Signal<boolean>;
  readonly introPreviewing: Signal<boolean>;
  readonly hover: Signal<HoverInfo | null>;
  readonly stats: Signal<FrameStats | null>;
  readonly box: Signal<{ x0: number; y0: number; x1: number; y1: number } | null>;
  readonly lasso: Signal<string | null>;
  readonly bookmarks: Signal<(CameraBookmark | null)[]>;
  saveBookmark(slot: number): void;
  showBookmark(slot: number): void;
  onCamera(fn: () => void): () => void;
  introView(): MapIntroView | null;
  /** Plays the intro flight, or stops it (null) */
  previewIntro(intro: MapIntro | null): void;
  setAmbience(on: boolean): void;
  playWaveSound(): void;
  /** Whether a view stands on the page now */
  readonly shown: boolean;
  /** A tool holds the pointer (a stroke, a drag): slow extras wait */
  readonly dragging: boolean;
  /** The right button turns the view: W A S D fly */
  readonly flying: boolean;
  readonly topDown: boolean;
  readonly trialRunning: boolean;
  frameMap(): void;
  /** Frames the selection, or the map without one */
  focusSelection(): void;
  focusOn(p: MapPoint, radius?: number): void;
  /** The camera's goal moves over map point (x, y) (the minimap) */
  lookAt(x: number, y: number): void;
  /** The map point the camera looks at now, null without a view */
  cameraTarget(): MapPoint | null;
  /** The ground the view covers, as the corners' map points */
  viewFootprint(): MapPoint[];
  showView(view: CameraBookmark, snap?: boolean): void;
  setTopDown(on: boolean): void;
  toggleGameView(): void;
  /** The trial wave on or off at `speed`; whether it walks now */
  toggleTrial(speed: number): boolean;
  setTrialSpeed(speed: number): void;
  /** The map from above; rejects without a view */
  renderTopDown(width: number, height?: number, overlay?: boolean, area?: { x0: number; y0: number; x1: number; y1: number }): Promise<HTMLCanvasElement>;
  /** Compiles the programs of assets about to be placed */
  warmUpAssets(assetIds: string[]): void;
  /** A key for the view and the tool; true when one took it */
  key(e: KeyboardEvent): boolean;
  keyUp(e: KeyboardEvent): void;
  focusCanvas(): void;
  /** The routes again after their switch changed */
  refreshRoutes(): void;
}

export interface ViewHostDeps {
  zone: NgZone;
  notices: EditorNotices;
  settings: EditorSettings;
  catalog(): CatalogIndex;
  /** The tool in hand, for a new view */
  tool(): EditorTool;
  /** Whether tools may take input (no job, no other tab) */
  locked(): boolean;
  /** The view's context went (lost true) or came back */
  contextLost(lost: boolean): void;
  /** The tool's line of help says something new */
  hintChanged(): void;
  /** The view's path mask, kept by the editor's worker */
  pathMask: EditorPathMask;
}

export class ViewHost implements EditorViewPort {
  private viewport: EditorViewport | null = null;
  /** The 3D view lost its WebGL context and waits for it to come back; the map in memory is untouched */
  readonly viewLost = signal(false);
  /** Counts the times the map view became ready (models and textures in): pictures of it are worth retaking */
  readonly viewRev = signal(0);
  /** Whether the view drew its map once (programs compiled); until then it says it is getting ready */
  readonly viewShown = signal(false);
  /** Bumps when a view comes or goes */
  readonly attached = signal(0);
  /** The map's intro flight plays in the view (Preview) */
  readonly introPreviewing = signal(false);
  readonly hover = signal<HoverInfo | null>(null);
  readonly stats = signal<FrameStats | null>(null);
  readonly box = signal<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** The lasso outline as SVG points (client pixels), or null */
  readonly lasso = signal<string | null>(null);
  /** Camera views 1 to 9 of the open map (kept per map in this browser) */
  readonly bookmarks = signal<(CameraBookmark | null)[]>(Array(9).fill(null));
  /** The camera of the view that went while the map stayed open, for the next view */
  private keptView: CameraBookmark | null = null;
  private readonly cameraListeners = new Set<() => void>();
  private mapId: string | null = null;
  /** The open map's routes as found last (EditorRoutes), for a new view and the trial wave */
  private routes: SpawnRoutes = new Map();

  constructor(private readonly deps: ViewHostDeps) {}

  // ------------------------------------------------------------------ the session's side

  /** Makes the view of `editor`'s map on the page's canvas */
  attach(canvas: HTMLCanvasElement, editor: EditorDocument): void {
    const d = this.deps;
    this.viewShown.set(false);
    d.zone.runOutsideAngular(() => {
      const vp = new EditorViewport(canvas, editor, d.catalog(), d.settings, {
        status: (m) => d.notices.flash(m),
        hintChanged: () => d.hintChanged(),
        box: (b) => this.box.set(b),
        lasso: (points) => this.lasso.set(points ? points.map((q) => `${Math.round(q.x)},${Math.round(q.y)}`).join(' ') : null),
        hover: (h) => this.hover.set(h),
        stats: (s) => this.stats.set(s),
        camera: () => {
          for (const fn of this.cameraListeners) fn();
        },
        viewReady: () =>
          d.zone.run(() => {
            this.viewRev.update((n) => n + 1);
            this.viewShown.set(true);
          }),
        contextLost: (lost) =>
          d.zone.run(() => {
            this.viewLost.set(lost);
            d.contextLost(lost);
          }),
        pathMaskBuilt: (view) => d.pathMask.built(view),
        pathMaskChanged: () => d.pathMask.changed(),
      });
      this.viewport = vp;
      this.refreshRoutes();
      vp.setTool(d.tool());
      if (d.locked()) vp.input.setLocked(true);
      // Back from the game: the camera where it was
      if (this.keptView) vp.showView(this.keptView, true);
      this.keptView = null;
    });
    this.attached.update((n) => n + 1);
  }

  /** The view goes (the game shows, the map closes); the next view of this map stands where this one stood */
  detach(keepCamera: boolean): void {
    this.keptView = this.viewport && keepCamera ? this.viewport.cameraView() : null;
    this.viewport?.dispose();
    this.viewport = null;
    this.deps.pathMask.detach();
    // The sound stopped with the view; a new view starts it only from a click
    patch(this.deps.settings.life, { hear: false });
    this.attached.update((n) => n + 1);
  }

  /** Another map is in the editor: its kept views, its own camera; `frame` frames it at once */
  mapOpened(mapId: string, frame: boolean): void {
    if (frame) this.keptView = null;
    this.mapId = mapId;
    this.loadBookmarks(mapId);
    const vp = this.viewport;
    if (vp) {
      vp.rebuildView();
      if (frame) vp.frameMap(true);
    }
  }

  /** The tools take input or not (a job runs, another tab edits) */
  lock(on: boolean): void {
    this.viewport?.input.setLocked(on);
  }

  setTool(tool: EditorTool): void {
    this.viewport?.setTool(tool);
  }

  /** The context the tools work in, null without a view */
  get toolContext(): ToolContext | null {
    return this.viewport?.ctx ?? null;
  }

  /** Where towers may stand on the ground, or nothing */
  showBuildAreas(areas: BuildAreas | null): void {
    this.viewport?.overlay.buildAreas.set(areas);
  }

  /** The spawns' routes, drawn while the path panel's switch shows them */
  showRoutes(routes: SpawnRoutes): void {
    this.routes = routes;
    this.refreshRoutes();
  }

  /** The map point the view looks at (the middle of a mirror) */
  viewCenter(): MapPoint | null {
    return this.viewport?.viewCenter() ?? null;
  }

  /** Where the camera stands and looks now, in map space; null without a view */
  introView(): MapIntroView | null {
    return this.viewport?.introView() ?? null;
  }

  /** Plays the map's intro flight in the view; `done` when it ends */
  previewIntro(intro: MapIntro | null): void {
    const vp = this.viewport;
    if (!intro || !vp) {
      vp?.extras.intro.stop();
      return;
    }
    this.introPreviewing.set(true);
    vp.extras.intro.start(intro, () => this.deps.zone.run(() => this.introPreviewing.set(false)));
  }

  /** The map's ambient sound on or off (from a click: browsers start audio only then) */
  setAmbience(on: boolean): void {
    patch(this.deps.settings.life, { hear: on });
    this.viewport?.extras.sound.set(on);
  }

  /** The map's wave sound once, its sound on from then (from a click) */
  playWaveSound(): void {
    patch(this.deps.settings.life, { hear: true });
    this.viewport?.extras.sound.playWave();
  }

  /** Calls `fn` in each frame the camera moved (the minimap's frame); returns the unsubscribe */
  onCamera(fn: () => void): () => void {
    this.cameraListeners.add(fn);
    return () => this.cameraListeners.delete(fn);
  }

  saveBookmark(slot: number): void {
    const vp = this.viewport;
    const id = this.mapId;
    if (!vp || !id || slot < 0 || slot > 8) return;
    const next = [...this.bookmarks()];
    next[slot] = vp.cameraView();
    this.bookmarks.set(next);
    try {
      localStorage.setItem(`${BOOKMARK_KEY}${id}`, JSON.stringify(next));
    } catch {
      // Without storage the bookmark lives until the page closes
    }
    this.deps.notices.flash(`View ${slot + 1} kept`);
  }

  showBookmark(slot: number): void {
    const v = this.bookmarks()[slot];
    if (v) this.viewport?.showView(v);
    else this.deps.notices.flash(`No view ${slot + 1} yet: Alt+${slot + 1} keeps the current one`);
  }

  private loadBookmarks(id: string): void {
    let list: (CameraBookmark | null)[] = Array(9).fill(null);
    try {
      const raw = localStorage.getItem(`${BOOKMARK_KEY}${id}`);
      if (raw) list = (JSON.parse(raw) as (CameraBookmark | null)[]).slice(0, 9);
    } catch {
      // Unreadable: start empty
    }
    this.bookmarks.set(list.concat(Array(9).fill(null)).slice(0, 9));
  }

  // ------------------------------------------------------------------ the page's side (EditorViewPort)

  get shown(): boolean {
    return !!this.viewport;
  }

  get dragging(): boolean {
    return !!this.viewport?.input.dragging;
  }

  get flying(): boolean {
    return !!this.viewport?.input.flying;
  }

  get topDown(): boolean {
    return !!this.viewport?.controller.isTopDown;
  }

  get trialRunning(): boolean {
    return !!this.viewport?.extras.trial.running;
  }

  frameMap(): void {
    this.viewport?.frameMap();
  }

  focusSelection(): void {
    this.viewport?.focusSelection();
  }

  focusOn(p: MapPoint, radius?: number): void {
    this.viewport?.focusOn(p, radius);
  }

  lookAt(x: number, y: number): void {
    const target = this.viewport?.controller.goal.target;
    if (!target) return;
    // Scene x = minus map east, scene z = map north
    target.x = -x;
    target.z = y;
  }

  cameraTarget(): MapPoint | null {
    const t = this.viewport?.controller.current.target;
    return t ? { x: -t.x, y: t.z } : null;
  }

  viewFootprint(): MapPoint[] {
    return this.viewport?.picker.footprint() ?? [];
  }

  showView(view: CameraBookmark, snap = false): void {
    this.viewport?.showView(view, snap);
  }

  setTopDown(on: boolean): void {
    this.viewport?.controller.setTopDown(on);
  }

  toggleGameView(): void {
    this.viewport?.extras.gameView.toggle();
  }

  toggleTrial(speed: number): boolean {
    const vp = this.viewport;
    if (!vp) return false;
    const trial = vp.extras.trial;
    trial.speed = speed;
    trial.toggle(this.routes);
    return trial.running;
  }

  setTrialSpeed(speed: number): void {
    if (this.viewport) this.viewport.extras.trial.speed = speed;
  }

  renderTopDown(width: number, height = width, overlay = false, area?: { x0: number; y0: number; x1: number; y1: number }): Promise<HTMLCanvasElement> {
    const vp = this.viewport;
    return vp ? vp.topDown.render(width, height, overlay, area) : Promise.reject(new Error('No view'));
  }

  warmUpAssets(assetIds: string[]): void {
    this.viewport?.warmup.assets(assetIds);
  }

  key(e: KeyboardEvent): boolean {
    return !!this.viewport?.input.key(e);
  }

  keyUp(e: KeyboardEvent): void {
    this.viewport?.input.keyUp(e);
  }

  focusCanvas(): void {
    this.viewport?.canvas.focus({ preventScroll: true });
  }

  /** The routes drawn again (the switch in the path panel) */
  refreshRoutes(): void {
    this.viewport?.overlay.routes.set(this.deps.settings.paths().showRoutes ? [...this.routes.values()] : []);
  }
}
