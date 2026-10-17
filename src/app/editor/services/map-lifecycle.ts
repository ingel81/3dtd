/**
 * Which map is open in the editor, and how one opens and closes: an own map
 * as it is, a shipped or coop host's map as it is with its own copy coming
 * at the first saved change, a new map made from options, a template or a
 * generator, a fresh copy of a changed original. One tab edits a map at a
 * time (MapLock); in another tab the map is read only (the document is
 * held) until that tab takes it over. `openMap` is the one source of "a map
 * is open": the page shows the editor while it holds an id.
 */
import { signal, type NgZone } from '@angular/core';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { createMapDocument, slugMapId, type NewMapOptions } from '../../world/custom-map/map-create';
import { EDITOR_MAP_PARAM } from '../../world/world-start';
import type { CatalogIndex } from '../../map-ops/asset-catalog';
import { finishGenerated, generateTerrain, type GenerateOptions } from '../../map-ops/generate';
import { EditorDocument } from '../model/editor-document';
import { MapLock } from '../model/map-lock';
import { biomeById } from '../ops/landscape/biomes';
import { applyTemplate, type MapTemplate } from '../ops/landscape/templates';
import { patch, type EditorSettings } from '../tools/tool';
import type { CheckService } from './check-service';
import type { EditorNotices } from './editor-notices';
import type { EditorPictures } from './editor-pictures';
import type { EditorState } from './editor-state';
import type { JobRunner } from './job-runner';
import type { MapLibrary } from './map-library';
import type { SaveService } from './save-service';
import type { ToolHost } from './tool-host';
import type { ViewHost } from './view-host';

export interface LifecycleParts {
  zone: NgZone;
  notices: EditorNotices;
  library: MapLibrary;
  saves: SaveService;
  jobs: JobRunner;
  check: CheckService;
  state: EditorState;
  view: ViewHost;
  pictures: EditorPictures;
  tools: ToolHost;
  settings: EditorSettings;
  catalog(): CatalogIndex;
  /** The asset catalogue is read before a map opens, so the view never swaps it */
  catalogReady(): Promise<void>;
  /** True (with a line in the status bar) when `what` has to wait for a stroke, a job or another tab */
  blocked(what: string): boolean;
}

export class MapLifecycle {
  /** The id of the map open in the editor, null without one */
  readonly openMap = signal<string | null>(null);
  /** Another tab edits this map (MapLock): this one shows it and changes nothing */
  readonly readOnly = signal(false);
  /** The open map is an own copy whose original changed since (open: Fresh copy offered) */
  readonly staleCopy = signal<{ original: string; name: string } | null>(null);
  /** Share of a template painted while a new map is made from one, null otherwise */
  readonly templateProgress = signal<number | null>(null);
  private current: EditorDocument | null = null;
  /** The id the open map was opened for, see isOpen */
  private askedFor: string | null = null;
  private lock: MapLock | null = null;
  /** Releases the document's hold while another tab edits the map */
  private readOnlyHold: (() => void) | null = null;

  constructor(private readonly p: LifecycleParts) {}

  /** The open map's document and history, null without one */
  get editor(): EditorDocument | null {
    return this.current;
  }

  /**
   * Opens a map for editing and returns the id of what opened: an own map
   * itself; a shipped or a coop host's map as it is, and the first save with
   * a change stores it as a new own copy (saving under their id would make
   * them one's own, and edits to the original went nowhere). Opening alone
   * makes no copy (docs/WORLDS_STATE_PLAN.md, decision 8).
   */
  async open(id: string): Promise<string> {
    const opened = await this.openAs(id);
    this.askedFor = id;
    return opened;
  }

  /**
   * The map `id` in the editor in place of the open one (saved and closed
   * first; the editor's page goes and comes again). Resolves the id that
   * opened; throws when the open map could not be saved or `id` not read.
   */
  async switchTo(id: string): Promise<string> {
    if (this.current && this.isOpen(id)) return this.current.doc.meta.id;
    if (this.current) {
      if (!(await this.close())) throw new Error('The open map could not be saved, so it stays open');
      // The page lets its editor go before the next map opens, so the new one builds its own view
      await new Promise((r) => setTimeout(r));
    }
    return this.open(id);
  }

