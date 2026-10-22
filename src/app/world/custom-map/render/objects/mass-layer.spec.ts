import { BoxGeometry, Color, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, PlaneGeometry, Ray, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { MASS_ASSET, type MapMass, type MapObject } from '../../map-document';
import { massArea, massBodies, massContains } from '../../object-mass';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { basementBodies, cellarBody, MassLayer, massShape } from './mass-layer';
import { FELL_LONG_AGO } from './ruin-damage';
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
});

const catalog: AssetCatalog = { version: 1, materials: [], objects: [entry(MASS_ASSET, 'building', 'kit.glb'), entry('box', 'building', 'box.glb'), { ...entry('house', 'building', 'box.glb'), box: [0, 0.5, 4, 3] }] };

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

  it('reaches a building on a basement down to its seat, and walls a catalogue model\'s basement round its wall box', () => {
    const [body] = basementBodies(massBodies(court), 3);
    const walls = massShape(body).walls.filter((w) => w.kind === 0);
    expect(walls.every((w) => w.bottom === -1.5 - 3)).toBe(true);
    // Without one as it was
    expect(massShape(massBodies(court)[0]).walls.filter((w) => w.kind === 0).every((w) => w.bottom === -1.5)).toBe(true);
    const cellar = massShape(cellarBody([0, 0.5, 4, 3], 2.5));
    expect(cellar.walls.length).toBe(4);
    expect(cellar.roof).toEqual([]);
    expect(cellar.caps).toEqual([]);
    for (const w of cellar.walls) {
      expect(w.bottom).toBe(-1.5 - 2.5);
      expect(w.top).toBeGreaterThan(0);
      expect(w.top).toBeLessThan(0.5);
    }
    // A little past the box on each side, over the model's own foundation
    expect(cellar.walls.map((w) => w.length).sort((p, q) => p - q)).toEqual([6.2, 6.2, 8.2, 8.2].map((v) => expect.closeTo(v, 5)));
  });

  it('raises a mansard: walls to the eaves, steep slopes from past them, the top flat', () => {
    const l: MapMass = { rings: [[0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30]], height: 6, floors: 2, roof: 'mansard', ridge: 3, facade: 'timber' };
    const shape = massShape(l);
    expect(shape.walls.length).toBe(6);
    expect(shape.caps.length).toBe(0);
    const ys = shape.roof.flatMap((t) => [t.p[1], t.p[4], t.p[7]]);
    expect(Math.max(...ys)).toBeCloseTo(9);
    // The eaves a little under the walls' top, past them
    expect(Math.min(...ys)).toBeLessThan(6);
    expect(Math.min(...ys)).toBeGreaterThan(4);
    expect(shape.roof.filter((t) => [t.p[1], t.p[4], t.p[7]].every((y) => Math.abs(y - 9) < 1e-6)).length).toBeGreaterThan(0);
    expect(shape.covering).not.toBe('flat');
  });

  it('runs a gable along each wing of an L: two gables at the wings\' ends, the valley at the inner corner', () => {
    const l: MapMass = { rings: [[0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30]], height: 6, floors: 2, roof: 'gable', ridge: 4, facade: 'plaster' };
    const shape = massShape(l);
    const gables = shape.walls.filter((w) => w.kind === 2);
    expect(gables.length).toBe(2);
    // Each stands on a wing's end, its top in the middle of it
    for (const g of gables) {
      expect(g.length).toBeCloseTo(10);
      expect(g.apex).toBeCloseTo(0.5);
      expect(g.top - g.bottom).toBeCloseTo(4);
    }
    const ys = shape.roof.flatMap((t) => [t.p[1], t.p[4], t.p[7]]);
    expect(Math.max(...ys)).toBeCloseTo(10);
    // A half-hip: the gables up to the cut, a small hip over each
    const half = massShape({ ...l, roof: 'halfhip' });
    expect(half.walls.filter((w) => w.kind === 2).length).toBe(4);
    expect(half.walls.filter((w) => w.kind === 1).length).toBe(2);
    expect(half.roof.length).toBeGreaterThan(shape.roof.length);
  });

  it('slopes a skillion over the outline, its side walls up to the slope', () => {
    const lean: MapMass = { rings: [[-6, -4, 6, -4, 6, 4, -6, 4]], height: 5, floors: 1, roof: 'skillion', ridge: 2, facade: 'plaster', roofDirection: Math.PI / 2 };
    const shape = massShape(lean);
    // Down towards +z: the side walls (along z) end in a triangle, the high wall reaches up to the slope
    const triangles = shape.walls.filter((w) => w.kind === 2);
    expect(triangles.length).toBe(2);
    for (const t of triangles) expect([0, 1]).toContain(t.apex);
    expect(Math.max(...shape.walls.map((w) => w.top))).toBeCloseTo(7);
    expect(shape.roof.length).toBe(2);
  });

  it('gives a rectangle under a gable roof two gables, under a hip roof none', () => {
    const rect = [-6, -4, 6, -4, 6, 4, -6, 4];
    const gable = massShape({ rings: [rect], height: 6, floors: 2, roof: 'gable', ridge: 3, facade: 'plaster' });
    expect(gable.walls.filter((w) => w.kind === 2).length).toBe(2);
    expect(gable.roof.length).toBe(4);
    expect(gable.caps.length).toBe(0);
    const hip = massShape({ rings: [rect], height: 6, floors: 2, roof: 'hip', ridge: 3, facade: 'plaster' });
    expect(hip.walls.filter((w) => w.kind === 2).length).toBe(0);
    // A shop's walls: their own kind, on every roof
    for (const roof of ['flat', 'gable', 'mansard'] as const) {
      const shop = massShape({ rings: [rect], height: 9, floors: 3, roof, ridge: roof === 'flat' ? undefined : 3, facade: 'plaster', shop: [1] });
      expect(shop.walls.filter((w) => w.kind === 3).length).toBe(1);
    }
    expect(hip.roof.length).toBe(6);
    // The ridge on top
    expect(Math.max(...hip.roof.flatMap((t) => [t.p[1], t.p[4], t.p[7]]))).toBeCloseTo(9);
  });
});

