/**
 * The maps the game ships (`public/maps/`): each is built from code, packed
 * as `.3dtdmap` with a top-down picture, and listed in `maps/index.json`
 * with its size and content hash. The editor's map browser and the game's
 * `?world=map:<id>` read them from there.
 *
 * `npm run maps:bake` builds and writes them (vitest's "maps" mode; one map
 * alone: `npm run maps:bake -- -t <id>`). Packing is deterministic, so the
 * files only change when a map's code or an operation it uses does. A new
 * content hash makes replays, saved runs and own copies of that map stale,
 * so it is written only on purpose.
 *
 * With `npm test` it writes nothing: it builds each map and fails when the
 * content hash or the list entry differs from `maps/index.json`.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CustomMapDocument } from '../../src/app/world/custom-map/map-document';
import { contentHash, packMapFile, unpackMapFile, validateMapDocument } from '../../src/app/world/custom-map/map-file';
import { mapRepairs } from '../../src/app/world/custom-map/map-repair';
import type { ShippedMapEntry, ShippedMapIndex } from '../../src/app/world/custom-map/map-store';
import { writeGeneratedFile } from '../generated-file';
import { SHOWCASE_LEVELS } from './levels';
import { buildDemoValley } from './levels/demo-valley';
import { mapPicture } from './map-picture';

const MAPS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../public/maps');
const INDEX = resolve(MAPS_DIR, 'index.json');
/** Writes the maps only in vitest's "maps" mode (npm run maps:bake) */
const BAKE = (import.meta as { env?: Record<string, string> }).env?.['MODE'] === 'maps';
const BAKE_HINT = "run npm run maps:bake, this changes the shipped maps' hashes";

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

/** The entries of maps/index.json as they are */
function readIndex(): ShippedMapEntry[] {
  return existsSync(INDEX) ? ((JSON.parse(readFileSync(INDEX, 'utf8')) as ShippedMapIndex).maps ?? []) : [];
}

/** Puts a map's entry into maps/index.json, in list order; one map can be packed alone (`-t <id>`) */
function listInIndex(entry: ShippedMapEntry): void {
  const current = readIndex();
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
    it(`${BAKE ? 'packs' : 'checks'} ${map.id} with its picture and its entry in maps/index.json`, async () => {
      const doc = map.build();
      expect(doc.meta.id).toBe(map.id);
      expect(validateMapDocument(doc)).toEqual([]);
      expect(mapRepairs(doc)).toEqual([]);
      const id = doc.meta.id;
      const hash = await contentHash(doc);
      const entry: ShippedMapEntry = {
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
      };
      if (!BAKE) {
        const listed = readIndex().find((m) => m.id === id);
        expect(listed, `${id} is not in maps/index.json: ${BAKE_HINT}`).toBeDefined();
        expect(hash, `${id} builds to another map than the one shipped (${listed!.contentHash}): ${BAKE_HINT}`).toBe(listed!.contentHash);
        expect(listed, `${id}'s entry in maps/index.json is out of date: run npm run maps:bake`).toEqual(entry);
        return;
      }
      const png = mapPicture(doc, 256, resolve(MAPS_DIR, 'assets/catalog.json'));
      const file = packMapFile(doc, { preview: png });
      writeBytes(resolve(MAPS_DIR, `${id}.3dtdmap`), file);
      writeBytes(resolve(MAPS_DIR, `${id}.png`), png);
      expect(await contentHash(unpackMapFile(file).doc)).toBe(hash);
      listInIndex(entry);
    });
  }

  it.skipIf(BAKE)('ships no map that is not built here', () => {
    expect(readIndex().map((m) => m.id)).toEqual(SHIPPED.map((m) => m.id));
  });
});
