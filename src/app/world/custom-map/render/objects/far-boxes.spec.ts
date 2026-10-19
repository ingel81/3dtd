import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, PerspectiveCamera, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { MapObjectLayer } from './object-layer';

/** A house of radius 6 m whose box takes over where it fills 6 / (300 tan 30°) of the screen: 300 m from its bounds */
const house: CatalogObject = {
  id: 'house',
  name: 'House',
  category: 'building',
  file: 'house.glb',
  footprint: 1,
  height: 10,
  blocksLos: true,
  blocksBuild: true,
  scaleRange: [1, 1],
  randomRotation: false,
  wind: 0,
  drawDistance: 5000,
  far: { screen: 6 / (300 * Math.tan(Math.PI / 6)), tile: 0, box: [0, 0, 4, 3, -1, 10], top: [6, 6, 6, 9, 9, 9, 6, 6, 6] },
};
const catalog: AssetCatalog = { version: 1, materials: [], objects: [house, { ...house, id: 'shed', far: undefined }] };

function library(): MapAssetLibrary {
  return new MapAssetLibrary('base/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    loadModel: () => {
      const root = new Group();
      root.add(new Mesh(new BoxGeometry(8, 10, 6).translate(0, 5, 0), new MeshStandardMaterial()));
      return Promise.resolve(root);
    },
    loadTexture: () => Promise.resolve(new Texture({ width: 1024, height: 64 })),
  });
}

describe('far boxes', () => {
  it('draws the far buildings of every asset in one box mesh, and none of an asset without a box', async () => {
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights: new Float32Array(4) }, 1000, 1000);
    const los = new Group();
    const layer = new MapObjectLayer(field, library(), los);
    await layer.setObjects([
      { id: 'a', asset: 'house', x: 0, y: 0, z: 0, rotation: 0, scale: 1 },
      { id: 'b', asset: 'house', x: 600, y: 0, z: 0, rotation: 0, scale: 1 },
      { id: 'c', asset: 'shed', x: 600, y: 20, z: 0, rotation: 0, scale: 1 },
    ]);
    const camera = new PerspectiveCamera(60);
    camera.position.set(0, 5, 0);
    camera.updateMatrixWorld();
    layer.update(0.016, camera);
    const boxes = los.children.find((c): c is InstancedMesh => c instanceof InstancedMesh && c.name === 'far-boxes')!;
    const model = los.children.find((c): c is InstancedMesh => c instanceof InstancedMesh && c.name === 'house')!;
    // The near house its model, the far one its box; the far shed keeps its model
    expect(model.count).toBe(1);
    expect(boxes.count).toBe(1);
    expect(boxes.geometry.index!.count / 3).toBe(24);
    expect(los.children.find((c) => c.name === 'shed' && (c as InstancedMesh).count === 1)).toBeDefined();
    // The box carries its asset's row and draws in the line of sight with the same shape
    expect(boxes.geometry.getAttribute('aFarRow').array[0]).toBe(0);
    expect(boxes.userData['losVertex'].vertex).toContain('farBoxLocal');
    // Moving over: the far house comes near, the near one goes far
    camera.position.set(-600, 5, 0);
    camera.updateMatrixWorld();
    layer.update(0.016, camera);
    expect(model.count).toBe(1);
    expect(boxes.count).toBe(1);
    expect(boxes.instanceMatrix.array[12]).toBeCloseTo(0);
    layer.removeObjects(['a']);
    expect(boxes.count).toBe(0);
    layer.dispose();
  });

  it('shows a damaged building far off as its ruin, never as a whole box', async () => {
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights: new Float32Array(4) }, 1000, 1000);
    const los = new Group();
    const layer = new MapObjectLayer(field, library(), los, { ruins: true });
    await layer.setObjects([
      { id: 'a', asset: 'house', x: 600, y: 0, z: 0, rotation: 0, scale: 1 },
      { id: 'b', asset: 'house', x: 600, y: 20, z: 0, rotation: 0, scale: 1 },
    ]);
    const camera = new PerspectiveCamera(60);
    camera.position.set(0, 5, 0);
    camera.updateMatrixWorld();
    layer.update(0.016, camera);
    const boxes = los.children.find((c): c is InstancedMesh => c instanceof InstancedMesh && c.name === 'far-boxes')!;
    const ruin = (): number => los.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh && c.name.startsWith('house-damaged')).reduce((n, m) => n + (m.visible ? m.count : 0), 0);
    expect(boxes.count).toBe(2);
    // Battered, holed and fallen: out of the boxes into its asset's ruin batch, drawn with its model however far
    for (const stage of [1, 2, 3]) {
      layer.setDamage([{ id: 'b', stage, fallStart: -1e6 }]);
      layer.update(0.016, camera);
      expect(boxes.count).toBe(1);
      expect(ruin()).toBe(1);
    }
    // Whole again (a new run): its box again
    layer.setDamage([{ id: 'b', stage: 0, fallStart: -1e6 }]);
    layer.update(0.016, camera);
    expect(boxes.count).toBe(2);
    expect(ruin()).toBe(0);
    layer.dispose();
  });
});
