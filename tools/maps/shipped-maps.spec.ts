/**
 * The maps the game ships (`public/maps/`): each is built from code, packed
 * as `.3dtdmap` with a top-down picture, and listed in `maps/index.json`
 * with its size and content hash. The editor's map browser and the game's
 * `?world=map:<id>` read them from there.
 *
 * Runs with `npm test`; packing is deterministic, so the files only change
 * when a map's code does:
 *   npx vitest run tools/maps/shipped-maps.spec.ts
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoMap } from '../../src/app/world/custom-map/demo-map';
import type { CustomMapDocument } from '../../src/app/world/custom-map/map-document';
import { contentHash, packMapFile, unpackMapFile, validateMapDocument } from '../../src/app/world/custom-map/map-file';
import type { ShippedMapIndex } from '../../src/app/world/custom-map/map-store';
import { writeGeneratedFile } from '../generated-file';
import { mapPicture } from './map-picture';

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/maps');

/** The shipped maps, in list order */
const SHIPPED: (() => CustomMapDocument)[] = [() => createDemoMap(7)];

/** Writes binary content unless the file holds the same bytes */
function writeBytes(path: string, bytes: Uint8Array): boolean {
  if (existsSync(path)) {
    const current = readFileSync(path);
    if (current.length === bytes.length && current.equals(bytes)) return false;
  }
  writeFileSync(path, bytes);
  return true;
}

describe('shipped maps', () => {
  it('packs every shipped map with its picture and lists it in maps/index.json', async () => {
    const index: ShippedMapIndex = { maps: [] };
    for (const build of SHIPPED) {
      const doc = build();
      expect(validateMapDocument(doc)).toEqual([]);
      const id = doc.meta.id;
      const png = mapPicture(doc, 256, resolve(MAPS_DIR, 'assets/catalog.json'));
      const file = packMapFile(doc, { preview: png });
      writeBytes(resolve(MAPS_DIR, `${id}.3dtdmap`), file);
      writeBytes(resolve(MAPS_DIR, `${id}.png`), png);
      const hash = await contentHash(doc);
      expect(await contentHash(unpackMapFile(file).doc)).toBe(hash);
      index.maps.push({
        id,
        name: doc.meta.name,
        file: `${id}.3dtdmap`,
        preview: `${id}.png`,
        author: doc.meta.author,
        description: doc.meta.description,
        width: doc.terrain.width,
        depth: doc.terrain.depth,
        spawns: doc.spawns.length,
        biome: doc.environment.biome ?? 'temperate',
        updatedAt: doc.meta.updatedAt,
        contentHash: hash,
      });
    }
    writeGeneratedFile(resolve(MAPS_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
    expect(new Set(index.maps.map((m) => m.id)).size).toBe(index.maps.length);
  });
});
