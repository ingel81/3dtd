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
  it('puts each tree into the level of its camera distance, all of them in the LOS group', async () => {
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
    const near = los.children.find((c) => c.name === 'tree') as InstancedMesh;
    const far = los.children.find((c) => c.name === 'tree-lod1') as InstancedMesh;
    // Trees at map x 0..80 are within 100 m, 100..380 beyond
    expect(near.count).toBe(5);
    expect(far.count).toBe(15);
    layer.dispose();
  });
});
