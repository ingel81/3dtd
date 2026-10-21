import { BoxGeometry, Color, Group, InstancedMesh, Mesh, MeshStandardMaterial, PerspectiveCamera, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { bandColours, hasBand } from './line-bands';
import { MapObjectLayer } from './object-layer';

/** A wall piece of 2 m radius (4 m long, 1 m high): its LOD model from 40 m, its band from 3 px (623 m at High) */
const wall: CatalogObject = {
  id: 'wall',
  name: 'Wall',
  category: 'wall',
  file: 'wall.glb',
  footprint: 2,
  height: 1,
  box: [0, 0, 1.9, 0.3],
  blocksLos: true,
  blocksBuild: true,
  scaleRange: [1, 1],
  randomRotation: false,
  wind: 0,
  lod: [{ file: 'wall-lod1.glb', screen: 2 / (40 * Math.tan(Math.PI / 6)), tone: [0.5, 1, 1] }],
};
const catalog: AssetCatalog = { version: 1, materials: [], objects: [wall] };

function library(): MapAssetLibrary {
  return new MapAssetLibrary('base/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    loadModel: (url) => {
      const root = new Group();
      // A box 4 m long and 1 m high, the LOD model grey
      const lod = url.includes('lod1');
      root.add(new Mesh(new BoxGeometry(4, 1, 0.6).translate(0, 0.5, 0), new MeshStandardMaterial({ color: lod ? 0x808080 : 0xffffff })));
      return Promise.resolve(root);
    },
  });
}

describe('line bands', () => {
  it('takes an asset a band when it is a wall or structure with a ground rectangle and a LOD model', () => {
    expect(hasBand(wall)).toBe(true);
    expect(hasBand({ ...wall, box: undefined })).toBe(false);
    expect(hasBand({ ...wall, lod: undefined })).toBe(false);
    expect(hasBand({ ...wall, category: 'prop' })).toBe(false);
  });

  it("colours a band with its model's mean colours up and at the sides, times the stage's tone; none for a textured model", () => {
    const lid = new BoxGeometry(2, 0.01, 2);
    const parts = [
      { geometry: lid, material: new MeshStandardMaterial({ color: new Color(1, 0, 0) }) },
      { geometry: new BoxGeometry(2, 2, 2).translate(0, -1, 0), material: new MeshStandardMaterial({ color: new Color(0, 0, 1) }) },
    ];
    const c = bandColours(parts, [0.5, 1, 1])!;
    // The top: the lid's top, the box's top (both 4 m²), half red and half blue; the red halved by the tone
    expect(c.top.r).toBeCloseTo(0.25, 2);
    expect(c.top.b).toBeCloseTo(0.5, 2);
    // The sides: the box's 16 m² of blue against the lid's thin rim and both bottoms
    expect(c.side.b).toBeGreaterThan(0.8);
    expect(bandColours([{ geometry: lid, material: new MeshStandardMaterial({ map: new Texture() }) }])).toBeNull();
  });

  it('draws a far piece of a wall as its band in one mesh with the others, hidden from the LOS cube', async () => {
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 2000, heights: new Float32Array(4) }, 2000, 2000);
    const los = new Group();
    const layer = new MapObjectLayer(field, library(), los);
    const at = (id: string, x: number): MapObject => ({ id, asset: 'wall', x, y: 0, z: 0, rotation: 0, scale: 1, line: 'l1' });
    await layer.setObjects([at('a', 0), at('b', 4), at('c', 900)]);
    const camera = new PerspectiveCamera(60);
    camera.position.set(0, 2, 0);
    camera.updateMatrixWorld();
    layer.update(0.016, camera);
    const mesh = (name: string) => los.children.find((c): c is InstancedMesh => c instanceof InstancedMesh && c.name === name);
    // The near two their model, the one 900 m off its band (past 623 m)
    expect(mesh('wall')!.count).toBe(2);
    const bands = mesh('line-bands')!;
    expect(bands.count).toBe(1);
    expect(bands.geometry.index!.count / 3).toBe(6);
    expect(bands.userData['losTransparent']).toBe(true);
    // Its row: the catalogue's rectangle, the model's height
    const shader = { uniforms: {} as Record<string, { value: { image: { data: Float32Array } } }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
    (bands.material as MeshStandardMaterial).onBeforeCompile(shader as never, undefined as never);
    const row = [...shader.uniforms['uBandParams'].value.image.data.subarray(0, 8)];
    expect(row.slice(0, 6).map((v) => Math.round(v * 100) / 100)).toEqual([0, 0, 1.9, 0.3, 0, 1]);
    layer.dispose();
  });
});
