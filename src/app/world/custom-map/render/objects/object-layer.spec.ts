import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../map-document';
import type { AssetCatalog } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { MapObjectLayer } from './object-layer';

const catalog: AssetCatalog = {
  version: 1,
  materials: [],
  objects: [
    {
      id: 'tree',
      name: 'Tree',
      category: 'tree',
      file: 'tree.glb',
      footprint: 1,
      height: 10,
      blocksLos: true,
      blocksBuild: true,
      scaleRange: [1, 1],
      randomRotation: false,
      wind: 0,
      drawDistance: 5000,
      lod: [{ file: 'tree-far.glb', distance: 100 }],
    },
  ],
};

function library(): MapAssetLibrary {
  return new MapAssetLibrary('base/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    loadModel: (url) => {
      const root = new Group();
      root.add(new Mesh(new BoxGeometry(1, url.includes('far') ? 2 : 10, 1), new MeshStandardMaterial()));
      return Promise.resolve(root);
    },
  });
}

describe('MapObjectLayer levels of detail', () => {
  it('shows each cell of trees at the level of its camera distance, all in the LOS group', async () => {
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights: new Float32Array(4) }, 1000, 1000);
    const los = new Group();
    const layer = new MapObjectLayer(field, library(), los);
    const objects: MapObject[] = Array.from({ length: 20 }, (_, k) => ({
      id: `t${k}`,
      asset: 'tree',
      x: k * 20,
      y: 0,
      z: 0,
      rotation: 0,
      scale: 1,
    }));
    await layer.setObjects(objects);
    const scene = new Scene();
    scene.add(los, layer.group);
    const camera = new PerspectiveCamera();
    camera.position.set(0, 5, 0); // above map x = 0
    camera.updateMatrixWorld();
    layer.update(0.016, camera);
    const visible = (name: string): number =>
      los.children
        .filter((c): c is InstancedMesh => c instanceof InstancedMesh && c.name === name && c.visible)
        .reduce((n, m) => n + m.count, 0);
    // Cells of 192 m: trees at map x 0..180 are in the camera's cell, 200..380 in the next, past 100 m
    expect(visible('tree')).toBe(10);
    expect(visible('tree-lod1')).toBe(10);
    // Every tree is drawn exactly once
    expect(visible('tree') + visible('tree-lod1')).toBe(20);
    layer.dispose();
  });
});

describe('MapObjectLayer floating objects', () => {
  it('puts a floating object at the water level, on dry ground at the terrain', async () => {
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights: new Float32Array(4).fill(-3) }, 1000, 1000);
    const boat = { ...catalog.objects[0], id: 'boat', category: 'prop' as const, float: true, lod: undefined, file: 'boat.glb' };
    const lib = new MapAssetLibrary('base/', {
      fetch: (() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...catalog, objects: [boat] }) } as Response)) as typeof fetch,
      loadModel: () => {
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
        return Promise.resolve(root);
      },
    });
    let level: number | null = 1.5;
    const los = new Group();
    const layer = new MapObjectLayer(field, lib, los, { waterLevelAt: () => level });
    await layer.setObjects([{ id: 'b', asset: 'boat', x: 0, y: 0, z: 0.2, rotation: 0, scale: 1 }]);
    const mesh = (): InstancedMesh =>
      [...layer.group.children, ...los.children].find((c): c is InstancedMesh => c instanceof InstancedMesh)!;
    const y = (): number => mesh().instanceMatrix.array[13];
    expect(y()).toBeCloseTo(1.7);
    level = null;
    layer.refreshHeights(undefined, true);
    expect(y()).toBeCloseTo(-2.8);
    // Boats rock: their own program that moves the vertices with time
    const material = mesh().material as MeshStandardMaterial;
    expect(material.customProgramCacheKey()).toMatch(/^custom-map-object-b-/);
    layer.dispose();
  });
});

describe('MapObjectLayer glowing surfaces', () => {
  it('caps a strong emissive so a lava pool does not burn into a flat disc at night', async () => {
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights: new Float32Array(4) }, 1000, 1000);
    const pool = { ...catalog.objects[0], id: 'pool', category: 'rock' as const, lod: undefined, file: 'pool.glb' };
    const melt = new MeshStandardMaterial({ emissive: 0xff4c08, emissiveIntensity: 1 });
    const lib = new MapAssetLibrary('base/', {
      fetch: (() =>
        Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ...catalog, objects: [pool] }) } as Response)) as typeof fetch,
      loadModel: () => {
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(1, 1, 1), melt));
        return Promise.resolve(root);
      },
    });
    const los = new Group();
    const layer = new MapObjectLayer(field, lib, los);
    await layer.setObjects([{ id: 'p', asset: 'pool', x: 0, y: 0, z: 0, rotation: 0, scale: 1 }]);
    const mesh = [...layer.group.children, ...los.children].find((c): c is InstancedMesh => c instanceof InstancedMesh)!;
    const m = mesh.material as MeshStandardMaterial;
    expect(m.emissive.r * m.emissiveIntensity).toBeLessThanOrEqual(0.551);
    expect(m.emissive.r * m.emissiveIntensity).toBeGreaterThan(0.5);
    layer.dispose();
  });
});
