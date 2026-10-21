import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../map-document';
import { pixelDistance, type AssetCatalog, type CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { MapObjectLayer } from './object-layer';

const asset = (id: string, category: CatalogObject['category'], footprint: number, height: number, more: Partial<CatalogObject> = {}): CatalogObject => ({
  id, name: id, category, file: `${id}.glb`, footprint, height, blocksLos: false, blocksBuild: true, scaleRange: [1, 1], randomRotation: false, wind: 0, ...more,
});

/**
 * A stone of 0.5 m radius (1.5 px at 312 m, 3 px at 156 m), a fence piece of 1 m (1.5 px at 624 m) and a hut of
 * 0.6 m that blocks sight, with a far model from 20 m
 */
const catalog: AssetCatalog = {
  version: 1,
  materials: [],
  objects: [
    asset('stone', 'prop', 0.5, 0.5),
    asset('fence', 'wall', 1, 1),
    asset('hut', 'building', 0.6, 1, { blocksLos: true, lod: [{ file: 'hut-far.glb', screen: 0.6 / (20 * Math.tan(Math.PI / 6)) }] }),
  ],
};

function library(): MapAssetLibrary {
  return new MapAssetLibrary('base/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    loadModel: (url) => {
      const root = new Group();
      // As high as the catalogue says: the bounding radius is the footprint
      const h = url.includes('stone') ? 0.5 : 1;
      // The hut's far model a single box, its full model two (a roof on it)
      root.add(new Mesh(new BoxGeometry(1, h, 1).translate(0, h / 2, 0), new MeshStandardMaterial()));
      if (url.includes('hut') && !url.includes('far')) root.add(new Mesh(new BoxGeometry(1, 0.3, 1).translate(0, h + 0.15, 0), new MeshStandardMaterial({ color: 0xff0000 })));
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
    const line = Array.from({ length: 30 }, (_, k) => at(`f${k}`, 'fence', k * 10, 0, { line: 'g' }));
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
    // Out of its line a piece is alone again; in a long line it shows from afar
    expect(layer.updateObjects([{ ...line[0], x: 0, line: undefined }])).toEqual([]);
    await layer.addObjects([at('f40', 'fence', 400, 0, { line: 'h' }), at('f41', 'fence', 600, 0, { line: 'h' })]);
    look(-901);
    expect(shown(layer.group, 'fence-decor')).toBe(2);
    layer.dispose();
  });

  it('hands the LOS cube every blocker within its reach at its full model, whatever the camera and the level', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los);
    // Huts at 0, 10 and 30 m along map x, one 900 m off
    await layer.setObjects([at('h0', 'hut', 0), at('h1', 'hut', 10), at('h2', 'hut', 30), at('h3', 'hut', 900)]);
    const stage = los.children.find((c) => c.userData['losOnly'])!;
    const look = viewer(layer);
    /** What the cube draws for a tip over map x 5 reaching 20 m: per mesh its instances' positions */
    const cube = () => {
      (stage.userData['losPrepare'] as (tip: Vector3, far: number, warmUp: boolean) => void)(new Vector3(-5, 2, 0), 20, false);
      return stage.children
        .filter((c): c is InstancedMesh => c instanceof InstancedMesh)
        .map((m) => [m.name, [...m.instanceMatrix.array.subarray(0, m.count * 16)].filter((_, k) => k % 16 === 12)] as const);
    };
    // Near: the huts take their full model; 2 km off they are under the pixel limit, the camera draws none
    look(5);
    expect(shown(los, 'hut')).toBe(3);
    const near = cube();
    look(-2000);
    expect(shown(los, 'hut') + shown(los, 'hut-lod1')).toBe(0);
    expect(cube()).toEqual(near);
    // Low quality changes nothing either; the cube draws h0 and h1 (h2's bounds end 25 m off) with the full model, both
    // its boxes (merged into one draw), not the far model's one
    layer.setDetail({ lodBias: 0.5, impostorFrom: 200, drawPixels: 3 });
    expect(cube()).toEqual(near);
    expect(near.map(([name, xs]) => [name, xs.map((x) => -x).sort((a, b) => a - b)])).toEqual([['hut-los', [0, 10]]]);
    const drawnBy = stage.children[0] as InstancedMesh;
    expect(drawnBy.geometry.getIndex()!.count / 3).toBe(24);
    // The levels the camera chose stay out of the cube
    for (const m of los.children) if (m instanceof InstancedMesh) expect(m.userData['losTransparent']).toBe(true);
    layer.dispose();
  });
});
