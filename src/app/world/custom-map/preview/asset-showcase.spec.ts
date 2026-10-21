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
    tags,
  };
}

describe('shipped asset catalogue', () => {
  it('names files that exist', () => {
    for (const m of shipped.materials) {
      const { packed, ...images } = m.files;
      for (const file of [...Object.values(images), ...Object.values(packed ?? {})]) expect(existsSync(ROOT + file), file).toBe(true);
    }
    // Effect-only entries (category fx) have no model
    for (const o of shipped.objects) if (o.file) expect(existsSync(ROOT + o.file), o.file).toBe(true);
    for (const o of shipped.objects) for (const l of o.lod ?? []) expect(existsSync(ROOT + l.file), l.file).toBe(true);
  });

  it('gives every object a size and at least one biome tag', () => {
    for (const o of shipped.objects as (CatalogObject & { tags?: string[] })[]) {
      expect(o.footprint, o.id).toBeGreaterThan(0);
      expect(o.height, o.id).toBeGreaterThan(0);
      expect(o.tags?.length ?? 0, o.id).toBeGreaterThan(0);
    }
  });

  it('keeps every material of a building in its distance copies, its small parts whole (a hall without its roof past 350 m)', () => {
    // Triangles per material of a GLB, flat LOD stand-ins (`<name>-lod`) under their full model's name
    const triangles = (file: string): Map<string, number> => {
      const glb = readFileSync(ROOT + file);
      const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8')) as {
        materials?: { name: string }[];
        meshes: { primitives: { material?: number; indices?: number; attributes: { POSITION: number } }[] }[];
        accessors: { count: number }[];
      };
      const out = new Map<string, number>();
      for (const mesh of gltf.meshes) {
        for (const p of mesh.primitives) {
          const name = (gltf.materials?.[p.material ?? 0]?.name ?? '').replace(/-lod$/, '');
          out.set(name, (out.get(name) ?? 0) + gltf.accessors[p.indices ?? p.attributes.POSITION].count / 3);
        }
      }
      return out;
    };
    for (const o of shipped.objects) {
      if (o.category !== 'building' || !o.lod) continue;
      const full = triangles(o.file);
      for (const l of o.lod) {
        const lod = triangles(l.file);
        expect([...full.keys()].filter((m) => !lod.has(m)), l.file).toEqual([]);
        // decimate_keeping leaves a material of up to 24 faces (here triangles) whole: a roof of a few big quads
        expect([...full].filter(([m, n]) => n <= 24 && lod.get(m) !== n).map(([m]) => m), l.file).toEqual([]);
      }
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
