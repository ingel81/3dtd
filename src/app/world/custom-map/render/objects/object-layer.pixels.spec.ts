import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../map-document';
import { pixelDistance, type AssetCatalog, type CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { MapObjectLayer } from './object-layer';

const asset = (id: string, category: CatalogObject['category'], footprint: number, height: number): CatalogObject => ({
  id, name: id, category, file: `${id}.glb`, footprint, height, blocksLos: false, blocksBuild: true, scaleRange: [1, 1], randomRotation: false, wind: 0,
});

/** A stone of 0.5 m radius (1.5 px at 312 m, 3 px at 156 m) and a fence piece of 1 m (1.5 px at 624 m) */
const catalog: AssetCatalog = { version: 1, materials: [], objects: [asset('stone', 'prop', 0.5, 0.5), asset('fence', 'wall', 1, 1)] };

function library(): MapAssetLibrary {
  return new MapAssetLibrary('base/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    loadModel: (url) => {
      const root = new Group();
      // As high as the catalogue says: the bounding radius is the footprint
      const h = url.includes('stone') ? 0.5 : 1;
      root.add(new Mesh(new BoxGeometry(1, h, 1).translate(0, h / 2, 0), new MeshStandardMaterial()));
      return Promise.resolve(root);
    },
  });
}

const field = (): HeightField => new HeightField({ columns: 2, rows: 2, cellSize: 2000, heights: new Float32Array(4) }, 2000, 2000);
const at = (id: string, a: string, x: number, y = 0, more: Partial<MapObject> = {}): MapObject => ({ id, asset: a, x, y, z: 0, rotation: 0, scale: 1, ...more });
const shown = (g: Group, name: string): number =>
  g.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh && c.name === name && c.visible).reduce((n, m) => n + m.count, 0);
/** A camera 1 m up over map x (scene x is minus map x), 60 degrees */
function viewer(layer: MapObjectLayer): (x: number) => void {
  const camera = new PerspectiveCamera(60);
  return (x) => {
    camera.position.set(-x, 1, 0);
    camera.updateMatrixWorld();
    layer.update(0.016, camera);
  };
}

describe('MapObjectLayer pixel limit', () => {
  it('draws an object while its radius on screen stays above the level’s pixel limit, sight blockers at High’s', async () => {
    expect(pixelDistance(0.5, 1.5)).toBeCloseTo(312, 0);
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    await layer.setObjects([at('s1', 'stone', 0), at('s2', 'stone', 150), at('b1', 'stone', 0, 5, { blocksLos: true })]);
    const look = viewer(layer);
    // 200 m from the first and the blocker: within 312 m (and its band, 293 to 330 m); 350 m from the second
    look(-200);
    expect(shown(layer.group, 'stone-decor')).toBe(1);
    expect(shown(los, 'stone')).toBe(1);
    // From the other side the second is in, the first and the blocker 400 m off
    look(400);
    expect(shown(layer.group, 'stone-decor')).toBe(1);
    expect(shown(los, 'stone')).toBe(0);
    // Low (3 px, 156 m) takes the first away at 200 m; the blocker keeps High's
    look(-200);
    layer.setDetail({ lodBias: 0.5, impostorFrom: 200, drawPixels: 3 });
    expect(shown(layer.group, 'stone-decor')).toBe(0);
    expect(shown(los, 'stone')).toBe(1);
    layer.dispose();
  });

  it('draws the pieces of a line as long as the whole line, a piece alone by its own size', async () => {
    const layer = new MapObjectLayer(field(), library(), new Group());
    // A fence of 30 pieces along map x over 290 m, one piece alone beside it
    const line = Array.from({ length: 30 }, (_, k) => at(`f${k}`, 'fence', k * 10, 0, { group: 'g' }));
    await layer.setObjects([...line, at('lone', 'fence', 0, 20)]);
    const look = viewer(layer);
    // 900 m off: past the lone piece's 624 m, the line's pieces stay
    look(-900);
    expect(shown(layer.group, 'fence-decor')).toBe(30);
    // The line taken down to two pieces 10 m apart (a radius of 6 m, 3.7 km) and then to one: it goes as a piece alone
    layer.removeObjects(line.slice(2).map((o) => o.id));
    look(-901);
    expect(shown(layer.group, 'fence-decor')).toBe(2);
    layer.removeObjects(['f1']);
    look(-900);
    expect(shown(layer.group, 'fence-decor')).toBe(0);
    // Out of its group a piece is alone again; back in a long line it shows from afar
    expect(layer.updateObjects([{ ...line[0], x: 0, group: undefined }])).toEqual([]);
    await layer.addObjects([at('f40', 'fence', 400, 0, { group: 'h' }), at('f41', 'fence', 600, 0, { group: 'h' })]);
    look(-901);
    expect(shown(layer.group, 'fence-decor')).toBe(2);
    layer.dispose();
  });
});
