/**
 * The editor for the Angular side: one service per concern, and the door
 * every change from a panel goes through (`edit`). The services:
 *
 *   maps      which map is open, opening, closing, own copies, the tab's lock (MapLifecycle)
 *   state     the map's revision per part and the history for the panels (EditorState)
 *   tools     the tool in hand, the settings, the line of help (ToolHost)
 *   view      the 3D view on the page, as far as the page may use it (EditorViewPort)
 *   saves     autosave, Ctrl+S, versions, storage safety, the download (SaveService)
 *   core      the editor's worker with its mirror of the map: packing, checks (EditorCore)
 *   routes    each spawn's route to the HQ, found in that worker (EditorRoutes)
 *   minimap   the minimap's roads and markers, drawn in that worker (EditorMinimap)
 *   jobs      generating, eroding, an agent's play: one at a time with Cancel (JobRunner)
 *   check     the map check, build areas, test and bot check in the game (CheckService)
 *   library   maps and stamps kept, the trash, reading files in (MapLibrary)
 *   pictures  palette pictures and pictures of the map (EditorPictures)
 *   agent     the AI agent's host and switch (AgentAdapter, desktop app)
 *   notices   the status line and the banner (EditorNotices)
 *
 * The editing itself happens in the Angular-free model, ops and tools.
 */
import { Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';
import { MAX_MAP_PREFABS, type CustomMapDocument, type MapIntro, type MapLife, type MapMeta } from '../../world/custom-map/map-document';
import { AppScreen } from '../../world/app-screen.service';
import { WorldSession } from '../../world/world-session.service';
import { CatalogIndex, EMPTY_CATALOG, loadAssetCatalog } from '../../map-ops/asset-catalog';
import { MAX_SPAWN_PORTALS } from '../../configs/marker-geometry.config';
import { downloadBlob } from '../../utils/download';
import type { EditCommand } from '../model/doc-change';
import { EditorHeldError, type EditorDocument } from '../model/editor-document';
import { SnapshotCommand } from '../model/commands/snapshot';
import { stampEntry, type SavedStamp, type StampKeep } from '../model/stamp-store';
import type { MapVersion } from '../model/version-store';
import { decodePng, decodeRaw16, encodePng16, encodeRaw16, gridToImage, heightmapName, squareImage, type HeightImage } from '../ops/heightmap';
import { detailCommand, environmentCommand, heightmapRangeOk, importHeights, introCommand, lifeCommand, metaCommand, mirrorCommand, resizeCommand } from '../ops/map-operations';
import type { MirrorResult } from '../ops/mirror-map';
import type { DetailTarget } from '../ops/detail';
import type { Stamp, StampRect } from '../ops/stamp';
import { defaultSettings } from '../tools/tool';
import { AgentAdapter } from '../services/agent-adapter';
import { CheckService } from '../services/check-service';
import { EditorNotices } from '../services/editor-notices';
import { EditorPictures } from '../services/editor-pictures';
import { EditorCore } from '../services/editor-core';
import { EditorRoutes } from '../services/editor-routes';
import { EditorMinimap } from '../services/editor-minimap';
import { EditorPathMask } from '../services/editor-path-mask';
import { EditorGround } from '../services/editor-ground';
import { EditorState } from '../services/editor-state';
import { JobRunner } from '../services/job-runner';
import { MapLibrary } from '../services/map-library';
import { MapLifecycle } from '../services/map-lifecycle';
import { SaveService } from '../services/save-service';
import { ToolHost } from '../services/tool-host';
import { ViewHost, type EditorViewPort } from '../services/view-host';
import { RendererHostService } from '../../services/infrastructure/renderer-host.service';
import { injectT } from '../../i18n/i18n.service';

@Injectable()
export class EditorSession implements OnDestroy {
  /** The words of the player's language, for the tools and the services */
  readonly t = injectT();
  private readonly zone = inject(NgZone);
  private readonly renderers = inject(RendererHostService);
  readonly catalog = signal(new CatalogIndex(EMPTY_CATALOG));
  /** The asset catalogue is read before a map opens, so the view never swaps it */
  readonly catalogReady: Promise<void> = loadAssetCatalog().then((c) => this.catalog.set(new CatalogIndex(c)));

  readonly notices = new EditorNotices();
  readonly core = new EditorCore();
  private readonly pathMask = new EditorPathMask(this.core);
  private readonly ground = new EditorGround(this.core);
  readonly library = new MapLibrary(this.notices);
  readonly state: EditorState = new EditorState(() => {
    this.saves.changed();
    this.check.changed();
    this.routes.changed();
    this.minimap.changed();
  });
  private readonly viewHost: ViewHost;
  /** The 3D view as far as the page may use it */
  readonly view: EditorViewPort;
  readonly tools: ToolHost;
  readonly saves: SaveService;
  readonly jobs: JobRunner;
  readonly check: CheckService;
  readonly routes: EditorRoutes;
  readonly minimap: EditorMinimap;
  readonly pictures: EditorPictures;
  readonly maps: MapLifecycle;
  readonly agent: AgentAdapter;

  constructor() {
    const settings = defaultSettings();
    const catalog = () => this.catalog();
    const catalogReady = () => this.catalogReady;
    const open = () => this.maps.editor;
    const busyReason = () => this.busyReason();
    const blocked = (what: string) => this.blocked(what);
    this.viewHost = new ViewHost({
      zone: this.zone,
      notices: this.notices,
      settings,
      catalog,
      tool: () => this.tools.current,
      locked: () => this.maps.readOnly() || !!this.jobs.job(),
      contextLost: (lost) => this.contextLost(lost),
      hintChanged: () => this.tools.hintChanged(),
      t: () => this.t(),
      pathMask: this.pathMask,
      ground: this.ground,
      renderer: (slot) => this.renderers.acquire(slot, 'custom-map'),
    });
    this.view = this.viewHost;
    this.routes = new EditorRoutes(this.core, (routes) => this.viewHost.showRoutes(routes));
    this.minimap = new EditorMinimap(this.core, () => this.maps.editor?.doc ?? null);
    this.tools = new ToolHost(settings, this.viewHost, this.state.anyRev);
    this.pictures = new EditorPictures(this.zone, this.viewHost, catalog, () => this.doc);
    this.saves = new SaveService(
      {
        get editor() {
          return open();
        },
        readOnly: () => this.maps.readOnly(),
        busyReason,
        blocked,
        thumbnail: () => this.pictures.thumbnail(),
        pack: async (options, hash) => {
          const packed = await this.core.run('pack', { options, hash });
          if (!packed) throw new Error('The map closed while it was packed');
          return packed.value;
        },
        copied: (id) => this.maps.copied(id),
        showCheck: () => void this.check.runCheck(),
        refresh: () => this.state.refresh(),
      },
      this.library,
      this.notices,
    );
    this.jobs = new JobRunner(
      {
        get editor() {
          return open();
        },
        catalog,
        busyReason,
        blocked,
        lockView: (on) => this.viewHost.lock(on),
        readOnly: () => this.maps.readOnly(),
        refresh: () => this.state.refresh(),
        terrain: (input, onPart, signal) => this.core.terrain(input, onPart, signal),
      },
      this.zone,
      this.notices,
    );
    this.check = new CheckService(
      {
        get editor() {
          return open();
        },
        core: this.core,
        meta: this.state.meta,
        isOpen: (id) => this.maps.isOpen(id),
        blocked,
        save: (manual) => this.saves.save(manual),
      },
      settings,
      this.viewHost,
      inject(AppScreen),
      inject(WorldSession),
    );
    this.maps = new MapLifecycle({
      zone: this.zone,
      notices: this.notices,
      core: this.core,
      routes: this.routes,
      minimap: this.minimap,
      library: this.library,
      saves: this.saves,
      jobs: this.jobs,
      check: this.check,
      state: this.state,
      view: this.viewHost,
      pictures: this.pictures,
      tools: this.tools,
      settings,
      catalog,
      catalogReady,
      blocked,
    });
    this.agent = new AgentAdapter({
      zone: this.zone,
      notices: this.notices,
      library: this.library,
      saves: this.saves,
      jobs: this.jobs,
      check: this.check,
      state: this.state,
      view: this.viewHost,
      pictures: this.pictures,
      maps: this.maps,
      catalog,
      catalogReady,
      busyReason,
      execute: (command) => this.execute(command),
      undo: () => this.undo(),
      saveStamp: (name, stamp, region, keep) => this.saveStamp(name, stamp, region, keep),
    });
  }

  /** The open map's document and history, null without one */
  get editor(): EditorDocument | null {
    return this.maps.editor;
  }

  get doc(): CustomMapDocument | null {
    return this.maps.editor?.doc ?? null;
  }

  // ---------------------------------------------------------------- the view on the page

  /** The view of the open map, the page's canvas in `slot` */
  attachViewport(slot: HTMLElement): void {
    const editor = this.editor;
    if (!editor) return;
    this.viewHost.attach(slot, editor);
    this.check.show();
  }

  /** The game shows (the view goes, the map stays): the next view of this map stands where this one stood */
  detachViewport(): void {
    this.maps.leaveView(true);
  }

  /** The view's context went: the map is saved at once (it lives in memory, not on the GPU); back, the view is rebuilt */
  private contextLost(lost: boolean): void {
    if (lost) {
      this.state.refresh();
      if (this.saves.dirty() && !this.maps.readOnly()) void this.saves.save(false);
    } else this.notices.flash('The view is back');
  }

  // ---------------------------------------------------------------- the door

  /**
   * The door for every change from a panel: `run` makes its steps on the
   * editor (a command executed, a transaction committed). Refused with a
   * line in the status bar while the map is busy (busyReason) or the
   * document is held; the signals follow at once. Returns whether it ran.
   */
  edit(what: string, run: (editor: EditorDocument) => unknown): boolean {
    const editor = this.editor;
    if (!editor || this.blocked(what)) return false;
    try {
      run(editor);
    } catch (e) {
      if (!(e instanceof EditorHeldError)) throw e;
      return false;
    } finally {
      this.state.refresh();
    }
    return true;
  }

  /** A step from the agent; refused while the document is held (the status bar says why) */
  private execute(command: EditCommand): void {
    try {
      this.editor?.execute(command);
    } catch (e) {
      if (!(e instanceof EditorHeldError)) throw e;
    }
    this.state.refresh();
  }

  /**
   * What the map is in the middle of: a stroke or a drag in the view, or a
   * terrain job. Undo, redo, saving, pasting and restoring wait meanwhile:
   * an undo under a running job came back with the heights of before the
   * job on Cancel, over steps already undone. Null when free.
   */
  busyReason(): string | null {
    if (this.maps.readOnly()) return 'another tab edits this map (Take over editing)';
    if (this.jobs.job()) return 'the terrain job runs (Cancel stops it)';
    if (this.viewHost.dragging) return 'finish the stroke or drag first';
    return null;
  }

  /** True (with a line in the status bar) when `what` has to wait */
  blocked(what: string): boolean {
    const reason = this.busyReason();
    if (reason) this.notices.flash(`${what} waits: ${reason}`);
    return !!reason;
  }

  undo(): void {
    if (this.blocked('Undo')) return;
    const e = this.editor;
    if (e?.undo()) this.notices.flash(`Undone: ${e.redoLabel ?? ''}`);
    this.state.refresh();
  }

  /** Back or forward to the state after `steps` steps (0: as opened) */
  jumpTo(steps: number): void {
    if (this.blocked('Going through the history')) return;
    const e = this.editor;
    if (!e || steps === e.historySteps) return;
    if (e.jumpTo(steps)) this.notices.flash(steps ? `Back to: ${e.undoLabel}` : 'Back to the map as it was opened');
    this.state.refresh();
  }

  redo(): void {
    if (this.blocked('Redo')) return;
    const e = this.editor;
    if (e?.redo()) this.notices.flash(`Redone: ${e.undoLabel}`);
    this.state.refresh();
  }

  // ---------------------------------------------------------------- edits of the map's parts

  editMeta(patch: Partial<Pick<MapMeta, 'name' | 'author' | 'description'>>): void {
    this.edit('Map details', (e) => e.execute(metaCommand(e.doc, patch)));
  }

  /** The map's life with `change` made to a copy, one step */
  editLife(change: (life: MapLife) => void, label: string): void {
    this.edit('Changing the life', (e) => e.execute(lifeCommand(e.doc, change, label)));
  }

  /** The map's intro flight replaced, none for the game's default tour; one step */
  editIntro(intro: MapIntro | undefined, label = 'Intro flight'): void {
    this.edit('Changing the intro', (e) => e.execute(introCommand(e.doc, intro, label)));
  }

  editEnvironment(patch: Partial<CustomMapDocument['environment']>, label = 'Environment'): void {
    this.edit('Changing the environment', (e) => e.execute(environmentCommand(e.doc, patch, label)));
  }

  resize(width: number, depth: number): void {
    let dropped = { droppedObjects: 0, droppedNodes: 0 };
    const done = this.edit('Resizing', (e) => {
      const step = resizeCommand(e.doc, width, depth);
      dropped = step.dropped;
      e.execute(step.command);
    });
    if (!done) return;
    this.view.frameMap();
    const lost = dropped.droppedObjects + dropped.droppedNodes;
    this.notices.flash(lost ? `Resized; ${dropped.droppedObjects} objects and ${dropped.droppedNodes} road nodes fell outside` : 'Resized');
  }

  /** Refines coarse ground to the detail of new maps (2 m height points, the splat to match); one undo step */
  increaseDetail(): void {
    let target: DetailTarget | null = null;
    this.edit('Increasing the detail', (e) => {
      const step = detailCommand(e.doc);
      if (!step) return;
      e.execute(step.command);
      target = step.target;
    });
    const done = target as DetailTarget | null;
    if (done) this.notices.flash(`Height points every ${+done.cellSize.toFixed(2)} m, ground paint ${done.splatResolution} px; Ctrl+Z takes it back`);
  }

  /**
   * Makes the whole map symmetric now (the symmetry chosen in the top bar):
   * the part around the view's middle is copied to the others, ground,
   * water, objects, spawns, roads and rivers; one undo step
   */
  mirrorNow(): void {
    const mode = this.tools.settings.symmetry();
    if (mode === 'none') {
      this.notices.flash('Choose a symmetry first (top bar or M)');
      return;
    }
    let mirrored: MirrorResult | null = null;
    this.edit('Mirroring', (e) => {
      const step = mirrorCommand(e.doc, mode, this.viewHost.viewCenter() ?? e.doc.hq);
      e.execute(step.command);
      mirrored = step.result;
    });
    const result = mirrored as MirrorResult | null;
    if (!result) return;
    const leftOut = result.spawnsLeftOut ? ` (${result.spawnsLeftOut} spawns left out: a map holds at most ${MAX_SPAWN_PORTALS})` : '';
    this.notices.flash(`Mirrored from the part in view: ${result.objects} objects, ${result.spawns} spawns, ${result.roads} roads${result.life ? `, ${result.life} life areas` : ''} copied${leftOut}`);
  }

  /** Puts a kept version back as one undo step: all of the map (SnapshotCommand.restore) but its name and details */
  async restoreVersion(version: MapVersion): Promise<void> {
    const editor = this.editor;
    if (!editor || this.blocked('Restore')) return;
    let old: CustomMapDocument;
    try {
      old = await this.saves.versionDoc(version);
    } catch (e) {
      this.notices.error.set(`This version could not be read (${(e as Error).message}). The map is as it was.`);
      return;
    }
    if (this.editor !== editor) return;
    if (this.edit('Restore', (e) => e.execute(SnapshotCommand.restore(e.doc, old, 'Restore version')))) {
      this.notices.flash(`Back to the version of ${new Date(version.savedAt).toLocaleString()}`);
    }
  }

  /**
   * A heightmap file (16-bit PNG, or square 16-bit RAW) as the map's ground:
   * scaled to the map's grid, black at `low`, white at `high` metres; one
   * undo step. Resolves false (with the reason in the banner) when the file
   * is no heightmap.
   */
  async importHeightmap(file: File, low: number, high: number): Promise<boolean> {
    if (!this.editor || this.blocked('Importing a heightmap')) return false;
    if (!heightmapRangeOk(low, high)) {
      this.notices.error.set('The heightmap needs a lowest and a highest height in metres, at most 10 km apart.');
      return false;
    }
    let image: HeightImage;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      image = /\.png$/i.test(file.name) ? decodePng(bytes) : decodeRaw16(bytes);
    } catch (e) {
      this.notices.error.set(`${file.name}: ${(e as Error).message}`);
      return false;
    }
    if (!this.edit('Importing a heightmap', (e) => importHeights(e, this.catalog(), image, low, high))) return false;
    const g = this.doc!.terrain.grid;
    this.notices.flash(`Heightmap ${image.width} x ${image.height} on the ${g.columns} x ${g.rows} grid, ${low} to ${high} m; Ctrl+Z takes it back`);
    return true;
  }

  /** The heights as a 16-bit heightmap (PNG or RAW); the file name carries their range in metres */
  downloadHeightmap(format: 'png' | 'raw'): void {
    const doc = this.doc;
    if (!doc) return;
    const grid = gridToImage(doc.terrain.grid);
    const { low, high } = grid;
    // RAW is square by its nature (the side comes from the byte count): a wide map goes out resampled
    const image = format === 'raw' ? squareImage(grid.image) : grid.image;
    const bytes = format === 'png' ? encodePng16(image) : encodeRaw16(image);
    downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: format === 'png' ? 'image/png' : 'application/octet-stream' }), heightmapName(doc.meta.id, low, high, format));
    this.notices.flash(`Heightmap ${image.width} x ${image.height}, ${Math.round(low * 10) / 10} to ${Math.round(high * 10) / 10} m`);
  }

  // ---------------------------------------------------------------- stamps and prefabs

  /**
   * Saves a piece (a stamp, a prefab) with a picture of its rectangle (when it
   * is still on this map): into the library for every map, or into the open
   * map's file as one undo step. Null when the map keeps no more
   */
  async saveStamp(name: string, stamp: Stamp, region: StampRect | null, keep: StampKeep = 'library'): Promise<SavedStamp | null> {
    const preview = region ? await this.pictures.stampPicture(region) : null;
    if (keep === 'library') {
      const saved = await this.library.stamps.save(name, stamp, preview);
      await this.library.reloadStamps();
      return saved;
    }
    const editor = this.editor;
    if (!editor) return null;
    const list = editor.doc.prefabs ?? [];
    if (list.length >= MAX_MAP_PREFABS) {
      this.notices.flash(`This map keeps ${MAX_MAP_PREFABS} prefabs at most; remove one first`);
      return null;
    }
    const saved = stampEntry(name, stamp, preview);
    this.edit('Keeping a prefab', (e) => e.execute(SnapshotCommand.record(e.doc, `Keep ${saved.name}`, ['prefabs'], (d) => (d.prefabs = [...list, saved]))));
    return saved;
  }

  /** The stamps and prefabs the open map keeps (CustomMapDocument.prefabs) */
  mapStamps(): SavedStamp[] {
    return this.editor?.doc.prefabs ?? [];
  }

  /** Takes a piece out of the open map's own, one undo step */
  removeMapStamp(id: string): void {
    const saved = this.editor?.doc.prefabs?.find((p) => p.id === id);
    if (!saved) return;
    this.edit('Removing a prefab', (e) => {
      const rest = e.doc.prefabs!.filter((p) => p.id !== id);
      e.execute(SnapshotCommand.record(e.doc, `Remove ${saved.name}`, ['prefabs'], (d) => (d.prefabs = rest.length ? rest : undefined)));
    });
  }

  ngOnDestroy(): void {
    this.jobs.cancel();
    this.pictures.dispose();
    this.saves.dispose();
    this.check.dispose();
    this.maps.dispose();
    this.routes.dispose();
    this.minimap.dispose();
    this.core.dispose();
    this.agent.dispose();
    this.library.dispose();
    this.notices.dispose();
    this.state.dispose();
  }
}
