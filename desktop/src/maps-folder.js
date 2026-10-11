'use strict';

/**
 * The player's map folder (Documents/3DTD/Maps): own maps as .3dtdmap files,
 * the game mirrors its own maps there (src/app/world/custom-map/folder-map-backend.ts).
 * The page names files only; every name is checked here, so nothing reaches
 * outside the folder. A .3dtdmap opened by double-click is copied in and the
 * page is told its name.
 */

const path = require('node:path');

const MAP_EXTENSION = '.3dtdmap';
/** A map file in the folder: a slug, the extension; nothing that could name another directory */
const NAME = /^[a-z0-9][a-z0-9_-]{0,95}\.3dtdmap$/i;
/** As MAX_FILE_BYTES in map-file.ts */
const MAX_MAP_BYTES = 512 * 1024 * 1024;

/** `name` when it is a plain map file name, else null */
function mapFileName(name) {
  return typeof name === 'string' && NAME.test(name) ? name : null;
}

/** The map file among process arguments (a double-click passes its path), or null */
function mapFileArg(argv) {
  if (!Array.isArray(argv)) return null;
  return argv.find((a) => typeof a === 'string' && a.toLowerCase().endsWith(MAP_EXTENSION) && !a.startsWith('--')) ?? null;
}

/** A name for `source` in the folder: its stem as a slug, `-2`, `-3` … while `taken` */
function folderNameFor(source, taken) {
  const stem =
    path
      .basename(source, path.extname(source))
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 80) || 'map';
  let name = `${stem}${MAP_EXTENSION}`;
  for (let n = 2; taken(name); n++) name = `${stem}-${n}${MAP_EXTENSION}`;
  return name;
}

/**
 * The folder's operations over `fs` (node:fs/promises), for the IPC handlers
 * below and the tests.
 */
function createMapsFolder({ dir, fs }) {
  const ensure = () => fs.mkdir(dir, { recursive: true });
  const full = (name) => path.join(dir, name);

  return {
    dir,
    /** Every map file: name, size, modification time (ms) */
    async list() {
      await ensure();
      const out = [];
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !mapFileName(entry.name)) continue;
        try {
          const stat = await fs.stat(full(entry.name));
          out.push({ name: entry.name, size: stat.size, mtime: Math.round(stat.mtimeMs) });
        } catch {
          // Gone between the listing and the look: not there
        }
      }
      return out;
    },
    /** The file's bytes, or null */
    async read(name) {
      const file = mapFileName(name);
      if (!file) return null;
      try {
        const stat = await fs.stat(full(file));
        if (stat.size > MAX_MAP_BYTES) return null;
        return new Uint8Array(await fs.readFile(full(file)));
      } catch {
        return null;
      }
    },
    /** Writes the file (through a temporary one, so a crash leaves the old); its new modification time, or null */
    async write(name, bytes) {
      const file = mapFileName(name);
      if (!file || !(bytes instanceof Uint8Array) || bytes.byteLength > MAX_MAP_BYTES) return null;
      await ensure();
      const temp = full(`${file}.part`);
      try {
        await fs.writeFile(temp, bytes);
        await fs.rename(temp, full(file));
        return { mtime: Math.round((await fs.stat(full(file))).mtimeMs) };
      } catch {
        await fs.rm(temp, { force: true }).catch(() => {});
        return null;
      }
    },
    /** Removes the file; true when it is gone */
    async remove(name) {
      const file = mapFileName(name);
      if (!file) return false;
      try {
        await fs.rm(full(file), { force: true });
        return true;
      } catch {
        return false;
      }
    },
    /**
     * A map file from elsewhere (double-click): copied in under a free name,
     * or taken as it is when it lies in the folder already. Its name, or null.
     */
    async adopt(source) {
      if (typeof source !== 'string' || !source.toLowerCase().endsWith(MAP_EXTENSION)) return null;
      const resolved = path.resolve(source);
      if (path.dirname(resolved) === path.resolve(dir) && mapFileName(path.basename(resolved))) return path.basename(resolved);
      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile() || stat.size > MAX_MAP_BYTES) return null;
        await ensure();
        const names = new Set((await fs.readdir(dir)).map((n) => n.toLowerCase()));
        const name = folderNameFor(resolved, (n) => names.has(n.toLowerCase()));
        await fs.copyFile(resolved, full(name));
        return name;
      } catch {
        return null;
      }
    },
  };
}

/**
 * The IPC of the folder. `isAppSender(event)` keeps it to the app's own page;
 * `open(name)` is how a double-clicked map reaches the page.
 */
function setUpMapsFolder({ ipcMain, shell, folder, isAppSender, log }) {
  ipcMain.handle('desktop:maps-list', (event) => (isAppSender(event) ? folder.list() : []));
  ipcMain.handle('desktop:maps-read', (event, name) => (isAppSender(event) ? folder.read(name) : null));
  ipcMain.handle('desktop:maps-write', (event, payload) => {
    if (!isAppSender(event)) return null;
    const bytes = payload?.bytes instanceof Uint8Array ? payload.bytes : null;
    return folder.write(payload?.name, bytes);
  });
  ipcMain.handle('desktop:maps-remove', (event, name) => (isAppSender(event) ? folder.remove(name) : false));
  ipcMain.on('desktop:maps-reveal', (event) => {
    if (!isAppSender(event)) return;
    void shell.openPath(folder.dir).then((error) => error && log.warn(`[maps] could not open the folder: ${error}`));
  });
}

module.exports = { MAP_EXTENSION, MAX_MAP_BYTES, mapFileName, mapFileArg, folderNameFor, createMapsFolder, setUpMapsFolder };
