import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEEP_LEASES } from '../../../three-engine/renderer-host';
import { bringMapToFront } from '../map-in-front';
import { MapAssetLibrary, type ImagePixels } from './map-asset-library';

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
  objects: [{ id: 'pine', name: 'Pine', category: 'tree', file: 'models/pine.glb', footprint: 2, height: 12 }],
};

/** A shared library over fakes: what it loaded, and what of it went back to the GPU's free list */
function library(base: string) {
  const freed = { geometries: 0, materials: 0, textures: 0 };
  const loadModel = vi.fn(() => {
    const geometry = new BoxGeometry();
    const map = new Texture();
    const material = new MeshStandardMaterial({ map });
    material.addEventListener('dispose', () => freed.materials++);
    map.addEventListener('dispose', () => freed.textures++);
    const root = new Group();
    root.add(new Mesh(geometry, material));
    return Promise.resolve(root);
  });
  const decodeImage = vi.fn(
    (_url: string, size: number): Promise<ImagePixels> => Promise.resolve({ width: size, height: size, data: new Uint8Array(size * size * 4) }),
  );
  const fetchFn = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response));
  const lib = MapAssetLibrary.shared(base, { fetch: fetchFn as unknown as typeof fetch, decodeImage, loadModel, textureSize: 4 });
  // The library loads geometry anew (merged, unquantized): what it keeps is the model's parts
  const counted = new WeakSet<object>();
  const load = async () => {
    const model = await lib.model('pine');
    for (const part of model.parts) {
      if (counted.has(part.geometry)) continue;
      counted.add(part.geometry);
      part.geometry.addEventListener('dispose', () => freed.geometries++);
    }
    return { model, material: await lib.material('grass') };
  };
  return { lib, freed, loadModel, decodeImage, load };
}

describe('MapAssetLibrary while views come and go', () => {
  afterEach(() => {
    bringMapToFront(null);
    MapAssetLibrary.forEachShared((lib) => lib.dispose());
  });

  it('keeps a map loaded over the switches between its editor and its test runs', async () => {
    const { lib, freed, loadModel, decodeImage, load } = library('lifetime-keep/');
    // The editor shows map A, a test run of it, the editor again, a second test run: each in its own lease
    bringMapToFront('A');
    lib.leaseBegan();
    lib.retain('A');
    const first = await load();
    for (let i = 0; i < 3; i++) {
      lib.release();
      lib.leaseBegan();
      lib.retain('A');
      expect(await load()).toEqual(first);
    }
    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(decodeImage).toHaveBeenCalledTimes(3);
    expect(freed).toEqual({ geometries: 0, materials: 0, textures: 0 });
    expect(lib.holdsAny()).toBe(true);
  });

  it('frees everything when another map comes to the front, also while the old map view still stands', async () => {
    const { lib, freed, loadModel, load } = library('lifetime-change/');
    bringMapToFront('A');
    lib.retain('A');
    const first = await load();
    // The next world opens before the old game is taken down: its view still draws
    bringMapToFront('B');
    expect(lib.holdsAny()).toBe(true);
    lib.release();
    expect(freed).toEqual({ geometries: 1, materials: 1, textures: 1 });
    expect(lib.holdsAny()).toBe(false);
    // Map B's prefetch fills the emptied library; its view keeps that
    const prefetched = lib.model('pine');
    lib.retain('B');
    expect(await lib.model('pine')).toBe(await prefetched);
    expect(await lib.model('pine')).not.toBe(first.model);
    expect(loadModel).toHaveBeenCalledTimes(2);
    expect(MapAssetLibrary.shared('lifetime-change/')).toBe(lib);
  });

  it('frees an unused map when the editor opens another, a real place or the globes come', async () => {
    for (const next of ['B', null]) {
      const { lib, freed, load } = library(`lifetime-front-${next}/`);
      bringMapToFront('A');
      lib.retain('A');
      await load();
      lib.release();
      expect(freed.geometries).toBe(0);
      bringMapToFront(next);
      expect(freed).toEqual({ geometries: 1, materials: 1, textures: 1 });
      expect(lib.holdsAny()).toBe(false);
      lib.dispose();
    }
    // A view of another map in the editor itself (the map in front not yet told)
    const { lib, freed, load } = library('lifetime-editor/');
    bringMapToFront('A');
    lib.retain('A');
    await load();
    lib.release();
    lib.retain('B');
    expect(freed).toEqual({ geometries: 1, materials: 1, textures: 1 });
  });

  it('frees its map after KEEP_LEASES leases that did not use it', async () => {
    const { lib, freed, load } = library('lifetime-leases/');
    bringMapToFront('A');
    lib.retain('A');
    await load();
    lib.release();
    // The lease begun next might still use it, so it counts once the one after begins
    for (let i = 0; i < KEEP_LEASES; i++) lib.leaseBegan();
    expect(lib.holdsAny()).toBe(true);
    lib.leaseBegan();
    expect(freed).toEqual({ geometries: 1, materials: 1, textures: 1 });
    expect(lib.holdsAny()).toBe(false);
  });

  it('leaves a library of its own owner to that owner', async () => {
    const own = new MapAssetLibrary('own-test/', {
      fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as unknown as typeof fetch,
      decodeImage: (_url, size) => Promise.resolve({ width: size, height: size, data: new Uint8Array(size * size * 4) }),
      textureSize: 4,
    });
    bringMapToFront('A');
    own.retain('A');
    await own.material('grass');
    own.release();
    bringMapToFront(null);
    own.retain('B');
    expect(own.holdsAny()).toBe(true);
    own.dispose();
  });
});
