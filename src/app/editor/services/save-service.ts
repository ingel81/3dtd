/**
 * Keeping the open map: autosave two seconds after the last edit, Ctrl+S at
 * once with a fresh picture for the list, a kept version per save, the first
 * save of a shipped map as an own copy, how safe the browser keeps the maps
 * and the reminder to download after long work where it may clear them.
 */
import { signal } from '@angular/core';
import type { CustomMapDocument } from '../../world/custom-map/map-document';
import { newMapUid } from '../../world/custom-map/map-create';
import { MAP_FILE_EXTENSION, MapFileError, packMapFile, unpackMapFile } from '../../world/custom-map/map-file';
import { packOffThread } from '../../world/custom-map/map-pack';
import { FolderWriteError } from '../../world/custom-map/folder-map-backend';
import type { EditorDocument } from '../model/editor-document';
import { DOWNLOAD_REMINDER_MS, storageSafety, type StorageSafety } from '../model/storage-safety';
import type { MapVersion } from '../model/version-store';
import { downloadBlob } from '../../utils/download';
import type { EditorNotices } from './editor-notices';
import type { MapLibrary } from './map-library';

export const AUTOSAVE_DELAY_MS = 2000;

/** What saving needs of the editor around it */
export interface SaveHost {
  /** The open map's document, null without one */
  readonly editor: EditorDocument | null;
  /** Another tab edits the map: this one keeps nothing */
  readOnly(): boolean;
  /** Why the map cannot be saved now (a stroke, a job), or null */
  busyReason(): string | null;
  /** The same with a line in the status bar */
  blocked(what: string): boolean;
  /** The picture of the map for the list, null without a view */
  thumbnail(): Promise<Uint8Array | null>;
  /** A shipped map's own copy was stored under `id`: the tab's lock follows it */
  copied(id: string): void;
  /** The map file did not take the map: the check lists each problem */
  showCheck(): void;
  /** The panels read the map again (its meta changed with the save) */
  refresh(): void;
}

export class SaveService {
  readonly saving = signal(false);
  readonly savedAt = signal<string | null>(null);
  /** The open map differs from what was saved last */
  readonly dirty = signal(false);
  /** The open map's kept versions, newest first */
  readonly versions = signal<MapVersion[]>([]);
  /** How safe the maps are here (the browser may clear them unless it keeps them for good); null until known */
  readonly storage = signal<StorageSafety | null>(null);
  /** The reminder to download the map after long work in a browser that may clear it */
  readonly downloadReminder = signal(false);
  /** The open map is a shipped or a coop map: the first save with a change stores it as an own copy of this one */
  copyOf: { id: string; hash: string } | null = null;
  /** The save running now, if any */
  private run: Promise<boolean> | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** The document state saved last */
  private savedState = -1;
  /** The document state the newest kept version holds, -1 when none is known for this map */
  private versionedState = -1;
  /** Asked the browser for persistent storage already (once a page, at the first save) */
  private persistAsked = false;
  /** Since when the map is edited without a download, for the reminder */
  private workSince = Date.now();
  private disposed = false;

  constructor(
    private readonly host: SaveHost,
    private readonly library: MapLibrary,
    private readonly notices: EditorNotices,
  ) {}

  /** Whether a save runs now */
  get running(): boolean {
    return this.run !== null;
  }

  /** Another map is in the editor, as saved (or never saved: `saved` false) */
  opened(editor: EditorDocument, saved: boolean): void {
    this.copyOf = null;
    this.savedState = saved ? editor.stateId : -1;
    this.versionedState = -1;
    this.workSince = Date.now();
    this.downloadReminder.set(false);
    if (!this.storage()) void storageSafety(false).then((s) => this.storage.set(s));
    this.versions.set([]);
    void this.loadVersions();
    this.follow();
  }

  /** The signals follow the document's state (after any change) */
  follow(): void {
    const e = this.host.editor;
    this.dirty.set(!!e && e.stateId !== this.savedState);
  }

  /** The map changed: an autosave follows the last change */
  changed(): void {
    this.follow();
    if (this.dirty() && !this.host.readOnly()) this.schedule();
  }

  /**
   * Stores the map in the browser; `manual` also renders a new thumbnail.
   * A save asked for while one runs waits for it (Ctrl+S during an
   * autosave is not lost); an autosave with nothing new does nothing.
   */
  async save(manual = false): Promise<boolean> {
    if (!this.host.editor) return false;
    // Half a stroke or a job's land is no state to keep: Ctrl+S says why, an autosave comes again later
    if (manual ? this.host.blocked('Saving') : this.host.busyReason()) {
      if (!manual) this.schedule();
      return false;
    }
    while (this.run) await this.run.catch(() => false);
    if (!manual && !this.dirty()) return true;
    this.run = this.runSave(manual);
    try {
      return await this.run;
    } finally {
      this.run = null;
    }
  }

