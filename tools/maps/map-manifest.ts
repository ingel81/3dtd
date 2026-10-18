/**
 * The manifest of the map files the site serves (`public/maps/manifest.json`):
 * every file under `public/maps` but the index and the manifest, by its path
 * there, with a hash of its content. The game keeps a file in its cache under
 * that hash (map-data.ts), so a cache outlives releases: a file whose content
 * did not change is not loaded again, one that changed is, and entries no
 * file names any more go.
 *
 *   node tools/maps/map-manifest.ts     writes it (npm run maps:manifest; maps:bake does too)
 *
 * `npm test` checks that it is current (map-manifest.spec.ts).
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/maps');
/** The files the manifest leaves out: the index names the maps, asked of the network every time, and itself */
const LEFT_OUT = new Set(['index.json', 'manifest.json']);

export interface MapManifest {
  version: 1;
  /** Hex hash of each file's content (the first 16 digits of its SHA-256), by its path under `maps/` */
  files: Record<string, string>;
}

export function buildMapManifest(root = MAPS_DIR): MapManifest {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        const name = relative(root, path).split(sep).join('/');
        if (!LEFT_OUT.has(name)) files[name] = createHash('sha256').update(contentOf(path)).digest('hex').slice(0, 16);
      }
    }
  };
  walk(root);
  return { version: 1, files };
}

/**
 * A file's bytes as the site serves them: a text file (no NUL in its first 8000 bytes, as git tells) with LF line
 * ends, whatever a Windows checkout made of them
 */
function contentOf(path: string): Buffer {
  const bytes = readFileSync(path);
  if (bytes.subarray(0, 8000).includes(0)) return bytes;
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

export function manifestText(manifest: MapManifest): string {
  return `${JSON.stringify(manifest, null, 1)}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = buildMapManifest();
  writeFileSync(join(MAPS_DIR, 'manifest.json'), manifestText(manifest));
  console.log(`maps/manifest.json: ${Object.keys(manifest.files).length} files`);
}
