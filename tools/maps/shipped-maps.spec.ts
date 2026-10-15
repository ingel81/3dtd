/**
 * The maps the game ships (`public/maps/`): each is built from code, packed
 * as `.3dtdmap` with a top-down picture, and listed in `maps/index.json`
 * with its size and content hash. The editor's map browser and the game's
 * `?world=map:<id>` read them from there.
 *
 * Runs with `npm test`; packing is deterministic, so the files only change
 * when a map's code does:
 *   npx vitest run tools/maps/shipped-maps.spec.ts [-t <id>]
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CustomMapDocument } from '../../src/app/world/custom-map/map-document';
import { contentHash, packMapFile, unpackMapFile, validateMapDocument } from '../../src/app/world/custom-map/map-file';
import type { ShippedMapEntry, ShippedMapIndex } from '../../src/app/world/custom-map/map-store';
import { writeGeneratedFile } from '../generated-file';
import { SHOWCASE_LEVELS } from './levels';
import { buildDemoValley } from './levels/demo-valley';
import { mapPicture } from './map-picture';

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/maps');
const INDEX = resolve(MAPS_DIR, 'index.json');

/** The shipped maps, in list order: the demo valley (the generated sample map, dressed), then the showcase levels (tools/maps/levels/) */
const SHIPPED: { id: string; build: () => CustomMapDocument }[] = [{ id: 'demo-valley', build: buildDemoValley }, ...SHOWCASE_LEVELS];

/** Writes binary content unless the file holds the same bytes */
function writeBytes(path: string, bytes: Uint8Array): boolean {
  if (existsSync(path)) {
    const current = readFileSync(path);
    if (current.length === bytes.length && current.equals(bytes)) return false;
  }
  writeFileSync(path, bytes);
  return true;
}

/** Puts a map's entry into maps/index.json, in list order; one map can be packed alone (`-t <id>`) */
function listInIndex(entry: ShippedMapEntry): void {
  const current: ShippedMapEntry[] = existsSync(INDEX) ? ((JSON.parse(readFileSync(INDEX, 'utf8')) as ShippedMapIndex).maps ?? []) : [];
  const byId = new Map(current.map((m) => [m.id, m]));
  byId.set(entry.id, entry);
  const index: ShippedMapIndex = { maps: SHIPPED.map((m) => byId.get(m.id)).filter((m): m is ShippedMapEntry => !!m) };
  writeGeneratedFile(INDEX, `${JSON.stringify(index, null, 2)}
`);
}

describe('shipped maps', () => {
  it('has one entry per id', () => {
    expect(new Set(SHIPPED.map((m) => m.id)).size).toBe(SHIPPED.length);
  });

  for (const map of SHIPPED) {
    it(`packs ${map.id} with its picture and lists it in maps/index.json`, async () => {
      const doc = map.build();
      expect(doc.meta.id).toBe(map.id);
      expect(validateMapDocument(doc)).toEqual([]);
      const id = doc.meta.id;
      const png = mapPicture(doc, 256, resolve(MAPS_DIR, 'assets/catalog.json'));
      const file = packMapFile(doc, { preview: png });
      writeBytes(resolve(MAPS_DIR, `${id}.3dtdmap`), file);
      writeBytes(resolve(MAPS_DIR, `${id}.png`), png);
      const hash = await contentHash(doc);
      expect(await contentHash(unpackMapFile(file).doc)).toBe(hash);
      listInIndex({
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
    });
  }
});