  private async runSave(manual: boolean): Promise<boolean> {
    const editor = this.host.editor;
    if (!editor) return false;
    const store = this.library.store;
    this.cancel();
    this.saving.set(true);
    const state = editor.stateId;
    const changed = state !== this.savedState;
    try {
      const doc = editor.doc;
      const copyOf = this.copyOf;
      // A shipped map unchanged: nothing of one's own to keep
      if (copyOf && !changed) return true;
      // Ctrl+S on a map stored and kept as a version as it is: only the list's picture is new, no second version
      if (manual && !changed && this.versionedState === state) {
        const preview = await this.host.thumbnail();
        if (preview) await store.setPreview(doc.meta.id, preview);
        this.notices.flash('Saved');
        return true;
      }
      const original = doc.meta.name;
      if (copyOf) {
        await store.makeCopy(doc, undefined, copyOf);
        this.copyOf = null;
        this.host.copied(doc.meta.id);
      }
      // An OpenStreetMap map changed is a Built World from now on (docs/WORLDS_STATE_PLAN.md, decision 5)
      if (changed && doc.meta.generated) delete doc.meta.generated;
      // Unchanged, the file stays byte for byte what it was (a version of it is then no new one)
      if (changed) doc.meta.updatedAt = new Date().toISOString();
      // The identity first: the copy packed below must carry it (the store would pack the live map again)
      doc.meta.uid ??= newMapUid();
      const preview = manual ? await this.host.thumbnail() : null;
      // An autosave packs fast and leaves the hash for when the game asks for it; packed in a worker, so a
      // save costs the view no frame. File, hash and summary all come from the one copy the worker got
      const { file, sum, summary } = await packOffThread(doc, { level: manual ? 6 : 1 }, manual);
      // Kept in the game either way; a map folder that refuses the file is said, the next save writes it again
      const folderRefused = await store.save(doc, preview, file, { summary }).then(
        () => null,
        (e: unknown) => {
          if (e instanceof FolderWriteError) return e;
          throw e;
        },
      );
      if (folderRefused) this.notices.error.set(`Saved in the game, but the map folder did not take ${folderRefused.file} (full, locked or no rights); the file there is older. The next save tries again.`);
      // A version for the history; a full browser store must not fail the save
      const id = doc.meta.id;
      void this.library.history
        .record(id, doc.meta.createdAt, file, manual, undefined, sum)
        .then((v) => {
          if (!v) return;
          if (this.host.editor?.doc === doc) this.versionedState = state;
          return this.loadVersions();
        })
        .catch(() => undefined);
      this.savedState = state;
      editor.markSaved();
      this.savedAt.set(doc.meta.updatedAt);
      if (copyOf) this.notices.flash(`Saved as your own copy of ${original}; the original stays as it is`);
      else if (manual) this.notices.flash('Saved');
      this.guardStorage();
      return true;
    } catch (e) {
      this.notices.error.set(saveErrorText(e));
      // An invalid map: the check lists each problem with the thing or the tool to fix it
      if (e instanceof MapFileError) this.host.showCheck();
      return false;
    } finally {
      this.saving.set(false);
      this.follow();
      this.host.refresh();
      // Changes made while it ran get their own autosave
      if (this.dirty() && !this.host.readOnly()) this.schedule();
    }
  }

  /** The open map's kept versions, newest first */
  async loadVersions(): Promise<void> {
    const meta = this.host.editor?.doc.meta;
    if (!meta) return;
    try {
      const list = await this.library.history.list(meta.id, meta.createdAt);
      if (this.host.editor?.doc.meta === meta) this.versions.set(list);
    } catch {
      this.versions.set([]);
    }
  }

  /** Pins a version against the thinning, or lets it go */
  async pinVersion(version: MapVersion, pinned: boolean): Promise<void> {
    try {
      await this.library.history.pin(version, pinned);
    } catch (e) {
      this.notices.error.set(`The version could not be ${pinned ? 'pinned' : 'unpinned'} (${(e as Error).message}).`);
    }
    await this.loadVersions();
  }

  /** A kept version as a map */
  async versionDoc(version: MapVersion): Promise<CustomMapDocument> {
    const bytes = await this.library.history.bytes(version);
    if (!bytes) throw new Error('That version is gone');
    return unpackMapFile(bytes).doc;
  }

  /** The map as a `.3dtdmap` download; the reminder waits for the next stretch of work */
  downloadFile(): void {
    const doc = this.host.editor?.doc;
    if (!doc) return;
    try {
      downloadBlob(new Blob([packMapFile(doc) as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), `${doc.meta.id}${MAP_FILE_EXTENSION}`);
      this.laterReminder();
    } catch (e) {
      this.notices.error.set(saveErrorText(e, 'downloaded'));
      if (e instanceof MapFileError) this.host.showCheck();
    }
  }

  /** The reminder put off: it comes back after the next stretch of work */
  laterReminder(): void {
    this.workSince = Date.now();
    this.downloadReminder.set(false);
  }

  /** No autosave waits any more (the map is read-only or going) */
  cancel(): void {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = null;
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }

  private schedule(): void {
    this.cancel();
    if (this.disposed) return;
    this.autosaveTimer = setTimeout(() => void this.save(false), AUTOSAVE_DELAY_MS);
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
}

/** What a failed save (or download) tells the player: what happened, that nothing is lost yet, what to do */
export function saveErrorText(e: unknown, what: 'saved' | 'downloaded' = 'saved'): string {
  if (e instanceof MapFileError) {
    // Saving and the download write the same file: neither helps until the problem is fixed
    const more = e.problems.length > 1 ? ` (and ${e.problems.length - 1} more)` : '';
    return `The map was not ${what}: ${e.problems[0]}${more}. Your changes are still here; the check (V) lists each problem and where to fix it, then save again.`;
  }
  const err = e as { name?: string; message?: string } | null;
  if (err?.name === 'QuotaExceededError' || /quota|storage full/i.test(err?.message ?? '')) {
    return 'The map was not saved: the browser has no more room for maps. Your changes are still here: download the map (File menu) and delete maps you no longer need.';
  }
  return `The map was not saved (${err?.message ?? 'unknown error'}). Your changes are still here; try again or download the map (File menu).`;
}