describe('mass layer: a building of parts (E297 L3)', () => {
  /** A hall under a gable, a tower at its end, a helm on the tower from 24 m */
  const church: MapMass = {
    rings: [[-15, -5, 15, -5, 15, 5, -15, 5]],
    height: 24,
    floors: 1,
    roof: 'flat',
    facade: 'plaster',
    roofCover: 'tiles',
    parts: [
      { rings: [[-15, -5, 9, -5, 9, 5, -15, 5]], height: 12, floors: 3, roof: 'gable', ridge: 6 },
      { rings: [[9, -3, 15, -3, 15, 3, 9, 3]], height: 24.9, floors: 6, roof: 'flat', tint: '#c65843' },
      { rings: [[9, -3, 15, -3, 15, 3, 9, 3]], base: 24, height: 26, floors: 7, roof: 'pyramid', ridge: 14 },
    ],
  };

  it('raises each part from its own floor: the walls of the helm start on the tower, its slopes meet over its middle', () => {
    const [hall, tower, helm] = massBodies(church).map((b) => massShape(b));
    expect(hall.roof.length).toBe(4);
    expect(tower.covering).toBe('flat');
    expect(helm.walls.length).toBe(4);
    for (const w of helm.walls) {
      expect(w.bottom).toBe(24);
      // The storeys counted from the seat: the helm's windows in line with the tower's
      expect(w.lift).toBe(-24);
    }
    expect(helm.roof.length).toBe(4);
    for (const t of helm.roof) expect([t.p[6], t.p[7], t.p[8]]).toEqual([12, 40, 0]);
    expect(helm.covering).toBe('red');
    // On the ground the foundation below the seat as before
    expect(hall.walls[0].bottom).toBeLessThan(0);
  });

  it('draws all parts as one building, with their own colours, and lets them fall with it', async () => {
    const heights = new Float32Array(4);
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights }, 1000, 1000);
    const los = new Group();
    const layer = new MassLayer(field, library(), los, () => null, () => undefined, { ruins: true });
    await layer.setObjects([
      { id: 'c1', asset: MASS_ASSET, x: 0, y: 0, z: 0, rotation: 0.4, scale: 1, mass: church, tint: '#f4f2ee' },
      { id: 'm1', asset: MASS_ASSET, x: 100, y: 0, z: 0, rotation: 0, scale: 1, mass: court },
    ]);
    const shown = () => {
      const meshes: InstancedMesh[] = [];
      los.traverse((o) => o instanceof InstancedMesh && o.visible && meshes.push(o));
      return meshes;
    };
    const pieces = massBodies(church).reduce((s, b) => s + massShape(b).walls.length + massShape(b).roof.length + massShape(b).caps.length, 0);
    const intact = shown().filter((m) => (m.material as MeshStandardMaterial).side !== DoubleSide);
    // Walls of one facade, flat roofs, tiled roofs, copings: for both buildings, no mesh per part
    expect(intact.length).toBe(4);
    /** Instances that stand (a damaged building's shrink to nothing) */
    const standing = (m: InstancedMesh) => {
      let n = 0;
      const e = new Matrix4();
      for (let i = 0; i < m.count; i++) if (m.getMatrixAt(i, e).elements.some((v) => v !== 0)) n++;
      return n;
    };
    const courtPieces = 16 + massShape(court).roof.length + 8;
    expect(intact.reduce((s, m) => s + standing(m), 0)).toBe(pieces + courtPieces);
    // The tower's own colour on its walls, the building's on the hall's
    const walls = intact.find((m) => m.geometry.getAttribute('aWall'))!;
    const colours = new Set<string>();
    const c = new Color();
    for (let i = 0; i < walls.count; i++) colours.add(walls.getColorAt(i, c).getHexString());
    expect(colours.size).toBeGreaterThanOrEqual(3);
    // Destroyed: every part leaves the intact batches for the ruins', the other building stays
    layer.setDamage([{ id: 'c1', stage: 3, fallStart: FELL_LONG_AGO }]);
    expect(intact.reduce((s, m) => s + standing(m), 0)).toBe(courtPieces);
    // Its ruin: all its parts' pieces (walls split at the break line), as high as its helm
    const ruins = shown().filter((m) => (m.material as MeshStandardMaterial).side === DoubleSide);
    expect(ruins.reduce((s, m) => s + m.count, 0)).toBeGreaterThanOrEqual(pieces);
    expect(layer.ruinShapeOf('c1')).not.toBeNull();
    layer.dispose();
  });
});

