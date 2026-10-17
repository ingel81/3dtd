import { DataTexture } from 'three';
import type { MapPaths } from '../../map-document';
import { HeightField } from '../height-field';
import type { MapAssetLibrary, MaterialPixels } from '../map-asset-library';
import { HeightTexture } from '../terrain/height-texture';
import { RoadSurfaceLayer } from './road-surface';

function library(): { lib: MapAssetLibrary; loads: string[] } {
  const loads: string[] = [];
  const pixels = (id: string): MaterialPixels => ({ id, size: 4, color: new Uint8Array(64), data: new Uint8Array(64), average: [0.3, 0.3, 0.3] }) as MaterialPixels;
  const lib = {
    materialTextures: async (id: string) => {
      loads.push(id);
      return pixels(id);
    },
    material: async (id: string) => pixels(id),
    catalog: async () => ({ materials: [], objects: [], version: 1 }),
  } as unknown as MapAssetLibrary;
  return { lib, loads };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('road surface textures', () => {
  it('loads its surfaces once while the library and the surfaces stay the same', async () => {
    const n = 33;
    const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights: new Float32Array(n * n) }, 64, 64);
    const layer = new RoadSurfaceLayer(field, new HeightTexture(field), new DataTexture());
    const paths: MapPaths = {
      nodes: [{ id: 'a', x: -20, y: 0 }, { id: 'b', x: 20, y: 0 }],
      edges: [{ id: 'e', a: 'a', b: 'b', width: 6, kind: 'road', surface: 'asphalt' }],
    };
    const { lib, loads } = library();
    layer.set(paths);
    layer.setAssets(lib, 4);
    await flush();
    // The terrain's materials built again (a layer added), the paths handed again
    layer.setAssets(lib, 4);
    layer.set(paths);
    await flush();
    expect(loads).toEqual(['asphalt']);
    // A new surface joins at the end: loaded with the old ones in their places
    layer.set({ ...paths, edges: [...paths.edges, { id: 'f', a: 'b', b: 'a', width: 3, kind: 'path', surface: 'sidewalk', via: [{ x: 0, y: 10 }] }] });
    await flush();
    expect(loads).toEqual(['asphalt', 'asphalt', 'sidewalk']);
    layer.dispose();
  });
});
