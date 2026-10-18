import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, PlaneGeometry, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MASS_ASSET, type MapMass, type MapObject } from '../../map-document';
import { massArea, massContains } from '../../object-mass';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { massShape } from './mass-layer';
import { MapObjectLayer } from './object-layer';

const court: MapMass = {
  rings: [
    [-20, -15, 20, -15, 20, 15, -20, 15],
    [-10, -5, -10, 5, 10, 5, 10, -5],
  ],
  height: 12,
  floors: 4,
  roof: 'flat',
  facade: 'plaster',
};

const entry = (id: string, category: CatalogObject['category'], file: string): CatalogObject => ({
  id,
  name: id,
  category,
  file,
  footprint: 1,
  height: 4,
  blocksLos: true,
  blocksBuild: true,
  scaleRange: [1, 1],
  randomRotation: false,
  wind: 0,
  drawDistance: 3000,
});

const catalog: AssetCatalog = { version: 1, materials: [], objects: [entry(MASS_ASSET, 'building', 'kit.glb'), entry('box', 'building', 'box.glb')] };

/** The kit: one square per surface as wide as its texture's repeat; a box for the other asset */
function library(): MapAssetLibrary {
  return new MapAssetLibrary('base/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    loadModel: (url) => {
      const root = new Group();
      if (url.includes('kit')) {
        for (const [name, metres] of [['mass-plaster', 3], ['mass-plinth', 2], ['mass-roof-flat', 3], ['mass-roof-red', 2.5]] as const) {
          const material = new MeshStandardMaterial();
          material.name = name;
          root.add(new Mesh(new PlaneGeometry(metres, metres), material));
        }
      } else {
        root.add(new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial()));
      }
      return Promise.resolve(root);
    },
  });
}

describe('mass layer: the shape of a raised building', () => {
  it('walls every ring facing off the building, a parapet round the roof, the roof over the ground less the courtyard', () => {
    const shape = massShape(court);
    const facades = shape.walls.filter((w) => w.kind === 0);
    expect(facades.length).toBe(8);
    // The parapet's inside and its coping on every side
    expect(shape.walls.length).toBe(16);
    expect(shape.caps.length).toBe(8);
    for (const w of facades) {
      const mx = w.sx + (w.ax * w.length) / 2;
      const mz = w.sz + (w.az * w.length) / 2;
      expect(massContains(court, mx + w.nx * 0.2, mz + w.nz * 0.2)).toBe(false);
      expect(massContains(court, mx - w.nx * 0.2, mz - w.nz * 0.2)).toBe(true);
      // along x up = (-az, 0, ax) is the normal: the unit quad faces out
      expect(-w.az).toBeCloseTo(w.nx);
      expect(w.ax).toBeCloseTo(w.nz);
    }
    let roof = 0;
    for (const t of shape.roof) {
      const [ax, , az, bx, , bz, cx, , cz] = t.p;
      roof += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    }
    expect(roof).toBeCloseTo(massArea(court));
    expect(shape.covering).toBe('flat');
  });

  it('raises a mansard: walls to the eaves, two triangles of slope per wall, the top over the drawn-in outline', () => {
    const l: MapMass = { rings: [[0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30]], height: 6, floors: 2, roof: 'mansard', ridge: 3, facade: 'timber' };
    const shape = massShape(l);
    expect(shape.walls.length).toBe(6);
    expect(shape.caps.length).toBe(0);
    expect(shape.roof.length).toBe(12 + 4);
    expect(Math.max(...shape.roof.flatMap((t) => [t.p[1], t.p[4], t.p[7]]))).toBeCloseTo(9);
    expect(shape.covering).not.toBe('flat');
  });

  it('gives a rectangle under a gable roof two gables, under a hip roof none', () => {
    const rect = [-6, -4, 6, -4, 6, 4, -6, 4];
    const gable = massShape({ rings: [rect], height: 6, floors: 2, roof: 'gable', ridge: 3, facade: 'plaster' });
    expect(gable.walls.filter((w) => w.kind === 2).length).toBe(2);
    expect(gable.roof.length).toBe(4);
    expect(gable.caps.length).toBe(0);
    const hip = massShape({ rings: [rect], height: 6, floors: 2, roof: 'hip', ridge: 3, facade: 'plaster' });
    expect(hip.walls.filter((w) => w.kind === 2).length).toBe(0);
    expect(hip.roof.length).toBe(6);
    // The ridge on top
    expect(Math.max(...hip.roof.flatMap((t) => [t.p[1], t.p[4], t.p[7]]))).toBeCloseTo(9);
  });
});

describe('mass layer in the object layer', () => {
  it('draws raised buildings in a few instanced meshes in the LOS group, picks them, and takes them out again', async () => {
    const heights = new Float32Array(4);
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights }, 1000, 1000);
    const los = new Group();
    const layer = new MapObjectLayer(field, library(), los);
    const objects: MapObject[] = [
      { id: 'm1', asset: MASS_ASSET, x: 0, y: 0, z: 0, rotation: 0.3, scale: 1, mass: court },
      { id: 'm2', asset: MASS_ASSET, x: 100, y: 0, z: 0, rotation: 0, scale: 1, mass: court, tint: '#e9d6c2' },
      { id: 'b1', asset: 'box', x: -100, y: 0, z: 0, rotation: 0, scale: 1 },
    ];
    const before = layer.version;
    await layer.setObjects(objects);
    expect(layer.version).toBeGreaterThan(before);
    const meshes: InstancedMesh[] = [];
    los.traverse((o) => o instanceof InstancedMesh && o.material && (o.material as MeshStandardMaterial).name?.startsWith('mass-') && meshes.push(o));
    // Walls of one facade, the flat roofs and the copings: three meshes for both buildings
    expect(meshes.length).toBe(3);
    expect(meshes.reduce((s, m) => s + m.count, 0)).toBe(2 * (16 + massShape(court).roof.length + 8));
    // A ray down onto the wing of the second building hits it; one into its courtyard does not
    const wing = layer.raycast(new Ray(new Vector3(-100, 50, 10), new Vector3(0, -1, 0)));
    expect(wing?.object.id).toBe('m2');
    const yard = layer.raycast(new Ray(new Vector3(-100, 50, 0), new Vector3(0, -1, 0)));
    expect(yard?.object.id ?? null).toBeNull();
    // The ground rises 3 m: the buildings go up with it, nothing built anew
    const y0 = meshes[0].instanceMatrix.array[13];
    heights.fill(3);
    layer.refreshHeights();
    expect(meshes[0].instanceMatrix.array[13]).toBeCloseTo(y0 + 3);
    expect(meshes[0].parent).toBe(los);
    // Changed in place: out and in again (the mass layer writes all anew)
    expect(layer.updateObjects([{ ...objects[1], x: 120 }]).map((o) => o.id)).toEqual(['m2']);
    layer.removeObjects(['m1', 'm2']);
    await Promise.resolve();
    const left: InstancedMesh[] = [];
    los.traverse((o) => o instanceof InstancedMesh && (o.material as MeshStandardMaterial).name?.startsWith('mass-') && left.push(o));
    expect(left.length).toBe(0);
    layer.dispose();
  });
});
