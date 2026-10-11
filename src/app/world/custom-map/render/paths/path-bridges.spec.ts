import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapPaths } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { BridgeLayer } from './path-bridges';

const piece = (id: string): CatalogObject => ({
  id,
  name: id,
  category: 'prop',
  file: `${id}.glb`,
  footprint: 2,
  height: 1,
  blocksLos: false,
  blocksBuild: false,
  scaleRange: [1, 1],
  randomRotation: false,
  wind: 0,
  drawDistance: 1000,
});

describe('BridgeLayer', () => {
  it('builds each style from its own deck piece, missing pieces from the wooden one', async () => {
    const catalog: AssetCatalog = { version: 1, materials: [], objects: [piece('bridge-deck'), piece('bridge-deck-stone')] };
    const loaded: string[] = [];
    const lib = new MapAssetLibrary('base/', {
      fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
      loadModel: (url) => {
        loaded.push(url);
        const root = new Group();
        root.add(new Mesh(new BoxGeometry(4, 1, 1), new MeshStandardMaterial()));
        return Promise.resolve(root);
      },
    });
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 200, heights: new Float32Array(4) }, 200, 200);
    const layer = new BridgeLayer(field, lib);
    const paths: MapPaths = {
      nodes: [
        { id: 'a', x: -40, y: 0 },
        { id: 'b', x: -24, y: 0 },
        { id: 'c', x: 0, y: 0 },
        { id: 'd', x: 16, y: 0 },
      ],
      edges: [
        { id: 'wood', a: 'a', b: 'b', width: 4, kind: 'bridge' },
        { id: 'stone', a: 'b', b: 'c', width: 4, kind: 'bridge', style: 'stone' },
        { id: 'lava', a: 'c', b: 'd', width: 4, kind: 'bridge', style: 'lava' },
      ],
    };
    await layer.set(paths, null);
    const meshes = layer.group.children as InstancedMesh[];
    expect(meshes).toHaveLength(2);
    // 16 m wood and 16 m lava (no lava piece: wood) in 4 m pieces, 24 m stone
    expect(meshes.map((m) => m.count).sort()).toEqual([6, 8]);
    expect(loaded.some((u) => u.includes('bridge-deck-stone'))).toBe(true);
    layer.dispose();
  });
});
