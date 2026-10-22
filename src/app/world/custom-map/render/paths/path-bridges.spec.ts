import { describe, expect, it } from 'vitest';
import type { MapPaths, MapTerrain } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import type { LaidObject, MapObjectLayer } from '../objects/object-layer';
import { BridgeLayer } from './path-bridges';

/** An object layer that keeps what is laid in it */
function layerOfPieces(): { objects: MapObjectLayer; pieces: () => LaidObject[] } {
  let laid: LaidObject[] = [];
  const objects = { setLaid: (_key: string, pieces: LaidObject[]) => ((laid = pieces), Promise.resolve()) } as unknown as MapObjectLayer;
  return { objects, pieces: () => laid };
}

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
});

describe('BridgeLayer', () => {
  it('builds each style from its own deck piece, missing pieces from the wooden one', async () => {
    const catalog: AssetCatalog = { version: 1, materials: [], objects: [piece('bridge-deck'), piece('bridge-deck-stone')] };
    const lib = new MapAssetLibrary('base/', {
      fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    });
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 200, heights: new Float32Array(4) }, 200, 200);
    const { objects, pieces } = layerOfPieces();
    const layer = new BridgeLayer(field, lib, objects);
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
    await layer.set(paths, { water: null } as MapTerrain);
    const count = (asset: string) => pieces().filter((p) => p.asset === asset).length;
    // 16 m wood and 16 m lava (no lava piece: wood) in 4 m pieces, 24 m stone
    expect(count('bridge-deck')).toBe(8);
    expect(count('bridge-deck-stone')).toBe(6);
    // Each bridge a line of its own, each piece as wide as its edge and as long as its share of it
    expect(new Set(pieces().map((p) => p.line))).toEqual(new Set(['bridge:wood', 'bridge:stone', 'bridge:lava']));
    expect(pieces().every((p) => p.breadth === 4 && p.stretch === 1)).toBe(true);
    layer.dispose();
  });

  it('raises a deck over the water it crosses only', async () => {
    const catalog: AssetCatalog = { version: 1, materials: [], objects: [piece('bridge-deck')] };
    const lib = new MapAssetLibrary('base/', {
      fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    });
    // 200 m, 2 m cells, flat at 0
    const n = 101;
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights: new Float32Array(n * n) }, 200, 200);
    const paths: MapPaths = {
      nodes: [
        { id: 'a', x: -8, y: 0 },
        { id: 'b', x: 8, y: 0 },
      ],
      edges: [{ id: 'e', a: 'a', b: 'b', width: 4, kind: 'bridge' }],
    };
    const lowest = async (terrain: MapTerrain): Promise<number> => {
      const { objects, pieces } = layerOfPieces();
      const layer = new BridgeLayer(field, lib, objects);
      await layer.set(paths, terrain);
      layer.dispose();
      return Math.min(...pieces().map((p) => p.at));
    };
    // A lake at 20 m in a far corner leaves the deck on the ground; one under the bridge lifts it
    const far = new Uint8Array(n * n);
    for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) far[j * n + i] = 255;
    const under = new Uint8Array(n * n);
    for (let j = 45; j <= 55; j++) for (let i = 45; i <= 55; i++) under[j * n + i] = 255;
    expect(await lowest({ water: { level: 20, mask: far, color: '' } } as MapTerrain)).toBeLessThan(2);
    expect(await lowest({ water: null, waterBodies: [{ level: 20, mask: under, color: '' }] } as MapTerrain)).toBeGreaterThanOrEqual(21);
  });
});
