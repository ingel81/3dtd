import { BoxGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Texture, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCatalog } from './asset-catalog';
import { MapAssetLibrary, packMaterial, sharedMaterials, toneMaterials, type ImagePixels } from './map-asset-library';
import { mergeParts } from './objects/merge-parts';
import { RendererHost } from '../../../three-engine/renderer-host';
import { isSharedGpu } from '../../../three-engine/shared-gpu';
import { fakeRenderer } from '../../../../test/fake-renderer';

const catalog = {
  version: 1,
  materials: [
    {
      id: 'grass',
      name: 'Grass',
      category: 'grass',
      files: { color: 'grass/color.jpg', normal: 'grass/normal.jpg', arh: 'grass/arh.jpg' },
      scale: 4,
      average: '#406020',
    },
  ],
  objects: [
    {
      id: 'pine',
      name: 'Pine',
      category: 'tree',
      file: 'models/pine.glb',
      footprint: 2,
      height: 12,
      blocksLos: true,
      blocksBuild: true,
      scaleRange: [0.8, 1.2],
      randomRotation: true,
      wind: 0.6,
    },
  ],
};

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: () => Promise.resolve(body) } as Response;
}

function image(size: number, rgba: [number, number, number, number]): ImagePixels {
  const data = new Uint8Array(size * size * 4);
  for (let q = 0; q < data.length; q += 4) data.set(rgba, q);
  return { width: size, height: size, data };
}

describe('asset catalogue', () => {
  it('rejects other versions and duplicate ids', () => {
    expect(() => parseCatalog({ ...catalog, version: 2 })).toThrow(/version/);
    expect(() => parseCatalog({ ...catalog, objects: [{ ...catalog.objects[0], id: 'grass' }] })).toThrow(/duplicate/);
    expect(parseCatalog(catalog).materials[0].id).toBe('grass');
  });
});

