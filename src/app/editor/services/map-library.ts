/**
 * The maps and pieces the editor keeps, whether a map is open or not: the
 * map store with its trash, the kept versions of each map, the stamp
 * library, and reading files in (`.3dtdmap`, Warcraft 3 maps) as new own
 * maps or as another version of one.
 */
import { signal } from '@angular/core';
import { MAP_FILE_EXTENSION, MAX_FILE_BYTES } from '../../world/custom-map/map-file';
import { unpackOffThread } from '../../world/custom-map/map-unpack';
import { slugMapId } from '../../world/custom-map/map-create';
import { repairedMapText } from '../../world/custom-map/map-repair';
import { MapStore, type LoadedMap, type MapSummary } from '../../world/custom-map/map-store';
import { whileMapFree } from '../model/map-lock';
import { StampLibrary, type SavedStamp } from '../model/stamp-store';
import { VersionHistory } from '../model/version-store';
import { DEFAULT_W3X_OPTIONS, loadW3xImporter, type W3xImportOptions, type W3xImportReport } from '../import/w3x-seam';
import type { EditorNotices } from './editor-notices';

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

export class MapLibrary {
  readonly store = new MapStore();
  /** The kept versions of every map */
  readonly history = new VersionHistory();
  readonly stamps = new StampLibrary();
  /** The library's stamps and prefabs, newest first, as reloadStamps last read them */
  readonly libraryStamps = signal<SavedStamp[]>([]);
  readonly importState = signal<ImportState | null>(null);
  /** A file read in that matches an own map, waiting for Replace or Keep both */
  readonly importMatch = signal<ImportMatch | null>(null);
  /** A Warcraft map waiting for its import options */
  private pendingW3x: File | null = null;
  /** Aborts the running Warcraft import, null when none runs */
  private importAbort: AbortController | null = null;

  constructor(private readonly notices: EditorNotices) {}

  /**
   * Moves an own map to the trash (its versions stay with it); returns the
   * trash key, or null while another tab edits the map (its next save would
   * bring the map back beside the one in the trash)
   */
  async deleteMap(id: string, name = id): Promise<string | null> {
    const trashed = await whileMapFree(id, () => this.store.trash(id));
    if (trashed.done) return trashed.value;
    this.notices.error.set(`${name} is open in another tab. Close it there, then delete it.`);
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

  /** Reads the library anew (libraryStamps); empty where the browser keeps none */
  async reloadStamps(): Promise<void> {
    this.libraryStamps.set(await this.stamps.list().catch(() => []));
  }

  /** Takes a piece out of the library */
  async deleteStamp(id: string): Promise<void> {
    await this.stamps.delete(id);
    await this.reloadStamps();
  }

  /**
   * A `.3dtdmap` or `.w3x` file into a new own map; returns the new id. A
   * file that is another version of an own map (the same identity, or the
   * same Warcraft file) waits in `importMatch` for Replace or Keep both.
   */
  async importFile(file: File): Promise<string | null> {
    const name = file.name;
    const lower = name.toLowerCase();
    this.notices.error.set(null);
    if (lower.endsWith(MAP_FILE_EXTENSION)) {
      // Packed, a map is never larger than unpacked: a bigger file is no map, and is not read into memory first
      if (file.size > MAX_FILE_BYTES) {
        this.notices.error.set(`${name}: the file is too large for a map (${Math.round(file.size / 2 ** 20)} MB).`);
        return null;
      }
      try {
        const loaded = await unpackOffThread(new Uint8Array(await file.arrayBuffer()), { transfer: true });
        this.sayRepaired(name, loaded.repaired);
        const existing = await this.store.ownMatch(loaded.doc);
        if (existing) {
          this.importMatch.set({ file: name, existing, loaded });
          return null;
        }
        return (await this.store.importDocument(loaded)).doc.meta.id;
      } catch (e) {
        this.notices.error.set(`${name}: ${(e as Error).message}`);
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
    this.notices.error.set(`${name} is neither a 3DTD map (${MAP_FILE_EXTENSION}) nor a Warcraft 3 map (.w3x).`);
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
          this.notices.error.set(`${match.file}: ${match.existing.name} is open in another tab. Close it there, then import again (or import as a copy).`);
          return null;
        }
        await this.history.record(id, replaced.value.created, replaced.value.before, true).catch(() => undefined);
      } else {
        id = (await this.store.importDocument(match.loaded)).doc.meta.id;
      }
      match.done?.(id);
      return id;
    } catch (e) {
      this.notices.error.set(`${match.file}: ${(e as Error).message}`);
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

  /** What the file carried that the game does not take was set right or left out as it opened: the banner says which (map-repair.ts) */
  sayRepaired(name: string, repaired: readonly string[] | undefined): void {
    if (!repaired?.length) return;
    this.notices.error.set(`${repairedMapText(name, repaired)} The next save keeps the corrected map.`);
  }

  dispose(): void {
    this.importAbort?.abort();
  }
}