describe('mass layer: ways through a building (E297)', () => {
  /** The courtyard block with an arched gateway through its south wing into the courtyard, and a car park's entrance in the north */
  const gated: MapMass = {
    ...court,
    facade: 'plaster',
    openings: [
      { line: [0, -16, 0, -4], width: 4, height: 5, kind: 'passage', head: 'arch' },
      { line: [12, 16, 12, 13], width: 4, height: 0.2, kind: 'garage', head: 'flat', floor: -2.2 },
    ],
  };

  it('draws the openings with the building, in no mesh more; the pieces of a wall keep its metres, its insides their shade', async () => {
    const heights = new Float32Array(4);
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights }, 1000, 1000);
    const los = new Group();
    const layer = new MassLayer(field, library(), los, () => null, () => undefined, { ruins: true });
    await layer.setObjects([
      { id: 'g1', asset: MASS_ASSET, x: 0, y: 0, z: 0, rotation: 0, scale: 1, mass: gated, tint: '#c65843' },
      { id: 'm1', asset: MASS_ASSET, x: 100, y: 0, z: 0, rotation: 0, scale: 1, mass: court },
    ]);
    const shown = () => {
      const meshes: InstancedMesh[] = [];
      los.traverse((o) => o instanceof InstancedMesh && o.visible && meshes.push(o));
      return meshes;
    };
    const intact = shown().filter((m) => (m.material as MeshStandardMaterial).side !== DoubleSide);
    // One mesh of walls, the flat roofs, the copings: as without openings
    expect(intact.length).toBe(3);
    const walls = intact.find((m) => m.geometry.getAttribute('aWall'))!;
    expect(walls.count).toBe(massShape(gated).walls.length + massShape(court).walls.length);
    // Every piece of a wall in pieces keeps the whole wall's length; the openings' frames are on them
    const c = walls.geometry.getAttribute('aWallC');
    const d = walls.geometry.getAttribute('aWallD');
    let pieces = 0;
    let arches = 0;
    let garages = 0;
    for (let i = 0; i < walls.count; i++) {
      if (c.getY(i) === 0) continue;
      pieces++;
      // The outline's 40 m wall, the courtyard's 20 m one
      expect([20, 40]).toContain(Math.round(c.getY(i)));
      if (d.getZ(i) === 1) arches++;
      if (d.getZ(i) === 2) garages++;
    }
    expect(pieces).toBeGreaterThanOrEqual(6);
    expect(arches).toBeGreaterThan(0);
    expect(garages).toBeGreaterThan(0);
    // The car park's inside dark, a passage's in the wall's colour, a little in shade
    const colour = new Color();
    const dark = Array.from({ length: walls.count }, (_, i) => walls.getColorAt(i, colour).r).filter((r) => r < 0.15);
    expect(dark.length).toBeGreaterThanOrEqual(3);
    // Destroyed: its pieces, wedges and all, fall with it
    layer.setDamage([{ id: 'g1', stage: 3, fallStart: FELL_LONG_AGO }]);
    const ruins = shown().filter((m) => (m.material as MeshStandardMaterial).side === DoubleSide);
    const ruinWalls = ruins.find((m) => m.geometry.getAttribute('aWallC'))!;
    expect(ruinWalls.count).toBeGreaterThanOrEqual(massShape(gated).walls.length);
    expect(layer.ruinShapeOf('g1')).not.toBeNull();
    layer.dispose();
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

  it('draws the basement under a catalogue model with the raised buildings, moves it with the model and takes it out', async () => {
    const field = new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights: new Float32Array(4) }, 1000, 1000);
    const los = new Group();
    const layer = new MapObjectLayer(field, library(), los);
    const house: MapObject = { id: 'h1', asset: 'house', x: 0, y: 0, z: 2.5, basement: 2.5, rotation: 0, scale: 1 };
    await layer.setObjects([house, { id: 'h2', asset: 'house', x: 50, y: 0, z: 0, rotation: 0, scale: 1 }]);
    const walls = (): InstancedMesh[] => {
      const out: InstancedMesh[] = [];
      los.traverse((o) => o instanceof InstancedMesh && (o.material as MeshStandardMaterial).name?.startsWith('mass-') && out.push(o));
      return out;
    };
    // One house's basement: four walls in one mesh, its model drawn as ever
    let meshes = walls();
    expect(meshes.reduce((s, m) => s + m.count, 0)).toBe(4);
    const x0 = meshes[0].instanceMatrix.array[12];
    // Moved in place as a model; its basement goes along
    expect(layer.updateObjects([{ ...house, x: 20 }])).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    meshes = walls();
    expect(meshes[0].instanceMatrix.array[12]).not.toBeCloseTo(x0);
    layer.removeObjects(['h1']);
    await new Promise((r) => setTimeout(r, 0));
    expect(walls().reduce((s, m) => s + m.count, 0)).toBe(0);
    layer.dispose();
  });
});