describe('MapAssetLibrary', () => {
  it('loads the catalogue once and resolves files against the base url', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(catalog)));
    const decodeImage = vi.fn((url: string, size: number) =>
      Promise.resolve(image(size, url.endsWith('arh.jpg') ? [200, 100, 50, 255] : [10, 20, 30, 255])),
    );
    const lib = new MapAssetLibrary('base/', { fetch: fetchFn as unknown as typeof fetch, decodeImage, textureSize: 4 });
    const [a, b] = await Promise.all([lib.material('grass'), lib.material('grass')]);
    expect(a).toBe(b);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('base/catalog.json');
    expect(decodeImage.mock.calls.map((c) => c[0]).sort()).toEqual([
      'base/grass/arh.jpg',
      'base/grass/color.jpg',
      'base/grass/normal.jpg',
    ]);
    // color: albedo + height (arh blue); data: normal xy, roughness (arh green), AO (arh red)
    expect(Array.from(a.color.subarray(0, 4))).toEqual([10, 20, 30, 50]);
    expect(Array.from(a.data.subarray(0, 4))).toEqual([10, 20, 100, 200]);
  });

  it('frees the textures of its models and their detail levels on dispose', async () => {
    const withLod = { ...catalog, objects: [{ ...catalog.objects[0], lod: [{ file: 'models/pine-lod1.glb', screen: 0.1 }] }] };
    const textures: Texture[] = [];
    const lib = new MapAssetLibrary('base/', {
      fetch: (() => Promise.resolve(jsonResponse(withLod))) as unknown as typeof fetch,
      loadModel: () => {
        const map = new Texture();
        const normalMap = new Texture();
        textures.push(map, normalMap);
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ map, normalMap })));
        return Promise.resolve(root);
      },
    });
    await lib.model('pine');
    await lib.lodModels('pine');
    expect(textures).toHaveLength(4);
    const disposed = textures.map((t) => {
      const spy = vi.fn();
      t.addEventListener('dispose', spy);
      return spy;
    });
    lib.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(disposed.every((spy) => spy.mock.calls.length === 1)).toBe(true);
  });

  it('forgets its models when the GPU loses its copies (a new renderer, a restored context): the next view loads them again', async () => {
    let loads = 0;
    const lib = MapAssetLibrary.shared('gpu-reset/', {
      fetch: (() => Promise.resolve(jsonResponse(catalog))) as unknown as typeof fetch,
      loadModel: () => {
        loads++;
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ map: new Texture() })));
        return Promise.resolve(root);
      },
    });
    const model = await lib.model('pine');
    const material = model.parts[0].material as MeshStandardMaterial;
    const spies = [material, material.map!, model.parts[0].geometry].map((target) => {
      const spy = vi.fn();
      target.addEventListener('dispose', spy);
      return spy;
    });
    // Its textures are the page's: a lease that drew them leaves them on the GPU
    expect(isSharedGpu(material.map!)).toBe(true);
    // The renderer made anew for the other MSAA
    const host = new RendererHost(() => fakeRenderer() as unknown as WebGLRenderer);
    host.acquire(document.createElement('div'), true).release();
    expect(await lib.model('pine')).toBe(model);
    host.acquire(document.createElement('div'), false);
    expect(spies.every((spy) => spy.mock.calls.length === 1)).toBe(true);
    expect(isSharedGpu(material.map!)).toBe(false);
    const again = await lib.model('pine');
    expect(again).not.toBe(model);
    expect(loads).toBe(2);
    // A lost context back
    host.renderer!.domElement.dispatchEvent(new Event('webglcontextrestored'));
    expect(await lib.model('pine')).not.toBe(again);
    expect(loads).toBe(3);
    host.dispose();
    lib.dispose();
  });

  it('disposes after a detail model failed to load without an unhandled rejection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const withLod = { ...catalog, objects: [{ ...catalog.objects[0], lod: [{ file: 'models/missing.glb', screen: 0.1 }] }] };
    const lib = new MapAssetLibrary('base/', {
      fetch: (() => Promise.resolve(jsonResponse(withLod))) as unknown as typeof fetch,
      loadModel: () => Promise.reject(new Error('404')),
    });
    expect(await lib.lodModels('pine')).toEqual([]);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    lib.dispose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('keeps cloth drawn from both sides: the shipped models carry it, the library and its merged parts keep it', async () => {
    // The materials the builders mark two_sided (cloth, canopies, flags, sails), by the names they give them
    const root = resolve(__dirname, '../../../../..');
    const builders = readdirSync(resolve(root, 'tools/map-assets')).filter((f) => f.endsWith('.py'));
    const names = builders.flatMap((f) => [...readFileSync(resolve(root, 'tools/map-assets', f), 'utf8').matchAll(/two_sided\(\w+\('([^']+)'/g)].map((m) => m[1]));
    expect(names.length).toBeGreaterThan(5);
    const models = resolve(root, 'public/maps/assets/models');
    const cloth: string[] = [];
    for (const file of readdirSync(models).filter((f) => f.endsWith('.glb'))) {
      const glb = readFileSync(resolve(models, file));
      const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as { materials?: { name: string; doubleSided?: boolean }[] };
      for (const m of json.materials ?? []) if (names.some((n) => m.name.startsWith(n))) cloth.push(`${file} ${m.name} ${m.doubleSided ? 'both' : 'front'}`);
    }
    expect(cloth.length).toBeGreaterThan(5);
    expect(cloth.filter((c) => c.endsWith('front'))).toEqual([]);
    // Loaded (GLTFLoader: doubleSided is DoubleSide) and merged with the plain parts it shares nothing with
    const lib = new MapAssetLibrary('base/', {
      fetch: (() => Promise.resolve(jsonResponse(catalog))) as unknown as typeof fetch,
      loadModel: () => {
        const group = new Group();
        group.add(new Mesh(new PlaneGeometry(2, 2), new MeshStandardMaterial({ name: 'cloth-hessian', side: DoubleSide })));
        group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: 'planks', side: DoubleSide })));
        group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ name: 'goods', side: DoubleSide, color: 0xff0000 })));
        return Promise.resolve(group);
      },
    });
    const model = await lib.model('pine');
    expect(model.parts.length).toBeGreaterThan(0);
    const merged = mergeParts(model.parts);
    expect(merged.length).toBeLessThan(model.parts.length);
    for (const part of [...model.parts, ...merged]) expect(part.material.side).toBe(DoubleSide);
    lib.dispose();
  });

  it('falls back to flat materials and placeholder models', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(catalog)));
    const lib = new MapAssetLibrary('base/', {
      fetch: fetchFn as unknown as typeof fetch,
      decodeImage: () => Promise.reject(new Error('404')),
      loadModel: () => Promise.reject(new Error('404')),
      textureSize: 2,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = await lib.material('grass');
    expect(Array.from(m.color.subarray(0, 3))).toEqual([0x40, 0x60, 0x20]);
    const model = await lib.model('pine');
    expect(model.placeholder).toBe(true);
    expect(model.parts.length).toBe(2);
    expect(model.height).toBeCloseTo(12, 0);
    const unknown = await lib.model('nope');
    expect(unknown.entry.category).toBe('prop');
  });

  it('packs material maps', () => {
    const p = packMaterial('x', 1, image(1, [1, 2, 3, 255]), image(1, [4, 5, 6, 255]), image(1, [7, 8, 9, 255]), [0, 0, 0]);
    expect(Array.from(p.color)).toEqual([1, 2, 3, 9]);
    expect(Array.from(p.data)).toEqual([4, 5, 8, 7]);
  });
});

