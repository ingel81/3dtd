import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { hasBand } from './line-bands';
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
  band: { top: [0.8, 0.4, 0.2], side: [0.6, 0.3, 0.1] },
};
/** A chain-link fence of the same size: no LOD model, a quarter of its side covered */
const fence: CatalogObject = { ...wall, id: 'fence', file: 'fence.glb', lod: undefined, band: { top: [0.4, 0.4, 0.4], side: [0.5, 0.5, 0.5], cover: 0.25 } };
const catalog: AssetCatalog = { version: 1, materials: [], objects: [wall, fence] };

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

interface Shader {
  uniforms: Record<string, { value: { image: { data: Float32Array } } }>;
  vertexShader: string;
  fragmentShader: string;
}

/** A material's shader after its onBeforeCompile, on the chunks the band replaces */
function compile(material: MeshStandardMaterial): Shader {
  const shader: Shader = {
    uniforms: {},
    vertexShader: '#include <common>\n#include <begin_vertex>',
    fragmentShader: '#include <common>\n#include <clipping_planes_fragment>\n#include <color_fragment>',
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

/** The rows of the bands' data texture */
function rowsOf(bands: InstancedMesh): Float32Array {
  return compile(bands.material as MeshStandardMaterial).uniforms['uBandParams'].value.image.data;
}

describe('line bands', () => {
  it('takes an asset a band when it is a wall or structure with a ground rectangle and measured band colours', () => {
    expect(hasBand(wall)).toBe(true);
    expect(hasBand(fence)).toBe(true);
    expect(hasBand({ ...wall, box: undefined })).toBe(false);
    expect(hasBand({ ...wall, band: undefined })).toBe(false);
    expect(hasBand({ ...wall, category: 'prop' })).toBe(false);
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
    // Its row: the catalogue's rectangle, the model's height, whole cover, the band's colours times the LOD model's tone
    const row = [...rowsOf(bands).subarray(0, 16)].map((v) => Math.round(v * 100) / 100);
    expect(row).toEqual([0, 0, 1.9, 0.3, 0, 1, 1, 0, 0.4, 0.4, 0.2, 0, 0.3, 0.3, 0.1, 0]);
    layer.dispose();
  });

  it('takes a piece without a LOD model from its full model to its band, its side cover in the row', async () => {
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 2000, heights: new Float32Array(4) }, 2000, 2000);
    const los = new Group();
    const layer = new MapObjectLayer(field, library(), los);
    const at = (id: string, x: number): MapObject => ({ id, asset: 'fence', x, y: 0, z: 0, rotation: 0, scale: 1, line: 'l1' });
    await layer.setObjects([at('a', 0), at('c', 900)]);
    const camera = new PerspectiveCamera(60);
    camera.position.set(0, 2, 0);
    camera.updateMatrixWorld();
    layer.update(0.016, camera);
    const mesh = (name: string) => los.children.find((c): c is InstancedMesh => c instanceof InstancedMesh && c.name === name);
    expect(mesh('fence')!.count).toBe(1);
    const bands = mesh('line-bands')!;
    expect(bands.count).toBe(1);
    // No tone without a LOD model; a quarter of the side's pixels
    const row = [...rowsOf(bands).subarray(0, 16)].map((v) => Math.round(v * 100) / 100);
    expect(row).toEqual([0, 0, 1.9, 0.3, 0, 1, 0.25, 0, 0.4, 0.4, 0.4, 0, 0.5, 0.5, 0.5, 0]);
    // The cover drops pixels in the band's material and in its shadow
    expect(compile(bands.material as MeshStandardMaterial).fragmentShader).toContain('>= vBandCover) discard');
    expect(compile(bands.customDepthMaterial as MeshStandardMaterial).fragmentShader).toContain('>= vBandCover) discard');
    layer.dispose();
  });
});
