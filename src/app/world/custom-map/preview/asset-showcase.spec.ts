import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCatalog, type AssetCatalog, type CatalogObject } from '../render/asset-catalog';
import { createAssetShowcase } from './asset-showcase';

const ROOT = 'public/maps/assets/';
const shipped = parseCatalog(JSON.parse(readFileSync(ROOT + 'catalog.json', 'utf8')));

function object(id: string, footprint: number, tags: string[] = []): CatalogObject & { tags: string[] } {
  return {
    id,
    name: id,
    category: 'rock',
    file: '',
    footprint,
    height: 1,
    blocksLos: false,
    blocksBuild: false,
    scaleRange: [1, 1],
    randomRotation: false,
    wind: 0,
    drawDistance: 100,
    tags,
  };
}

describe('shipped asset catalogue', () => {
  it('names files that exist', () => {
    for (const m of shipped.materials) {
      for (const file of Object.values(m.files)) expect(existsSync(ROOT + file), file).toBe(true);
    }
    for (const o of shipped.objects) expect(existsSync(ROOT + o.file), o.file).toBe(true);
  });

  it('gives every object a size, a draw distance and at least one biome tag', () => {
    for (const o of shipped.objects as (CatalogObject & { tags?: string[] })[]) {
      expect(o.footprint, o.id).toBeGreaterThan(0);
      expect(o.height, o.id).toBeGreaterThan(0);
      expect(o.drawDistance, o.id).toBeGreaterThan(0);
      expect(o.tags?.length ?? 0, o.id).toBeGreaterThan(0);
    }
  });

  it('lists every file under the asset folder in LICENSES.md', () => {
    const licences = readFileSync(ROOT + 'LICENSES.md', 'utf8');
    for (const e of [...shipped.materials, ...shipped.objects]) expect(licences, e.id).toContain(`| ${e.id} |`);
  });
});

describe('asset showcase', () => {
  const catalog: AssetCatalog = {
    version: 1,
    materials: shipped.materials.slice(0, 3),
    objects: [object('a', 1, ['winter']), object('b', 2), object('c', 1, ['winter'])],
  };

  it('picks the objects of a tag and centres each row on x = 0', () => {
    const doc = createAssetShowcase(catalog, { tag: 'winter' });
    expect(doc.objects.map((o) => o.asset)).toEqual(['a', 'c']);
    const xs = doc.objects.map((o) => o.x);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(0);
  });

  it('paints the given materials as bands from west to east', () => {
    const ids = catalog.materials.map((m) => m.id);
    const doc = createAssetShowcase(catalog, { materials: ids, objects: ['b'] });
    expect(doc.terrain.layers.map((l) => l.material)).toEqual(ids);
    const { resolution, maps } = doc.terrain.splat;
    const row = resolution * 4 * Math.floor(resolution / 2);
    expect(maps[0][row]).toBe(255); // west edge: layer 0
    expect(maps[0][row + (resolution - 1) * 4 + 2]).toBe(255); // east edge: layer 2
  });
});
