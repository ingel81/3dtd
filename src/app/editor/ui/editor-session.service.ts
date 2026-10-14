/**
 * The editor page's state for the Angular side: the open map and its
 * history, the tools and their settings, the 3D viewport, saving (autosave
 * two seconds after the last edit, Ctrl+S at once with a fresh thumbnail),
 * the map check and the file actions. The panels read its signals; the
 * editing itself happens in the Angular-free model, ops and tools.
 */
import type { GridRect } from '../model/grid';
import { startTerrainJob, type TerrainJob, type TerrainJobMessage } from '../workers/terrain-job';
import type { DocChange } from '../model/editor-document';
import { MAP_TEST_WINDOW, MAP_TRIAL_MESSAGE, MAP_TRIAL_WAVES_PARAM, type MapTrialResult } from '../../world/map-trial';
import { VersionHistory, type MapVersion } from '../model/version-store';
import { DOWNLOAD_REMINDER_MS, storageSafety, type StorageSafety } from '../model/storage-safety';
import { biomeById } from '../ops/landscape/biomes';
import { applyTemplate, type MapTemplate } from '../ops/landscape/templates';
import { Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';
import type { CustomMapDocument, MapMeta } from '../../world/custom-map/map-document';
import { createMapDocument, slugMapId, type NewMapOptions } from '../../world/custom-map/map-create';
import { MAP_FILE_EXTENSION, MapFileError, packMapFile, unpackMapFile } from '../../world/custom-map/map-file';
import { MapStore, type LoadedMap, type MapSummary } from '../../world/custom-map/map-store';
import { MapLock, whileMapFree } from '../model/map-lock';
import { CatalogIndex, EMPTY_CATALOG, loadAssetCatalog, type GroundMaterialEntry, type ObjectAssetEntry } from '../catalog/asset-catalog';
import type { BiomeDef } from '../ops/landscape/biomes';
import { ThumbnailRenderer } from '../view/thumbnail-renderer';
import { biomeThumbnail, materialThumbnail, objectThumbnail } from './thumbnails';
import { EditorDocument, SnapshotCommand, type EditCommand, type Selection } from '../model/editor-document';
import { resizeMap } from '../ops/resize';
import { detailTarget, increaseDetail } from '../ops/detail';
import { mirrorMap, type MirrorResult } from '../ops/mirror-map';
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { decodePng, decodeRaw16, encodePng16, encodeRaw16, gridToImage, heightmapName, imageToHeights } from '../ops/heightmap';
import { LandscapeTool } from '../tools/landscape-tool';
import { MarkerTool } from '../tools/marker-tool';
import { StampTool } from '../tools/stamp-tool';
import { MeasureTool } from '../tools/measure-tool';
import { StampLibrary } from '../model/stamp-store';
import { LandscapeStroke } from '../ops/landscape/landscape-stroke';
import { finishGenerated, generateTerrain, type GenerateOptions, type GenerateResult } from '../ops/generate';
import type { Stamp, StampRect } from '../ops/stamp';
import { ObjectTool } from '../tools/object-tool';
import { PaintTool } from '../tools/paint-tool';
import { PathTool } from '../tools/path-tool';
import { TerrainTool } from '../tools/terrain-tool';
import { PanelTool, TOOL_BRUSH_RADIUS, TOOLS, defaultSettings, type EditorSettings, type EditorTool, type ToolId } from '../tools/tool';
import { DEFAULT_BRUSH, type BrushSettings } from '../ops/brush';
import { WaterTool } from '../tools/water-tool';
import { validateMap, type MapIssue } from '../validation/map-validation';
import { EditorViewport, type CameraBookmark, type FrameStats, type HoverInfo } from '../view/editor-viewport';
import { DEFAULT_W3X_OPTIONS, loadW3xImporter, type W3xImportOptions, type W3xImportReport } from '../import/w3x-seam';
import { WORLD_URL_PARAM, worldUrlValue } from '../../world/world-ref';

export const AUTOSAVE_DELAY_MS = 2000;
const BOOKMARK_KEY = '3dtd-editor-views:';
const THUMBNAIL_SIZE = 256;

export interface ImportState {
  file: string;
  /** `options` waits for the player to start it, `running` converts, `done` has the report */
  phase: 'options' | 'running' | 'done';
  step: string;
  options: W3xImportOptions;
  report: W3xImportReport | null;
  /** The new map, once imported */
  mapId?: string;
  error: string | null;
}

/** A read file that is another version of an own map: replace that one or keep both */
export interface ImportMatch {
  file: string;
  existing: MapSummary;
  loaded: Pick<LoadedMap, 'doc' | 'preview'>;
  /** Hears the id of the stored map once the player chose */
  done?: (id: string) => void;
}

/** Waves the bot plays for the map check */
const BOT_CHECK_WAVES = 5;

/** Milliseconds between two looks at the map while it erodes (each redraws all the ground) */
const EROSION_SHOW_MS = 1000;

@Injectable()
export class EditorSession implements OnDestroy {
  /** The terrain job running (generate, erode the map) and how far it is */
  readonly terrainJob = signal<{ label: string; progress: number } | null>(null);
  private terrainAbort: AbortController | null = null;
  /** The 3D view lost its WebGL context and waits for it to come back; the map in memory is untouched */
  readonly viewLost = signal(false);
  /** The latest change of the document (a new object each time, for the tour) */
  readonly lastChange = signal<{ change: DocChange } | null>(null);
  /** The save running now, if any */
  private saveRun: Promise<boolean> | null = null;
  /** Counts the times the map view became ready (models and textures in): pictures of it are worth retaking */
  readonly viewRev = signal(0);
  /** The bot's check of the map: running (no result yet) or done */
  readonly botTrial = signal<{ waves: number; result: MapTrialResult | null } | null>(null);
  private stopBotListener: (() => void) | null = null;
  private readonly history = new VersionHistory();
  /** The open map's kept versions, newest first */
  readonly versions = signal<MapVersion[]>([]);
  /** Share of a template painted while a new map is made from one, null otherwise */
  readonly templateProgress = signal<number | null>(null);
  private readonly zone = inject(NgZone);
  readonly store = new MapStore();
  readonly stamps = new StampLibrary();
  readonly catalog = signal(new CatalogIndex(EMPTY_CATALOG));
  /** The editor opens on Landscape: its brush starts at Landscape's size */
  readonly settings = (() => {
    const s = defaultSettings();
    s.brush.radius = TOOL_BRUSH_RADIUS.landscape ?? s.brush.radius;
    return s;
  })();
  /** Bumps when settings change from outside the panels (keys, a tool) */
  readonly settingsRev = signal(0);
  readonly tool = signal<ToolId>('landscape');
  /** The brushes of the tools not in hand (selectTool swaps them) */
  private readonly brushes = new Map<ToolId, BrushSettings>();
  readonly tools: Record<ToolId, EditorTool> = {
    landscape: new LandscapeTool(),
    stamp: new StampTool(),
    measure: new MeasureTool(),
    gameplay: new PanelTool('gameplay', 'Start credits, HQ health, allowed towers and the waves of this map'),
    terrain: new TerrainTool(),
    paint: new PaintTool(),
    water: new WaterTool(),
    objects: new ObjectTool(),
    paths: new PathTool(),
    markers: new MarkerTool(),
    environment: new PanelTool('environment', 'Sky, sun and fog change the look of the map; the game uses them too'),
    settings: new PanelTool('settings', 'Name, author, description and size of the map'),
  };

  editor: EditorDocument | null = null;
  viewport: EditorViewport | null = null;
  /** Another tab edits this map (MapLock): this one shows it and changes nothing */
  readonly readOnly = signal(false);
  private lock: MapLock | null = null;
  /** Bumps after edits (at most every 150 ms) so panels re-read the document */
  readonly docRev = signal(0);
  readonly meta = signal<MapMeta | null>(null);
  readonly dirty = signal(false);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly undoLabel = signal<string | null>(null);
  /** The history for its list: steps done and undone */
  readonly steps = signal<{ done: string[]; undone: string[] }>({ done: [], undone: [] });
  readonly redoLabel = signal<string | null>(null);
  readonly selection = signal<Selection>(null);
  readonly saving = signal(false);
  readonly savedAt = signal<string | null>(null);
  readonly status = signal('');
  readonly hint = signal('');
  readonly hover = signal<HoverInfo | null>(null);
  readonly stats = signal<FrameStats | null>(null);
  readonly issues = signal<MapIssue[] | null>(null);
  readonly box = signal<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** The lasso outline as SVG points (client pixels), or null */
  readonly lasso = signal<string | null>(null);
  readonly cameraRev = signal(0);
  readonly importState = signal<ImportState | null>(null);
  /** A file read in that matches an own map, waiting for Replace or Keep both */
  readonly importMatch = signal<ImportMatch | null>(null);
  readonly error = signal<string | null>(null);
  /** How safe the maps are here (the browser may clear them unless it keeps them for good); null until known */
  readonly storage = signal<StorageSafety | null>(null);
  /** The reminder to download the map after long work in a browser that may clear it */
  readonly downloadReminder = signal(false);
  /** Asked the browser for persistent storage already (once a page, at the first save) */
  private persistAsked = false;
  /** Since when the map is edited without a download, for the reminder */
  private workSince = Date.now();
  /** Camera views 1 to 9 of the open map (kept per map in this browser) */
  readonly bookmarks = signal<(CameraBookmark | null)[]>(Array(9).fill(null));
  /** Bumps when a rendered palette picture is ready */
  readonly thumbRev = signal(0);
  private thumbRenderer: ThumbnailRenderer | null = null;

  private changed = false;
  /** A Warcraft map waiting for its import options */
  private pendingW3x: File | null = null;
  /** Aborts the running Warcraft import, null when none runs */
  private importAbort: AbortController | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  private savedState = -1;
  private unsubscribe: (() => void)[] = [];

  /** The asset catalogue is read before a map opens, so the view never swaps it */
  readonly catalogReady: Promise<void> = loadAssetCatalog().then((c) => this.catalog.set(new CatalogIndex(c)));

  constructor() {
    this.zone.runOutsideAngular(() => {
      this.tick = setInterval(() => this.pollChanges(), 150);
    });
  }

  get doc(): CustomMapDocument | null {
    return this.editor?.doc ?? null;
  }

  // ---------------------------------------------------------------- pictures

  /** Picture of an object for the palette: rendered when ready, a drawn symbol until then */
  objectPicture(entry: ObjectAssetEntry): string {
    this.thumbRev();
    return this.thumbs.object(entry) ?? objectThumbnail(entry);
  }

  materialPicture(entry: GroundMaterialEntry): string {
    this.thumbRev();
    return this.thumbs.material(entry) ?? materialThumbnail(entry);
  }

  biomePicture(biome: BiomeDef): string {
    this.thumbRev();
    const catalog = this.catalog();
    if (!catalog.catalog.objects.length) return biomeThumbnail(biome, catalog);
    return this.thumbs.biome(biome, catalog) ?? biomeThumbnail(biome, catalog);
  }

  private get thumbs(): ThumbnailRenderer {
    this.thumbRenderer ??= this.zone.runOutsideAngular(
      () => new ThumbnailRenderer(() => this.thumbRev.update((n) => n + 1)),
    );
    return this.thumbRenderer;
  }

  /**
   * Generates terrain over the whole map as one undo step. The terrain
   * worker builds it in bands that show as they come; Cancel puts the land
   * back. Resolves true when it finished.
   */
  async generate(options: GenerateOptions, repaint: boolean): Promise<boolean> {
    const editor = this.editor;
    if (!editor || this.terrainJob()) return false;
    const t = editor.doc.terrain;
    const catalog = this.catalog();
    const stroke = new LandscapeStroke(editor, 'Generate terrain', options.seed, catalog);
    const all = { i0: 0, j0: 0, i1: t.grid.columns - 1, j1: t.grid.rows - 1 };
    const texels = { i0: 0, j0: 0, i1: t.splat.resolution - 1, j1: t.splat.resolution - 1 };
    stroke.touchHeights(all);
    stroke.touchSplat(texels);
    const g = t.grid;
    let result: GenerateResult | null = null;
    const ok = await this.runTerrainJob(
      'Generating the terrain',
      { kind: 'generate', width: t.width, depth: t.depth, columns: g.columns, rows: g.rows, cellSize: g.cellSize, heights: g.heights, options },
      (m) => {
        if (m.kind === 'rows') {
          g.heights.set(m.heights, m.j0 * g.columns);
          editor.emit({ heights: { i0: 0, i1: g.columns - 1, j0: m.j0, j1: m.j1 - 1 } });
        } else if (m.kind === 'done') result = m.result;
      },
    );
    if (!ok || !result) return false;
    this.finishGenerate(stroke, result, repaint, all, texels);
    return true;
  }

  /**
   * Erodes the whole map in the terrain worker: rain drops carve gullies and
   * fans everywhere, `strength` 0..1 sets how many and how hard. Shows the
   * land between slices; Cancel puts it back; one undo step.
   */
  async erodeWholeMap(strength: number, seed = Math.floor(Math.random() * 1e9)): Promise<boolean> {
    const editor = this.editor;
    if (!editor || this.terrainJob()) return false;
    const t = editor.doc.terrain;
    const g = t.grid;
    const stroke = new LandscapeStroke(editor, 'Erode the map', seed, this.catalog());
    const all = { i0: 0, j0: 0, i1: g.columns - 1, j1: g.rows - 1 };
    stroke.touchHeights(all);
    const drops = Math.round(g.columns * g.rows * (0.15 + 0.85 * strength));
    let latest: Float32Array | null = null;
    let shownAt = performance.now();
    const ok = await this.runTerrainJob(
      'Eroding the map',
      { kind: 'erode', columns: g.columns, rows: g.rows, cellSize: g.cellSize, heights: g.heights, seed, strength: 0.4 + 0.6 * strength, drops },
      (m) => {
        // The whole ground redraws for each look: about one a second, and the last one always
        if (m.kind === 'heights') {
          latest = m.heights;
          if (performance.now() - shownAt < EROSION_SHOW_MS) return;
        } else if (!latest) return;
        g.heights.set(latest);
        latest = null;
        shownAt = performance.now();
        this.redrawInBands(g.columns, g.rows);
      },
    );
    if (!ok) return false;
    stroke.finish();
    this.refresh();
    return true;
  }

  /**
   * Tells the view about new heights all over the map a band of rows per
   * frame: one whole-map update stalls a big map's frame for a quarter of
   * a second, bands spread it out
   */
  private redrawInBands(columns: number, rows: number, band = 64): void {
    const editor = this.editor;
    if (!editor) return;
    let j0 = 0;
    const next = () => {
      if (this.editor !== editor || j0 >= rows) return;
      const j1 = Math.min(rows - 1, j0 + band - 1);
      editor.emit({ heights: { i0: 0, i1: columns - 1, j0, j1 } });
      j0 = j1 + 1;
      requestAnimationFrame(next);
    };
    next();
  }

  /** Stops the running terrain job; the land goes back to how it was */
  cancelTerrainJob(): void {
    this.terrainAbort?.abort();
  }

  /** Runs a job, the viewport locked meanwhile; on Cancel or an error the heights go back */
  private async runTerrainJob(label: string, job: TerrainJob, onMessage: (m: TerrainJobMessage) => void): Promise<boolean> {
    const editor = this.editor!;
    const heights = editor.doc.terrain.grid.heights;
    const before = heights.slice();
    const abort = new AbortController();
    this.terrainAbort = abort;
    this.terrainJob.set({ label, progress: 0 });
    this.viewport?.setLocked(true);
    try {
      await startTerrainJob(
        job,
        (m) =>
          this.zone.run(() => {
            if (m.kind !== 'done') this.terrainJob.set({ label, progress: m.progress });
            onMessage(m);
          }),
        abort.signal,
      );
      return true;
    } catch (e) {
      heights.set(before);
      editor.emit({ heights: { i0: 0, j0: 0, i1: editor.doc.terrain.grid.columns - 1, j1: editor.doc.terrain.grid.rows - 1 } });
      if ((e as Error).name === 'AbortError') this.flash(`${label.replace(/^\w/, (c) => c.toUpperCase())} stopped; the land is as it was`);
      else this.error.set(`${label} failed (${(e as Error).message}); the land is as it was.`);
      return false;
    } finally {
      this.terrainAbort = null;
      this.terrainJob.set(null);
      this.viewport?.setLocked(false);
    }
  }

  private finishGenerate(stroke: LandscapeStroke, result: GenerateResult, repaint: boolean, all: GridRect, texels: GridRect): void {
    const editor = this.editor!;
    const t = editor.doc.terrain;
    const catalog = this.catalog();
    if (result.water !== null) {
      stroke.ensureWater(result.water);
      stroke.touchWater(all);
      t.water!.mask.fill(255);
    }
    finishGenerated(editor.doc, { ...result, water: null }, (m) => catalog.materials.has(m), repaint);
    stroke.changed({ heights: all, splat: texels, water: true, layers: true });
    stroke.finish();
    this.refresh();
  }

  saveBookmark(slot: number): void {
    const vp = this.viewport;
    const id = this.doc?.meta.id;
    if (!vp || !id || slot < 0 || slot > 8) return;
    const next = [...this.bookmarks()];
    next[slot] = vp.cameraView();
    this.bookmarks.set(next);
    try {
      localStorage.setItem(`${BOOKMARK_KEY}${id}`, JSON.stringify(next));
    } catch {
      // Without storage the bookmark lives until the page closes
    }
    this.flash(`View ${slot + 1} kept`);
  }

  showBookmark(slot: number): void {
    const v = this.bookmarks()[slot];
    if (v) this.viewport?.showView(v);
    else this.flash(`No view ${slot + 1} yet: Alt+${slot + 1} keeps the current one`);
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

  /** Saves a piece as a stamp with a picture of its rectangle (when it is still on this map) */
  async saveStamp(name: string, stamp: Stamp, region: StampRect | null): Promise<void> {
    let preview: string | null = null;
    const vp = this.viewport;
    if (vp && region) {
      const w = Math.abs(region.x1 - region.x0);
      const h = Math.abs(region.y1 - region.y0);
      const k = 96 / Math.max(w, h);
      try {
        preview = vp.renderTopDown(Math.max(8, Math.round(w * k)), Math.max(8, Math.round(h * k)), false, region).toDataURL('image/png');
      } catch {
        preview = null;
      }
    }
    await this.stamps.save(name, stamp, preview);
  }

  // ---------------------------------------------------------------- map life

  /**
   * Opens a map for editing and returns the id of what opened: an own map
   * itself, a shipped or a coop host's map as a new own copy at once (saving
   * under their id would make them one's own, and edits to the original went
   * nowhere)
   */
  async open(id: string): Promise<string> {
    await this.catalogReady;
    const loaded = await this.store.load(id);
    if (loaded.summary.origin === 'own') {
      this.setDocument(loaded.doc);
      return id;
    }
    const name = loaded.doc.meta.name;
    const copy = await this.store.saveCopy(loaded);
    this.setDocument(copy.doc);
    this.flash(`This is your own copy of ${name}; the original stays as it is`);
    return copy.doc.meta.id;
  }

  async createNew(options: Omit<NewMapOptions, 'id'>, generator?: GenerateOptions, template?: MapTemplate): Promise<string> {
    await this.catalogReady;
    const id = await this.store.freeId(slugMapId(options.name));
    const catalog = this.catalog();
    if (template) {
      // The biome's own ground underneath, so no layer goes to a material it paints over
      const base = biomeById(template.biome).ground[0].material.find((m) => catalog.materials.has(m));
      if (base) options = { ...options, baseMaterial: base };
    }
    const doc = createMapDocument({ ...options, id });
    if (template) {
      await applyTemplate(doc, template, catalog, generator?.seed ?? 1, (done) => {
        this.templateProgress.set(done);
        return new Promise((r) => setTimeout(r));
      });
      this.templateProgress.set(null);
    } else if (generator && generator.preset !== 'flat') {
      finishGenerated(doc, generateTerrain(doc.terrain, generator), (m) => catalog.materials.has(m));
    }
    this.setDocument(doc);
    await this.save(true);
    return id;
  }

  /** Puts a map into the editor (opened, created or imported) and takes its lock, or opens it read-only */
  setDocument(doc: CustomMapDocument): void {
    this.lock?.close();
    this.readOnly.set(false);
    const lock = new MapLock(doc.meta.id, {
      granted: () => this.zone.run(() => void this.lockGranted(lock)),
      lost: () => this.zone.run(() => this.lockLost(lock)),
      beforeRelease: () => this.zone.run(() => this.letGo()),
    });
    this.lock = lock;
    void lock.start().then((editing) => {
      if (this.lock === lock && !editing) this.zone.run(() => this.lockLost(lock));
    });
    this.showDocument(doc, true);
  }

  /** Asks the tab that edits this map to save and let go; this one edits then */
  takeOver(): Promise<void> {
    this.flash('Asking the other tab to save and let go');
    return this.lock?.takeOver() ?? Promise.resolve();
  }

  /** This tab holds the map now: read it again (the other tab saved last) and edit */
  private async lockGranted(lock: MapLock): Promise<void> {
    if (this.lock !== lock || !this.editor) return;
    try {
      const loaded = await this.store.load(this.editor.doc.meta.id);
      if (this.lock !== lock) return;
      this.showDocument(loaded.doc, false);
    } catch (e) {
      this.error.set(`The map could not be read again (${(e as Error).message}). Reload the page before you change it.`);
      return;
    }
    this.readOnly.set(false);
    this.viewport?.setLocked(false);
    this.flash('You edit this map now');
  }

  /** Another tab edits this map: this one turns read-only */
  private lockLost(lock: MapLock): void {
    if (this.lock !== lock) return;
    this.readOnly.set(true);
    this.clearAutosave();
    this.viewport?.setLocked(true);
    this.refresh();
  }

  /** Another tab asks for the map: what is half done is dropped, the rest saved */
  private async letGo(): Promise<void> {
    this.viewport?.setLocked(true);
    this.terrainAbort?.abort();
    while (this.terrainJob()) await new Promise((r) => setTimeout(r, 20));
    if (this.dirty() || this.saveRun) await this.save(false);
    this.flash('Another tab took over this map; this one is read-only now');
  }

  private showDocument(doc: CustomMapDocument, frame: boolean): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    if (this.editor) this.editor.replace(doc);
    else this.editor = new EditorDocument(doc);
    const editor = this.editor;
    this.savedState = editor.stateId;
    this.loadBookmarks(doc.meta.id);
    this.workSince = Date.now();
    this.downloadReminder.set(false);
    if (!this.storage()) void storageSafety(false).then((s) => this.storage.set(s));
    this.versions.set([]);
    void this.loadVersions();
    this.issues.set(null);
    this.unsubscribe.push(
      editor.onChange((change) => {
        this.changed = true;
        this.lastChange.set({ change });
      }),
      editor.onSelection((s) => this.selection.set(s)),
    );
    this.refresh();
    if (this.viewport) {
      this.viewport.rebuildView();
      if (frame) this.viewport.frameMap(true);
    }
  }

  /**
   * Leaves the map (back to the browser); saves first when it changed. A
   * save that fails keeps the map open (returns false), nothing is lost.
   */
  async close(): Promise<boolean> {
    if (this.editor && !this.readOnly() && this.blocked('Leaving the map')) return false;
    if (this.editor && !this.readOnly()) {
      if (this.dirty() || this.saveRun) {
        if (!(await this.save(true)) || this.dirty()) {
          this.flash('The map could not be saved; it stays open');
          return false;
        }
      } else {
        // The list shows the map as it was left
        const preview = await this.thumbnail();
        if (preview) await this.store.setPreview(this.editor.doc.meta.id, preview).catch(() => undefined);
      }
    }
    this.detachViewport();
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.lock?.close();
    this.lock = null;
    this.readOnly.set(false);
    this.editor = null;
    this.meta.set(null);
    return true;
  }

  // ---------------------------------------------------------------- viewport

  attachViewport(canvas: HTMLCanvasElement): void {
    const editor = this.editor;
    if (!editor) return;
    this.zone.runOutsideAngular(() => {
      this.viewport = new EditorViewport(canvas, editor, this.catalog(), this.settings, {
        status: (m) => this.flash(m),
        settingsChanged: () => this.settingsRev.update((n) => n + 1),
        box: (b) => this.box.set(b),
        lasso: (points) => this.lasso.set(points ? points.map((q) => `${Math.round(q.x)},${Math.round(q.y)}`).join(' ') : null),
        hover: (h) => this.hover.set(h),
        stats: (s) => this.stats.set(s),
        camera: () => this.cameraRev.update((n) => n + 1),
        viewReady: () => this.zone.run(() => this.viewRev.update((n) => n + 1)),
        contextLost: (lost) => this.zone.run(() => this.onContextLost(lost)),
      });
      this.viewport.setTool(this.tools[this.tool()]);
      if (this.readOnly()) this.viewport.setLocked(true);
    });
    this.hint.set(this.tools[this.tool()].hint(this.viewport!.ctx));
  }

  /** The view's context went: the map is saved at once (it lives in memory, not on the GPU); back, the view is rebuilt */
  onContextLost(lost: boolean): void {
    this.viewLost.set(lost);
    if (lost) {
      this.refresh();
      if (this.dirty() && !this.readOnly()) void this.save(false);
    } else this.flash('The view is back');
  }

  /** The view does not come back: save, then load the page anew */
  async reloadPage(): Promise<void> {
    this.refresh();
    if (this.dirty() && !this.readOnly()) await this.save(false);
    location.reload();
  }

  detachViewport(): void {
    this.viewport?.dispose();
    this.viewport = null;
  }

  selectTool(id: ToolId): void {
    const previous = this.tool();
    if (previous !== id) {
      // Every tool keeps its own brush: a big landscape brush is no big paint brush
      this.brushes.set(previous, { ...this.settings.brush });
      this.settings.brush = this.brushFor(id);
      this.settingsRev.update((n) => n + 1);
    }
    this.tool.set(id);
    if (this.viewport) {
      this.viewport.setTool(this.tools[id]);
      this.hint.set(this.tools[id].hint(this.viewport.ctx));
    }
  }

  /** The brush a tool had last, or its own first size */
  private brushFor(id: ToolId): BrushSettings {
    const kept = this.brushes.get(id);
    if (kept) return { ...kept };
    return { ...DEFAULT_BRUSH, radius: TOOL_BRUSH_RADIUS[id] ?? DEFAULT_BRUSH.radius };
  }

  /** Change settings from a panel */
  patchSettings(fn: (s: EditorSettings) => void): void {
    fn(this.settings);
    this.settingsRev.update((n) => n + 1);
    this.settingsTouched();
  }

  /** Settings changed in a panel: the hint may say something new */
  settingsTouched(): void {
    if (this.viewport) this.hint.set(this.tools[this.tool()].hint(this.viewport.ctx));
  }

  // ---------------------------------------------------------------- editing

  execute(command: EditCommand): void {
    this.editor?.execute(command);
    this.refresh();
  }

  /**
   * What the map is in the middle of: a stroke or a drag in the view, or a
   * terrain job. Undo, redo, saving, pasting and restoring wait meanwhile:
   * an undo under a running job came back with the heights of before the
   * job on Cancel, over steps already undone. Null when free.
   */
  busyReason(): string | null {
    if (this.readOnly()) return 'another tab edits this map (Take over editing)';
    if (this.terrainJob()) return 'the terrain job runs (Cancel stops it)';
    if (this.viewport?.dragging) return 'finish the stroke or drag first';
    return null;
  }

  /**
   * The editor for a change from a panel that touches the ground (heights,
   * paint, water, the grid), or null with a line in the status bar while it
   * has to wait: a terrain job holds the heights it started from and puts
   * them back on Cancel, over anything changed meanwhile
   */
  groundEditor(what: string): EditorDocument | null {
    return this.blocked(what) ? null : this.editor;
  }

  /** True (with a line in the status bar) when `what` has to wait */
  blocked(what: string): boolean {
    const reason = this.busyReason();
    if (reason) this.flash(`${what} waits: ${reason}`);
    return !!reason;
  }

  undo(): void {
    if (this.blocked('Undo')) return;
    if (this.editor?.undo()) this.flash(`Undone: ${this.redoLabelOf()}`);
    this.refresh();
  }

  /** Back or forward to the state after `steps` steps (0: as opened) */
  jumpTo(steps: number): void {
    if (this.blocked('Going through the history')) return;
    const e = this.editor;
    if (!e || steps === e.historySteps) return;
    if (e.jumpTo(steps)) this.flash(steps ? `Back to: ${e.undoLabel}` : 'Back to the map as it was opened');
    this.refresh();
  }

  redo(): void {
    if (this.blocked('Redo')) return;
    if (this.editor?.redo()) this.flash(`Redone: ${this.editor.undoLabel}`);
    this.refresh();
  }

  editMeta(patch: Partial<Pick<MapMeta, 'name' | 'author' | 'description'>>): void {
    const editor = this.editor;
    if (!editor) return;
    this.execute(SnapshotCommand.record(editor.doc, 'Map details', ['meta'], (d) => (d.meta = { ...d.meta, ...patch })));
  }

  editEnvironment(patch: Partial<CustomMapDocument['environment']>, label = 'Environment'): void {
    const editor = this.editor;
    if (!editor) return;
    this.execute(SnapshotCommand.record(editor.doc, label, ['environment'], (d) => (d.environment = { ...d.environment, ...patch })));
  }

  resize(width: number, depth: number): void {
    const editor = this.groundEditor('Resizing');
    if (!editor) return;
    let dropped = { droppedObjects: 0, droppedNodes: 0 };
    this.execute(
      SnapshotCommand.record(editor.doc, 'Resize map', ['terrain', 'objects', 'paths', 'spawns', 'hq'], (d) => {
        dropped = resizeMap(d, width, depth);
      }),
    );
    this.viewport?.frameMap();
    const lost = dropped.droppedObjects + dropped.droppedNodes;
    this.flash(lost ? `Resized; ${dropped.droppedObjects} objects and ${dropped.droppedNodes} road nodes fell outside` : 'Resized');
  }

  /** Refines coarse ground to the detail of new maps (2 m height points, the splat to match); one undo step */
  increaseDetail(): void {
    const editor = this.groundEditor('Increasing the detail');
    const target = editor && detailTarget(editor.doc.terrain);
    if (!editor || !target) return;
    this.execute(SnapshotCommand.record(editor.doc, 'Increase detail', ['terrain'], (d) => (d.terrain = increaseDetail(d.terrain, target))));
    this.flash(`Height points every ${+target.cellSize.toFixed(2)} m, ground paint ${target.splatResolution} px; Ctrl+Z takes it back`);
  }

  /**
   * Makes the whole map symmetric now (the symmetry chosen in the top bar):
   * the part around the view's middle is copied to the others, ground,
   * water, objects, spawns, roads and rivers; one undo step
   */
  mirrorNow(): void {
    const editor = this.editor;
    const mode = this.settings.symmetry;
    if (!editor || this.blocked('Mirroring')) return;
    if (mode === 'none') {
      this.flash('Choose a symmetry first (top bar or M)');
      return;
    }
    const from = this.viewport?.viewCenter() ?? editor.doc.hq;
    let result: MirrorResult = { objects: 0, spawns: 0, roads: 0 };
    this.execute(SnapshotCommand.record(editor.doc, 'Mirror the map', ['terrain', 'objects', 'paths', 'spawns'], (d) => (result = mirrorMap(d, mode, from))));
    const leftOut = result.spawnsLeftOut ? ` (${result.spawnsLeftOut} spawns left out: a map holds at most ${MAX_SPAWN_PORTALS})` : '';
    this.flash(`Mirrored from the part in view: ${result.objects} objects, ${result.spawns} spawns, ${result.roads} roads copied${leftOut}`);
  }

  runCheck(): MapIssue[] {
    const doc = this.doc;
    if (!doc) return [];
    const catalog = this.catalog();
    const issues = validateMap(doc, { blocksBuild: (asset) => catalog.object(asset).blocksBuild });
    this.issues.set(issues);
    return issues;
  }

  // ---------------------------------------------------------------- saving

  /**
   * Stores the map in the browser; `manual` also renders a new thumbnail.
   * A save asked for while one runs waits for it (Ctrl+S during an
   * autosave is not lost); an autosave with nothing new does nothing.
   */
  async save(manual = false): Promise<boolean> {
    if (!this.editor) return false;
    // Half a stroke or a job's land is no state to keep: Ctrl+S says why, an autosave comes again later
    if (manual ? this.blocked('Saving') : this.busyReason()) {
      if (!manual) this.scheduleAutosave();
      return false;
    }
    while (this.saveRun) await this.saveRun.catch(() => false);
    if (!manual && !this.dirty()) return true;
    this.saveRun = this.runSave(manual);
    try {
      return await this.saveRun;
    } finally {
      this.saveRun = null;
    }
  }

  private async runSave(manual: boolean): Promise<boolean> {
    const editor = this.editor;
    if (!editor) return false;
    this.clearAutosave();
    this.saving.set(true);
    const state = editor.stateId;
    try {
      const doc = editor.doc;
      doc.meta.updatedAt = new Date().toISOString();
      const preview = manual ? await this.thumbnail() : null;
      // An autosave packs fast and leaves the hash for when the game asks for it
      const file = packMapFile(doc, { level: manual ? 6 : 1 });
      await this.store.save(doc, preview, file, { hash: manual });
      // A version for the history; a full browser store must not fail the save
      const id = doc.meta.id;
      void this.history
        .record(id, doc.meta.createdAt, file, manual)
        .then((v) => (v ? this.loadVersions() : undefined))
        .catch(() => undefined);
      this.savedState = state;
      editor.markSaved();
      this.savedAt.set(doc.meta.updatedAt);
      if (manual) this.flash('Saved');
      this.guardStorage();
      return true;
    } catch (e) {
      this.error.set(saveErrorText(e));
      return false;
    } finally {
      this.saving.set(false);
      this.refresh();
      // Changes made while it ran get their own autosave
      if (this.dirty() && !this.readOnly()) this.scheduleAutosave();
    }
  }

  /** The open map's kept versions, newest first */
  async loadVersions(): Promise<void> {
    const meta = this.doc?.meta;
    if (!meta) return;
    try {
      const list = await this.history.list(meta.id, meta.createdAt);
      if (this.doc?.meta === meta) this.versions.set(list);
    } catch {
      this.versions.set([]);
    }
  }

  /**
   * Moves an own map to the trash (its versions stay with it); returns the
   * trash key, or null while another tab edits the map (its next save would
   * bring the map back beside the one in the trash)
   */
  async deleteMap(id: string, name = id): Promise<string | null> {
    const trashed = await whileMapFree(id, () => this.store.trash(id));
    if (trashed.done) return trashed.value;
    this.error.set(`${name} is open in another tab. Close it there, then delete it.`);
    return null;
  }

  /** A map back from the trash; returns its id (a free one when its own is taken meanwhile) */
  async restoreMap(key: string): Promise<string> {
    const trash = (await this.store.listTrash()).find((m) => m.id === key)?.trash;
    const id = await this.store.restoreFromTrash(key);
    // Under a free id, when a new map took its own meanwhile: its versions come along
    if (trash && id !== trash.from) await this.history.move(trash.from, id, trash.created).catch(() => undefined);
    return id;
  }

  /** Removes a map from the trash for good, with its versions */
  async deleteForGood(m: MapSummary): Promise<void> {
    await this.store.delete(m.id);
    if (m.trash) await this.history.clear(m.trash.from, m.trash.created).catch(() => undefined);
  }

  /** The trash, after what waited longer than TRASH_DAYS went for good (with its versions) */
  async listTrash(): Promise<MapSummary[]> {
    for (const m of await this.store.purgeTrash().catch(() => [])) {
      if (m.trash) await this.history.clear(m.trash.from, m.trash.created).catch(() => undefined);
    }
    return this.store.listTrash();
  }

  /** Pins a version against the thinning, or lets it go */
  async pinVersion(version: MapVersion, pinned: boolean): Promise<void> {
    try {
      await this.history.pin(version, pinned);
    } catch (e) {
      this.error.set(`The version could not be ${pinned ? 'pinned' : 'unpinned'} (${(e as Error).message}).`);
    }
    await this.loadVersions();
  }

  /** Puts a kept version back as one undo step (terrain, objects, roads, markers, look, rules) */
  async restoreVersion(version: MapVersion): Promise<void> {
    const editor = this.editor;
    if (!editor || this.blocked('Restore')) return;
    try {
      const bytes = await this.history.bytes(version);
      if (!bytes) throw new Error('the version is gone');
      if (this.editor !== editor) return;
      const { doc } = unpackMapFile(bytes);
      const parts = ['terrain', 'objects', 'paths', 'spawns', 'hq', 'environment', 'gameplay'] as const;
      editor.execute(
        SnapshotCommand.record(editor.doc, 'Restore version', parts, (d) => {
          for (const k of parts) (d as unknown as Record<string, unknown>)[k] = structuredClone(doc[k]);
        }),
      );
      this.flash(`Back to the version of ${new Date(version.savedAt).toLocaleString()}`);
    } catch (e) {
      this.error.set(`This version could not be read (${(e as Error).message}). The map is as it was.`);
    }
  }

  /**
   * After a save: the first one asks the browser to keep the maps for good;
   * where it may clear them, long work without a download brings a reminder
   */
  private guardStorage(): void {
    if (!this.persistAsked) {
      this.persistAsked = true;
      void storageSafety(true).then((s) => this.storage.set(s));
    }
    if (this.storage() === 'evictable' && Date.now() - this.workSince > DOWNLOAD_REMINDER_MS) this.downloadReminder.set(true);
  }

  /** The reminder put off: it comes back after the next stretch of work */
  laterReminder(): void {
    this.workSince = Date.now();
    this.downloadReminder.set(false);
  }

  /** The map as a `.3dtdmap` download */
  downloadFile(): void {
    const doc = this.doc;
    if (!doc) return;
    try {
      download(packMapFile(doc), `${doc.meta.id}${MAP_FILE_EXTENSION}`, 'application/zip');
      this.laterReminder();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  /** The heights as a 16-bit heightmap (PNG or RAW); the file name carries their range in metres */
  downloadHeightmap(format: 'png' | 'raw'): void {
    const doc = this.doc;
    if (!doc) return;
    const { image, low, high } = gridToImage(doc.terrain.grid);
    const name = heightmapName(doc.meta.id, low, high, format);
    download(format === 'png' ? encodePng16(image) : encodeRaw16(image), name, format === 'png' ? 'image/png' : 'application/octet-stream');
    this.flash(`Heightmap ${image.width} x ${image.height}, ${Math.round(low * 10) / 10} to ${Math.round(high * 10) / 10} m`);
  }

  /**
   * A heightmap file (16-bit PNG, or square 16-bit RAW) as the map's ground:
   * scaled to the map's grid, black at `low`, white at `high` metres; one
   * undo step. Resolves false (with the reason in the banner) when the file
   * is no heightmap.
   */
  async importHeightmap(file: File, low: number, high: number): Promise<boolean> {
    const editor = this.editor;
    if (!editor || this.blocked('Importing a heightmap')) return false;
    // A height that is not a number would make the map unreadable once saved (map-file checks every height)
    if (!Number.isFinite(low) || !Number.isFinite(high) || Math.abs(high - low) > 10000) {
      this.error.set('The heightmap needs a lowest and a highest height in metres, at most 10 km apart.');
      return false;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const image = /\.png$/i.test(file.name) ? decodePng(bytes) : decodeRaw16(bytes);
      const t = editor.doc.terrain;
      const g = t.grid;
      const all = { i0: 0, j0: 0, i1: g.columns - 1, j1: g.rows - 1 };
      const stroke = new LandscapeStroke(editor, 'Import heightmap', 1, this.catalog());
      stroke.touchHeights(all);
      g.heights.set(imageToHeights(image, g.columns, g.rows, low, high));
      stroke.changed({ heights: all });
      stroke.finish();
      this.refresh();
      this.flash(`Heightmap ${image.width} x ${image.height} on the ${g.columns} x ${g.rows} grid, ${low} to ${high} m; Ctrl+Z takes it back`);
      return true;
    } catch (e) {
      this.error.set(`${file.name}: ${(e as Error).message}`);
      return false;
    }
  }

  /** A top-down picture of the map as PNG */
  async downloadPng(size = 2048): Promise<void> {
    const vp = this.viewport;
    const doc = this.doc;
    if (!vp || !doc) return;
    const aspect = doc.terrain.depth / doc.terrain.width;
    const w = aspect <= 1 ? size : Math.round(size / aspect);
    const h = aspect <= 1 ? Math.round(size * aspect) : size;
    const canvas = vp.renderTopDown(w, h, true);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (blob) download(new Uint8Array(await blob.arrayBuffer()), `${doc.meta.id}.png`, 'image/png');
  }

  /**
   * The game's bot plays the first waves of this map in the test tab at high
   * speed (`?bot=trial&trialWaves=N`) and sends its result back
   */
  async botCheck(waves = BOT_CHECK_WAVES): Promise<void> {
    const doc = this.doc;
    if (!doc || this.blocked('The bot check')) return;
    await this.save(true);
    const url = new URL(document.baseURI);
    url.searchParams.set(WORLD_URL_PARAM, worldUrlValue({ kind: 'custom-map', mapId: doc.meta.id, contentHash: '' })!);
    url.searchParams.set('bot', 'trial');
    url.searchParams.set(MAP_TRIAL_WAVES_PARAM, String(waves));
    this.botTrial.set({ waves, result: null });
    this.stopBotListener?.();
    const listen = (e: MessageEvent) => {
      const data = e.data as { type?: string; result?: MapTrialResult } | null;
      if (e.origin !== window.location.origin || data?.type !== MAP_TRIAL_MESSAGE || !data.result) return;
      this.zone.run(() => this.botTrial.set({ waves, result: data.result! }));
      this.stopBotListener?.();
    };
    window.addEventListener('message', listen);
    this.stopBotListener = () => {
      window.removeEventListener('message', listen);
      this.stopBotListener = null;
    };
    window.open(url.toString(), MAP_TEST_WINDOW);
  }

  /** Saves, then opens the game on this map in the test tab (the one tab each test reuses) */
  async testPlay(): Promise<void> {
    const doc = this.doc;
    if (!doc || this.blocked('The test')) return;
    await this.save(true);
    const url = new URL(document.baseURI);
    url.searchParams.set(WORLD_URL_PARAM, worldUrlValue({ kind: 'custom-map', mapId: doc.meta.id, contentHash: '' })!);
    window.open(url.toString(), MAP_TEST_WINDOW);
  }

  // ---------------------------------------------------------------- import

  /**
   * A `.3dtdmap` or `.w3x` file into a new own map; returns the new id. A
   * file that is another version of an own map (the same identity, or the
   * same Warcraft file) waits in `importMatch` for Replace or Keep both.
   */
  async importFile(file: File): Promise<string | null> {
    const name = file.name;
    const lower = name.toLowerCase();
    this.error.set(null);
    if (lower.endsWith(MAP_FILE_EXTENSION)) {
      try {
        const loaded = unpackMapFile(new Uint8Array(await file.arrayBuffer()));
        const existing = await this.store.ownMatch(loaded.doc);
        if (existing) {
          this.importMatch.set({ file: name, existing, loaded });
          return null;
        }
        return (await this.store.importDocument(loaded)).doc.meta.id;
      } catch (e) {
        this.error.set(`${name}: ${(e as Error).message}`);
        return null;
      }
    }
    if (lower.endsWith('.w3x') || lower.endsWith('.w3m')) {
      // Warcraft maps first show their options; importW3x starts the conversion
      this.pendingW3x = file;
      this.importState.set({
        file: file.name,
        phase: 'options',
        step: 'Choose how to import',
        options: { fileName: file.name, ...DEFAULT_W3X_OPTIONS },
        report: null,
        error: null,
      });
      return null;
    }
    this.error.set(`${name} is neither a 3DTD map (${MAP_FILE_EXTENSION}) nor a Warcraft 3 map (.w3x).`);
    return null;
  }

  /**
   * The player's answer to a file that matches an own map: replace keeps the
   * map's id and versions (its content before becomes a version to go back
   * to), copy stores the file as a new map beside it. Returns the stored id.
   */
  async resolveImport(choice: 'replace' | 'copy' | 'cancel'): Promise<string | null> {
    const match = this.importMatch();
    this.importMatch.set(null);
    if (!match || choice === 'cancel') return null;
    try {
      let id: string;
      if (choice === 'replace') {
        id = match.existing.id;
        // A tab editing the map would save its own state over the new content
        const replaced = await whileMapFree(id, () => this.store.replaceWith(id, match.loaded));
        if (!replaced.done) {
          this.error.set(`${match.file}: ${match.existing.name} is open in another tab. Close it there, then import again (or import as a copy).`);
          return null;
        }
        await this.history.record(id, replaced.value.created, replaced.value.before, true).catch(() => undefined);
      } else {
        id = (await this.store.importDocument(match.loaded)).doc.meta.id;
      }
      match.done?.(id);
      return id;
    } catch (e) {
      this.error.set(`${match.file}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Ends a running Warcraft import (its worker stops) and closes the panel */
  cancelImport(): void {
    this.importAbort?.abort();
    this.importAbort = null;
    this.pendingW3x = null;
    this.importState.set(null);
  }

  /** Converts the Warcraft map waiting in the import panel with its options */
  async importW3x(options: Partial<W3xImportOptions> = {}): Promise<string | null> {
    const file = this.pendingW3x;
    const current = this.importState();
    if (!file || !current) return null;
    this.importAbort?.abort();
    const abort = new AbortController();
    this.importAbort = abort;
    const state: ImportState = {
      ...current,
      phase: 'running',
      step: 'Converting the Warcraft map',
      options: { ...current.options, ...options },
      error: null,
    };
    this.importState.set(state);
    try {
      const importer = await loadW3xImporter();
      const { doc, report } = await importer(await file.arrayBuffer(), state.options, abort.signal);
      if (abort.signal.aborted) return null;
      doc.meta.id = await this.store.freeId(slugMapId(doc.meta.name || file.name.replace(/\.w3[xm]$/i, '')));
      this.pendingW3x = null;
      const done = (id: string) => this.importState.set({ ...state, phase: 'done', step: 'Done', report, mapId: id });
      const existing = await this.store.ownMatch(doc);
      if (existing) {
        this.importState.set({ ...state, phase: 'done', step: 'Replace or keep both?', report });
        this.importMatch.set({ file: file.name, existing, loaded: { doc, preview: null }, done });
        return null;
      }
      await this.store.save(doc);
      done(doc.meta.id);
      return doc.meta.id;
    } catch (e) {
      if (!abort.signal.aborted) this.importState.set({ ...state, error: (e as Error).message });
      return null;
    } finally {
      if (this.importAbort === abort) this.importAbort = null;
    }
  }

  // ---------------------------------------------------------------- inside

  flash(message: string): void {
    this.status.set(message);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => this.status.set(''), 3500);
  }

  /** Re-reads the history and document state into the signals */
  refresh(): void {
    const e = this.editor;
    this.meta.set(e ? { ...e.doc.meta } : null);
    this.dirty.set(!!e && e.stateId !== this.savedState);
    this.canUndo.set(!!e?.canUndo);
    this.canRedo.set(!!e?.canRedo);
    this.undoLabel.set(e?.undoLabel ?? null);
    this.steps.set(e ? e.history : { done: [], undone: [] });
    this.redoLabel.set(e?.redoLabel ?? null);
    this.docRev.update((n) => n + 1);
    if (this.viewport) this.hint.set(this.tools[this.tool()].hint(this.viewport.ctx));
  }

  private redoLabelOf(): string {
    return this.editor?.redoLabel ?? '';
  }

  private pollChanges(): void {
    if (!this.changed) return;
    this.changed = false;
    this.refresh();
    if (this.dirty() && !this.readOnly()) this.scheduleAutosave();
    if (this.issues()) this.runCheck();
  }

  private scheduleAutosave(): void {
    this.clearAutosave();
    if (this.destroyed) return;
    this.autosaveTimer = setTimeout(() => void this.save(false), AUTOSAVE_DELAY_MS);
  }

  private clearAutosave(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  private async thumbnail(): Promise<Uint8Array | null> {
    const vp = this.viewport;
    if (!vp) return null;
    try {
      const canvas = vp.renderTopDown(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }

  private destroyed = false;

  ngOnDestroy(): void {
    this.destroyed = true;
    this.terrainAbort?.abort();
    this.thumbRenderer?.dispose();
    if (this.tick) clearInterval(this.tick);
    this.clearAutosave();
    // Leaving the page (another route): what is not saved yet goes now
    if (this.editor && this.dirty() && !this.readOnly()) void this.save(false);
    this.lock?.close();
    this.stopBotListener?.();
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.detachViewport();
    for (const u of this.unsubscribe) u();
  }
}

/** Tool info by id, for the toolbar */
export const TOOL_INFO = new Map(TOOLS.map((t) => [t.id, t]));

export function download(bytes: Uint8Array, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** What a failed save tells the player: what happened, that nothing is lost yet, what to do */
export function saveErrorText(e: unknown): string {
  if (e instanceof MapFileError) return `The map was not saved: ${e.message} Fix it (Check, V) and save again.`;
  const err = e as { name?: string; message?: string } | null;
  if (err?.name === 'QuotaExceededError' || /quota|storage full/i.test(err?.message ?? '')) {
    return 'The map was not saved: the browser has no more room for maps. Your changes are still here: download the map (File menu) and delete maps you no longer need.';
  }
  return `The map was not saved (${err?.message ?? 'unknown error'}). Your changes are still here; try again or download the map (File menu).`;
}