  /** The map `id` is the one open: itself, or the map it was opened for (a shipped map's own copy) */
  isOpen(id: string): boolean {
    const doc = this.current?.doc;
    return !!doc && (doc.meta.id === id || this.askedFor === id);
  }

  /**
   * The original of the open copy changed since it was copied (a game
   * update, a host's new version): a fresh copy of it, opened in place of
   * this one (which stays). Returns the new copy's id.
   */
  async freshCopy(): Promise<string | null> {
    const p = this.p;
    const stale = this.staleCopy();
    if (!stale || p.blocked('A fresh copy')) return null;
    if (p.saves.dirty() && !(await p.saves.save(false))) return null;
    this.staleCopy.set(null);
    const loaded = await p.library.store.load(stale.original);
    const copy = await p.library.store.saveCopy(loaded, undefined, { id: stale.original, hash: loaded.summary.contentHash });
    this.setDocument(copy.doc);
    p.notices.flash(`A fresh copy of ${loaded.doc.meta.name}; your earlier copy stays in the list`);
    return copy.doc.meta.id;
  }

  /** A new own map from options, a generator or a template, opened and saved; returns its id */
  async createNew(options: Omit<NewMapOptions, 'id'>, generator?: GenerateOptions, template?: MapTemplate): Promise<string> {
    const p = this.p;
    await p.catalogReady();
    const id = await p.library.store.freeId(slugMapId(options.name));
    const catalog = p.catalog();
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
    await p.saves.save(true);
    return id;
  }

  /** Puts a map into the editor (opened, created or imported) and takes its lock, or opens it read-only */
  setDocument(doc: CustomMapDocument): void {
    this.p.saves.copyOf = null;
    this.takeLock(doc.meta.id);
    this.show(doc, true);
    // Every map opens on Look: a first click only looks
    this.p.tools.select('look');
  }

  /** Asks the tab that edits this map to save and let go; this one edits then */
  takeOver(): Promise<void> {
    this.p.notices.flash('Asking the other tab to save and let go');
    return this.lock?.takeOver() ?? Promise.resolve();
  }

  /**
   * Leaves the map (back to the browser); saves first when it changed. A
   * save that fails keeps the map open (returns false), nothing is lost.
   */
  async close(): Promise<boolean> {
    const p = this.p;
    const editor = this.current;
    if (editor && !this.readOnly() && p.blocked('Leaving the map')) return false;
    if (editor && !this.readOnly()) {
      if (p.saves.dirty() || p.saves.running) {
        if (!(await p.saves.save(true)) || p.saves.dirty()) {
          p.notices.flash('The map could not be saved; it stays open');
          return false;
        }
      } else {
        // The list shows the map as it was left
        const preview = await p.pictures.thumbnail();
        if (preview) await p.library.store.setPreview(editor.doc.meta.id, preview).catch(() => undefined);
      }
    }
    this.leaveView(false);
    this.lock?.close();
    this.lock = null;
    this.staleCopy.set(null);
    this.setReadOnly(false);
    this.current = null;
    this.askedFor = null;
    p.state.attach(null);
    this.openMap.set(null);
    return true;
  }

  /** The view goes (the game shows, the map closes); `keepCamera` keeps where it looked for the next view */
  leaveView(keepCamera: boolean): void {
    this.p.view.detach(keepCamera && !!this.current);
    // The palette pictures' own GPU context goes with the view (the game needs the room); it comes back with the next picture
    this.p.pictures.release();
  }

  /** The view does not come back: save, then load the editor's page anew on this map (`/editor?map=`) */
  async reloadPage(): Promise<void> {
    const p = this.p;
    p.state.refresh();
    if (p.saves.dirty() && !this.readOnly()) await p.saves.save(false);
    const id = this.current?.doc.meta.id;
    const url = new URL('editor', document.baseURI);
    if (id) url.searchParams.set(EDITOR_MAP_PARAM, id);
    location.assign(url.toString());
  }

  /** A shipped map's own copy was stored under `id`: the tab's lock follows it */
  copied(id: string): void {
    this.takeLock(id);
    this.openMap.set(id);
  }