describe('sharedMaterials', () => {
  it("draws a far copy's parts with the full model's materials of the same name, and frees its own but not their shared textures", () => {
    const named = (name: string, map?: Texture): MeshStandardMaterial => Object.assign(new MeshStandardMaterial({ map: map ?? null }), { name });
    const bark = named('bark-oak');
    const leaves = named('foliage-oak');
    const full = [
      { geometry: new BoxGeometry(), material: bark },
      { geometry: new BoxGeometry(), material: leaves },
    ];
    const token = new Texture();
    const disposed = vi.spyOn(token, 'dispose');
    const own = named('foliage-oak', token);
    const other = named('paint');
    // A plain-coloured copy of the bark (a flat LOD, no texture) keeps its own colour
    const flatBark = named('bark-oak');
    const lod = sharedMaterials(
      [
        { geometry: new BoxGeometry(), material: own },
        { geometry: new BoxGeometry(), material: other },
        { geometry: new BoxGeometry(), material: flatBark },
      ],
      full,
    );
    expect(lod[0].material).toBe(leaves);
    // A material the model does not have stays the copy's own
    expect(lod[1].material).toBe(other);
    expect(lod[2].material).toBe(flatBark);
    // The texture files are the library's, drawn by the full model too
    expect(disposed).not.toHaveBeenCalled();
  });
});

describe('toneMaterials', () => {
  it("multiplies each named flat material of a LOD model by its tone, once however many parts share it", () => {
    const named = (name: string, color: number): MeshStandardMaterial => Object.assign(new MeshStandardMaterial({ color }), { name });
    const roof = named('roof-red-tiles-lod', 0xffffff);
    const wall = named('plaster-lod', 0x808080);
    const parts = [roof, roof, wall].map((material) => ({ geometry: new BoxGeometry(), material }));
    expect(toneMaterials(parts, { 'roof-red-tiles-lod': [0.5, 0.25, 1] })).toBe(parts);
    expect(roof.color.toArray()).toEqual([0.5, 0.25, 1]);
    // A material without a tone keeps its colour
    expect(wall.color.getHex()).toBe(0x808080);
    // No tones: nothing changes
    expect(toneMaterials(parts, undefined)).toBe(parts);
    expect(roof.color.toArray()).toEqual([0.5, 0.25, 1]);
  });
});
