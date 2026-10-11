import { readDesktopBridge, type DesktopMapFolder } from '../../core/desktop-bridge';
import { contentHash, MAP_FILE_EXTENSION, packMapFile, unpackMapFile } from './map-file';
import { MAP_ID_PATTERN, slugMapId } from './map-create';
import { IndexedDbMapBackend, summarize, type MapStorageBackend, type MapSummary, type StoredMap } from './map-store';

/** Which own maps have their file in the folder, and its modification time when the game last read or wrote it */
export interface FolderMarks {
  read(): Record<string, number> | null;
  write(marks: Record<string, number>): void;
}

const MARKS_KEY = '3dtd-map-folder-marks';

/** The marks in localStorage; none when it is not there */
export const localStorageMarks: FolderMarks = {
  read() {
    try {
      const raw = localStorage.getItem(MARKS_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : null;
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

/** The file of an own map in the folder */
export function mapFolderFile(id: string): string {
  return `${id}${MAP_FILE_EXTENSION}`;
}

/** The map id a folder file stands for: its stem, made a slug where it is none */
export function mapFolderId(fileName: string): string {
  const stem = fileName.slice(0, fileName.length - MAP_FILE_EXTENSION.length);
  return MAP_ID_PATTERN.test(stem) ? stem : slugMapId(stem);
}

/**
 * The desktop app's map folder (Documents/3DTD/Maps) as the home of the own
 * maps: every own map is a .3dtdmap there, the browser's store (`inner`)
 * keeps its summary, picture and a copy for fast listing. Once a page, at
 * its first use, the store follows the folder: a new or changed file comes
 * in, a file the player deleted takes its map along, an own map without a
 * file (from before the folder) is written out. Saving and deleting go to
 * both. Maps received in coop stay in the store only.
 */
export class FolderMapBackend implements MapStorageBackend {
  private synced: Promise<void> | null = null;

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

  async get(id: string): Promise<StoredMap | undefined> {
    await this.sync();
    return this.inner.get(id);
  }

  async put(map: Omit<StoredMap, 'preview'> & { preview?: Uint8Array | null }): Promise<void> {
    await this.sync();
    await this.inner.put(map);
    if (map.summary.origin === 'own') await this.writeFile(map.summary.id, map.file);
  }

  async delete(id: string): Promise<void> {
    await this.sync();
    const stored = await this.inner.get(id);
    await this.inner.delete(id);
    if (stored?.summary.origin === 'own' || stored === undefined) {
      await this.folder.remove(mapFolderFile(id));
      const marks = this.marks.read() ?? {};
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

  private async writeFile(id: string, file: Uint8Array): Promise<void> {
    const written = await this.folder.write(mapFolderFile(id), file);
    if (!written) {
      console.warn(`[maps] ${mapFolderFile(id)} could not be written to the map folder`);
      return;
    }
    const marks = this.marks.read() ?? {};
    marks[id] = written.mtime;
    this.marks.write(marks);
  }

  private async follow(): Promise<void> {
    const marks = this.marks.read() ?? {};
    const files = new Map((await this.folder.list()).map((f) => [mapFolderId(f.name), f]));
    const own = (await this.inner.list()).filter((m) => m.origin === 'own');
    const ownIds = new Set(own.map((m) => m.id));

    // A new or changed file: its map comes in under the file's name
    for (const [id, file] of files) {
      if (!id || (marks[id] === file.mtime && ownIds.has(id))) continue;
      const bytes = await this.folder.read(file.name);
      if (!bytes) continue;
      try {
        const { doc, preview } = unpackMapFile(bytes);
        // The file's name is the map's id: a file that says otherwise inside is packed anew
        const rename = doc.meta.id !== id;
        doc.meta.id = id;
        const own = rename ? packMapFile(doc, preview ? { preview } : {}) : bytes;
        await this.inner.put({ summary: summarize(doc, 'own', await contentHash(doc)), file: own, preview });
        marks[id] = file.mtime;
        ownIds.add(id);
        // A name that is no map id ("Witch Marsh.3dtdmap") goes under the id, so saving writes the same file
        if (rename || file.name !== mapFolderFile(id)) {
          const written = await this.folder.write(mapFolderFile(id), own);
          if (written) {
            if (file.name !== mapFolderFile(id)) await this.folder.remove(file.name);
            marks[id] = written.mtime;
          }
        }
      } catch (error) {
        console.warn(`[maps] ${file.name} in the map folder is not a map the game can read:`, error);
      }
    }

    for (const map of own) {
      if (files.has(map.id)) continue;
      if (marks[map.id] !== undefined) {
        // Its file was there and is gone: the player deleted it
        await this.inner.delete(map.id);
        delete marks[map.id];
        continue;
      }
      // An own map from before the folder: written out
      const stored = await this.inner.get(map.id);
      if (!stored) continue;
      const written = await this.folder.write(mapFolderFile(map.id), stored.file);
      if (written) marks[map.id] = written.mtime;
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
