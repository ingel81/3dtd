/**
 * The editor page's state for the Angular side: the open map and its
 * history, the tools and their settings, the 3D viewport, saving (autosave
 * two seconds after the last edit, Ctrl+S at once with a fresh thumbnail),
 * the map check and the file actions. The panels read its signals; the
 * editing itself happens in the Angular-free model, ops and tools.
 */
import { Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';
import type { CustomMapDocument, MapMeta } from '../../world/custom-map/map-document';
import { createMapDocument, slugMapId, type NewMapOptions } from '../../world/custom-map/map-create';
import { MAP_FILE_EXTENSION, MapFileError, packMapFile } from '../../world/custom-map/map-file';
import { MapStore, type MapOrigin } from '../../world/custom-map/map-store';
import { BUILTIN_CATALOG, CatalogIndex, loadAssetCatalog } from '../catalog/asset-catalog';
import { EditorDocument, SnapshotCommand, type EditCommand, type Selection } from '../model/editor-document';
import { resizeMap } from '../ops/resize';
import { MarkerTool } from '../tools/marker-tool';
import { ObjectTool } from '../tools/object-tool';
import { PaintTool } from '../tools/paint-tool';
import { PathTool } from '../tools/path-tool';
import { TerrainTool } from '../tools/terrain-tool';
import { PanelTool, TOOLS, defaultSettings, type EditorSettings, type EditorTool, type ToolId } from '../tools/tool';
import { WaterTool } from '../tools/water-tool';
import { validateMap, type MapIssue } from '../validation/map-validation';
import { EditorViewport, type FrameStats, type HoverInfo } from '../view/editor-viewport';
import { loadW3xImporter, type W3xImportReport } from '../import/w3x-seam';
import { WORLD_URL_PARAM, worldUrlValue } from '../../world/world-ref';

export const AUTOSAVE_DELAY_MS = 2000;
const THUMBNAIL_SIZE = 256;

export interface ImportState {
  file: string;
  step: string;
  report: W3xImportReport | null;
  error: string | null;
}

@Injectable()
export class EditorSession implements OnDestroy {
  private readonly zone = inject(NgZone);
  readonly store = new MapStore();
  readonly catalog = signal(new CatalogIndex(BUILTIN_CATALOG));
  readonly settings = defaultSettings();
  /** Bumps when settings change from outside the panels (keys, a tool) */
  readonly settingsRev = signal(0);
  readonly tool = signal<ToolId>('terrain');
  readonly tools: Record<ToolId, EditorTool> = {
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
  readonly origin = signal<MapOrigin>('own');
  /** Bumps after edits (at most every 150 ms) so panels re-read the document */
  readonly docRev = signal(0);
  readonly meta = signal<MapMeta | null>(null);
  readonly dirty = signal(false);
  readonly canUndo = signal(false);
  readonly canRedo = signal(false);
  readonly undoLabel = signal<string | null>(null);
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
  readonly cameraRev = signal(0);
  readonly importState = signal<ImportState | null>(null);
  readonly error = signal<string | null>(null);

  private changed = false;
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

  // ---------------------------------------------------------------- map life

  async open(id: string, origin?: MapOrigin): Promise<void> {
    await this.catalogReady;
    const loaded = await this.store.load(id, origin);
    this.setDocument(loaded.doc, loaded.summary.origin);
  }

  async createNew(options: Omit<NewMapOptions, 'id'>): Promise<string> {
    await this.catalogReady;
    const id = await this.store.freeId(slugMapId(options.name));
    const doc = createMapDocument({ ...options, id });
    this.setDocument(doc, 'own');
    await this.save(true);
    return id;
  }

  /** Puts a map into the editor (opened, created or imported) */
  setDocument(doc: CustomMapDocument, origin: MapOrigin): void {
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    if (this.editor) this.editor.replace(doc);
    else this.editor = new EditorDocument(doc);
    const editor = this.editor;
    this.origin.set(origin);
    this.savedState = editor.stateId;
    this.issues.set(null);
    this.unsubscribe.push(
      editor.onChange(() => (this.changed = true)),
      editor.onSelection((s) => this.selection.set(s)),
    );
    this.refresh();
    if (this.viewport) {
      this.viewport.rebuildView();
      this.viewport.frameMap(true);
    }
  }

  /** Leaves the map (back to the browser); saves first when it changed */
  async close(): Promise<void> {
    if (this.editor && this.origin() === 'own') {
      if (this.dirty()) await this.save(true);
      else {
        // The list shows the map as it was left
        const preview = await this.thumbnail();
        if (preview) await this.store.setPreview(this.editor.doc.meta.id, preview).catch(() => undefined);
      }
    }
    this.detachViewport();
    for (const u of this.unsubscribe) u();
    this.unsubscribe = [];
    this.editor = null;
    this.meta.set(null);
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
        hover: (h) => this.hover.set(h),
        stats: (s) => this.stats.set(s),
        camera: () => this.cameraRev.update((n) => n + 1),
      });
      this.viewport.setTool(this.tools[this.tool()]);
    });
    this.hint.set(this.tools[this.tool()].hint(this.viewport!.ctx));
  }

  detachViewport(): void {
    this.viewport?.dispose();
    this.viewport = null;
  }

  selectTool(id: ToolId): void {
    this.tool.set(id);
    if (this.viewport) {
      this.viewport.setTool(this.tools[id]);
      this.hint.set(this.tools[id].hint(this.viewport.ctx));
    }
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

  undo(): void {
    if (this.editor?.undo()) this.flash(`Undone: ${this.redoLabelOf()}`);
    this.refresh();
  }

  redo(): void {
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
    const editor = this.editor;
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

  runCheck(): MapIssue[] {
    const doc = this.doc;
    if (!doc) return [];
    const catalog = this.catalog();
    const issues = validateMap(doc, { blocksBuild: (asset) => catalog.object(asset).blocksBuild });
    this.issues.set(issues);
    return issues;
  }

  // ---------------------------------------------------------------- saving

  /** Stores the map in the browser; `manual` also renders a new thumbnail */
  async save(manual = false): Promise<boolean> {
    const editor = this.editor;
    if (!editor || this.origin() !== 'own') return false;
    if (this.saving()) return false;
    this.clearAutosave();
    this.saving.set(true);
    const state = editor.stateId;
    try {
      const doc = editor.doc;
      doc.meta.updatedAt = new Date().toISOString();
      const preview = manual ? await this.thumbnail() : null;
      await this.store.save(doc, preview);
      this.savedState = state;
      editor.markSaved();
      this.savedAt.set(doc.meta.updatedAt);
      if (manual) this.flash('Saved');
      return true;
    } catch (e) {
      this.error.set(e instanceof MapFileError ? e.message : `Saving failed: ${(e as Error).message}`);
      return false;
    } finally {
      this.saving.set(false);
      this.refresh();
    }
  }

  /** The map as a `.3dtdmap` download */
  downloadFile(): void {
    const doc = this.doc;
    if (!doc) return;
    try {
      download(packMapFile(doc), `${doc.meta.id}${MAP_FILE_EXTENSION}`, 'application/zip');
    } catch (e) {
      this.error.set((e as Error).message);
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

  /** Saves, then opens the game on this map */
  async testPlay(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    if (this.origin() === 'own') await this.save(true);
    const url = new URL(document.baseURI);
    url.searchParams.set(WORLD_URL_PARAM, worldUrlValue({ kind: 'custom-map', mapId: doc.meta.id, contentHash: '' })!);
    window.open(url.toString(), '_blank');
  }

  // ---------------------------------------------------------------- import

  /** A `.3dtdmap` or `.w3x` file into a new own map; returns the new id */
  async importFile(file: File): Promise<string | null> {
    const name = file.name;
    const lower = name.toLowerCase();
    this.error.set(null);
    if (lower.endsWith(MAP_FILE_EXTENSION)) {
      try {
        const imported = await this.store.importFile(new Uint8Array(await file.arrayBuffer()));
        return imported.doc.meta.id;
      } catch (e) {
        this.error.set(`${name}: ${(e as Error).message}`);
        return null;
      }
    }
    if (lower.endsWith('.w3x') || lower.endsWith('.w3m')) return this.importW3x(file);
    this.error.set(`${name} is neither a 3DTD map (${MAP_FILE_EXTENSION}) nor a Warcraft 3 map (.w3x).`);
    return null;
  }

  private async importW3x(file: File): Promise<string | null> {
    const state: ImportState = { file: file.name, step: 'Converting the Warcraft map', report: null, error: null };
    this.importState.set(state);
    try {
      const importer = await loadW3xImporter();
      const { doc, report } = await importer(await file.arrayBuffer(), { fileName: file.name });
      doc.meta.id = await this.store.freeId(slugMapId(doc.meta.name || file.name.replace(/\.w3[xm]$/i, '')));
      await this.store.save(doc);
      this.importState.set({ ...state, step: 'Done', report });
      return doc.meta.id;
    } catch (e) {
      this.importState.set({ ...state, error: (e as Error).message });
      return null;
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
    if (this.dirty() && this.origin() === 'own') this.scheduleAutosave();
    if (this.issues()) this.runCheck();
  }

  private scheduleAutosave(): void {
    this.clearAutosave();
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

  ngOnDestroy(): void {
    if (this.tick) clearInterval(this.tick);
    this.clearAutosave();
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
