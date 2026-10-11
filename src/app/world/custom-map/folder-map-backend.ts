import { readDesktopBridge, type DesktopMapFolder } from '../../core/desktop-bridge';
import { contentHash, MAP_FILE_EXTENSION, packMapFile, unpackMapFile } from './map-file';
import { MAP_ID_PATTERN, slugMapId } from './map-create';
import { IndexedDbMapBackend, summarize, type MapStorageBackend, type MapSummary, type StoredMap } from './map-store';

/** An own map's file in the folder and its modification time when the game last read or wrote it */
export interface FolderMark {
  file: string;
  mtime: number;
}

/** The marks of the own maps that have a file in the folder, by map id */
export interface FolderMarks {
  read(): Record<string, FolderMark> | null;
  write(marks: Record<string, FolderMark>): void;
}

const MARKS_KEY = '3dtd-map-folder-marks';

/** The marks in localStorage; none when it is not there. The first ones held only a time, the file was the id's */
export const localStorageMarks: FolderMarks = {
  read() {
    try {
      const raw = localStorage.getItem(MARKS_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (!parsed || typeof parsed !== 'object') return null;
      const out: Record<string, FolderMark> = {};
      for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'number') out[id] = { file: mapFolderFile(id), mtime: v };
        else if (v && typeof (v as FolderMark).file === 'string' && typeof (v as FolderMark).mtime === 'number') out[id] = v as FolderMark;
      }
      return out;
    } catch {
      return null;
    }
  },
  write(marks) {
    try {
      localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
    } catch {
      // Without the marks the next start reads every file again
    }
  },
};

/** The file a new own map gets in the folder */
export function mapFolderFile(id: string): string {
  return `${id}${MAP_FILE_EXTENSION}`;
}

/** The map id a folder file suggests: its stem, made a slug where it is none */
export function mapFolderId(fileName: string): string {
  const stem = fileName.slice(0, fileName.length - MAP_FILE_EXTENSION.length);
  return MAP_ID_PATTERN.test(stem) ? stem : slugMapId(stem);
}

/** File names compare without case: Windows and macOS see "MyMap" and "mymap" as one file */
const key = (file: string) => file.toLowerCase();

/**
 * The desktop app's map folder (Documents/3DTD/Maps) as the home of the own
 * maps: every own map is a .3dtdmap there, the browser's store (`inner`)
 * keeps its summary, picture and a copy for fast listing. Once a page, at
 * its first use, the store follows the folder: a new or changed file comes
 * in, a file the player deleted takes its map along, an own map without a
 * file (from before the folder) is written out. Saving and deleting go to
 * both. Maps received in coop stay in the store only.
 *
 * The game never renames or removes a file it did not write for a map: a
 * file keeps the name the player gave it, the marks tie it to its map id
 * (two files that suggest one id get two ids). When all marked files are
 * gone at once, or many of them, the folder was moved or lost rather than
 * cleaned up: the maps are written out again instead of being deleted.
 */
export class FolderMapBackend implements MapStorageBackend {
  private synced: Promise<void> | null = null;
  /** The folder's files as last seen or written, lower case */
  private files = new Set<string>();

  constructor(
    private readonly inner: MapStorageBackend,
    private readonly folder: DesktopMapFolder,
    private readonly marks: FolderMarks = localStorageMarks,
  ) {}

  /** Follows the folder once (later calls wait for the same run) */
  sync(): Promise<void> {
    this.synced ??= this.follow().catch((error: unknown) => {
      console.warn('[maps] the map folder could not be read:', error);
    });
    return this.synced;
  }

  /** The map id of a file in the folder (a double-clicked map), once the folder is followed */
  async idOfFile(name: string): Promise<string | null> {
    await this.sync();
    const marks = this.marks.read() ?? {};
    return Object.entries(marks).find(([, m]) => key(m.file) === key(name))?.[0] ?? null;
  }

  async get(id: string): Promise<StoredMap | undefined> {
    await this.sync();
    return this.inner.get(id);
  }

  async put(map: Omit<StoredMap, 'preview'> & { preview?: Uint8Array | null }): Promise<void> {
    await this.sync();
    await this.inner.put(map);
    if (map.summary.origin !== 'own') return;
    const marks = this.marks.read() ?? {};
    const file = marks[map.summary.id]?.file ?? this.freeFile(map.summary.id, marks);
    const written = await this.folder.write(file, map.file);
    if (!written) {
      console.warn(`[maps] ${file} could not be written to the map folder`);
      return;
    }
    this.files.add(key(file));
    marks[map.summary.id] = { file, mtime: written.mtime };
    this.marks.write(marks);
  }