  dispose(): void {
    // Leaving the page (another route): what is not saved yet goes now
    if (this.current && this.p.saves.dirty() && !this.readOnly()) void this.p.saves.save(false);
    this.lock?.close();
    this.leaveView(false);
  }

  private async openAs(id: string): Promise<string> {
    const p = this.p;
    const store = p.library.store;
    await p.catalogReady();
    this.staleCopy.set(null);
    // A shipped or coop map edited before: its own copy opens again
    const known = await store.ownCopyOf(id);
    if (known) {
      const copy = await store.load(known.id, 'own');
      p.library.sayRepaired(copy.doc.meta.name, copy.repaired);
      this.setDocument(copy.doc);
      const now = await store.originalHash(id);
      if (now && now !== known.copyOf!.hash) this.staleCopy.set({ original: id, name: copy.doc.meta.name });
      else p.notices.flash(`Your own copy of this map; the original stays as it is`);
      return known.id;
    }
    const loaded = await store.load(id);
    p.library.sayRepaired(loaded.doc.meta.name, loaded.repaired);
    if (loaded.summary.origin === 'own') {
      this.setDocument(loaded.doc);
      return id;
    }
    const name = loaded.doc.meta.name;
    this.setDocument(loaded.doc);
    p.saves.copyOf = { id, hash: loaded.summary.contentHash };
    p.notices.flash(`${name} as it ships; your own copy comes with the first change, the original stays as it is`);
    return id;
  }

  /** The lock of the map `id` (its own tab edits it), in place of the one held */
  private takeLock(id: string): void {
    const zone = this.p.zone;
    this.lock?.close();
    this.setReadOnly(false);
    const lock = new MapLock(id, {
      granted: () => zone.run(() => void this.lockGranted(lock)),
      lost: () => zone.run(() => this.lockLost(lock)),
      beforeRelease: () => zone.run(() => this.letGo()),
    });
    this.lock = lock;
    void lock.start().then((editing) => {
      if (this.lock === lock && !editing) zone.run(() => this.lockLost(lock));
    });
  }

  /** This tab holds the map now: read it again (the other tab saved last) and edit */
  private async lockGranted(lock: MapLock): Promise<void> {
    const p = this.p;
    if (this.lock !== lock || !this.current) return;
    try {
      const loaded = await p.library.store.load(this.current.doc.meta.id);
      if (this.lock !== lock) return;
      this.show(loaded.doc, false);
    } catch (e) {
      p.notices.error.set(`The map could not be read again (${(e as Error).message}). Reload the page before you change it.`);
      return;
    }
    this.setReadOnly(false);
    p.view.lock(false);
    p.notices.flash('You edit this map now');
  }

  /** Read-only (another tab edits the map) holds the document, so nothing here writes to it */
  private setReadOnly(on: boolean): void {
    this.readOnly.set(on);
    this.readOnlyHold?.();
    this.readOnlyHold = on && this.current ? this.current.hold('another tab edits this map (Take over editing)') : null;
  }

  /** Another tab edits this map: this one turns read-only */
  private lockLost(lock: MapLock): void {
    if (this.lock !== lock) return;
    this.setReadOnly(true);
    this.p.saves.cancel();
    this.p.view.lock(true);
    this.p.state.refresh();
  }

  /** Another tab asks for the map: what is half done is dropped, the rest saved */
  private async letGo(): Promise<void> {
    const p = this.p;
    p.view.lock(true);
    p.jobs.cancel();
    await p.jobs.settled();
    if (p.saves.dirty() || p.saves.running) await p.saves.save(false);
    p.notices.flash('Another tab took over this map; this one is read-only now');
  }

  private show(doc: CustomMapDocument, frame: boolean): void {
    const p = this.p;
    // A spot Look described belongs to the map before
    patch(p.settings.look, { at: null });
    if (this.current) this.current.replace(doc);
    else {
      this.current = new EditorDocument(doc);
      // One document serves every map: its refusals reach the status bar
      this.current.onRefused((e) => p.notices.flash(e.message));
    }
    const editor = this.current;
    p.saves.opened(editor, true);
    p.check.opened();
    p.state.attach(editor);
    p.view.mapOpened(doc.meta.id, frame);
    this.openMap.set(doc.meta.id);
  }
}