  async delete(id: string): Promise<void> {
    await this.sync();
    const stored = await this.inner.get(id);
    await this.inner.delete(id);
    const marks = this.marks.read() ?? {};
    const mark = marks[id];
    if (mark && stored?.summary.origin !== 'shared') {
      await this.folder.remove(mark.file);
      this.files.delete(key(mark.file));
      delete marks[id];
      this.marks.write(marks);
    }
  }

  async list(): Promise<MapSummary[]> {
    await this.sync();
    return this.inner.list();
  }

  async preview(id: string): Promise<Uint8Array | null> {
    await this.sync();
    return this.inner.preview(id);
  }

  async setPreview(id: string, preview: Uint8Array | null): Promise<void> {
    await this.sync();
    return this.inner.setPreview(id, preview);
  }

  /** `<id>.3dtdmap`, or `<id>-2.3dtdmap` … where another map's file has that name */
  private freeFile(id: string, marks: Record<string, FolderMark>): string {
    const owned = new Map(Object.entries(marks).map(([mid, m]) => [key(m.file), mid]));
    for (let n = 1; ; n++) {
      const file = mapFolderFile(n === 1 ? id : `${id}-${n}`);
      const owner = owned.get(key(file));
      if ((!owner || owner === id) && (!this.files.has(key(file)) || owner === id)) return file;
    }
  }

  private async follow(): Promise<void> {
    const marks = this.marks.read() ?? {};
    // By code unit, so which of two look-alike files gets the plain id never depends on the locale
    const listed = [...(await this.folder.list())].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    this.files = new Set(listed.map((f) => key(f.name)));
    const own = (await this.inner.list()).filter((m) => m.origin === 'own');
    const ownIds = new Set(own.map((m) => m.id));
    const owner = new Map(Object.entries(marks).map(([id, m]) => [key(m.file), id]));
    const taken = new Set([...ownIds, ...Object.keys(marks)]);

    // A new or changed file: its map comes in; a new file under an id no other map has
    for (const f of listed) {
      let id = owner.get(key(f.name));
      if (id && marks[id].mtime === f.mtime && ownIds.has(id)) continue;
      const fresh = !id;
      if (!id) {
        const base = mapFolderId(f.name);
        id = base;
        for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
      }
      const bytes = await this.folder.read(f.name);
      if (!bytes) continue;
      try {
        const { doc, preview } = unpackMapFile(bytes);
        // The store's copy carries the id it goes by; the file stays as the player has it
        const renamed = doc.meta.id !== id;
        doc.meta.id = id;
        const copy = renamed ? packMapFile(doc, preview ? { preview } : {}) : bytes;
        await this.inner.put({ summary: summarize(doc, 'own', await contentHash(doc)), file: copy, preview });
        marks[id] = { file: f.name, mtime: f.mtime };
        taken.add(id);
        ownIds.add(id);
        if (fresh) owner.set(key(f.name), id);
      } catch (error) {
        console.warn(`[maps] ${f.name} in the map folder is not a map the game can read:`, error);
      }
    }

    // Marked files that are gone: deleted by the player, unless so many went at once that the folder is what went
    const marked = own.filter((m) => marks[m.id]);
    const missing = marked.filter((m) => !this.files.has(key(marks[m.id].file)));
    const folderLost = missing.length > 0 && (listed.length === 0 || missing.length > Math.max(3, marked.length / 2));
    if (folderLost) console.warn(`[maps] ${missing.length} map files are gone from the map folder at once: writing them out again`);
    for (const map of own) {
      const mark = marks[map.id];
      if (mark && this.files.has(key(mark.file))) continue;
      if (mark && !folderLost) {
        await this.inner.delete(map.id);
        delete marks[map.id];
        continue;
      }
      // An own map from before the folder, or the folder came back empty: written out
      const stored = await this.inner.get(map.id);
      if (!stored) continue;
      const file = mark?.file ?? this.freeFile(map.id, marks);
      const written = await this.folder.write(file, stored.file);
      if (written) {
        this.files.add(key(file));
        marks[map.id] = { file, mtime: written.mtime };
      }
    }
    this.marks.write(marks);
  }
}

let shared: MapStorageBackend | null = null;

/**
 * The store's backend on this page: IndexedDB, mirrored to the map folder in
 * the desktop app. One per page, so the folder is read once.
 */
export function defaultMapBackend(): MapStorageBackend {
  if (shared) return shared;
  const folder = readDesktopBridge()?.maps;
  shared = folder ? new FolderMapBackend(new IndexedDbMapBackend(), folder) : new IndexedDbMapBackend();
  return shared;
}
