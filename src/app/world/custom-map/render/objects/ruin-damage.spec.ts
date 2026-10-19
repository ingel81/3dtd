import { BoxGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, PlaneGeometry, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { MASS_ASSET, type MapMass, type MapObject } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { CRACK_SIZE, crackTexels } from './crack-texture';
import { massShape, splitWalls } from './mass-layer';
import { MapObjectLayer } from './object-layer';
import { RuinSlabs } from './ruin-slabs';
import { CustomMapDestruction } from '../../custom-map-destruction';
import { DAMAGE_LOS, FELL_LONG_AGO, ruinSeed, ruinShape, structureSeed } from './ruin-damage';

const entry = (id: string, category: CatalogObject['category'], file: string, extra: Partial<CatalogObject> = {}): CatalogObject => ({
  id,
  name: id,
  category,
  file,
  footprint: 4,
  height: 8,
  blocksLos: true,
  blocksBuild: true,
  scaleRange: [1, 1],
  randomRotation: false,
  wind: 0,
  drawDistance: 3000,
  ...extra,
});

const catalog: AssetCatalog = {
  version: 1,
  materials: [],
  objects: [entry(MASS_ASSET, 'building', 'kit.glb'), entry('house', 'building', 'house.glb', { box: [0, 0, 3, 2] }), entry('rock', 'rock', 'rock.glb')],
};

/** A house 8 m high, a rock, and the raised buildings' kit */
function library(): MapAssetLibrary {
  return new MapAssetLibrary('base/', {
    fetch: (() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(catalog) } as Response)) as typeof fetch,
    loadModel: (url) => {
      const root = new Group();
      if (url.includes('kit')) {
        for (const [name, metres] of [['mass-plaster', 3], ['mass-plinth', 2], ['mass-roof-flat', 3]] as const) {
          const material = new MeshStandardMaterial();
          material.name = name;
          root.add(new Mesh(new PlaneGeometry(metres, metres), material));
        }
      } else {
        root.add(new Mesh(new BoxGeometry(6, 8, 4).translate(0, 4, 0), new MeshStandardMaterial()));
      }
      return Promise.resolve(root);
    },
  });
}

const block: MapMass = { rings: [[-10, -6, 10, -6, 10, 6, -10, 6]], height: 12, floors: 4, roof: 'flat', facade: 'plaster' };
const field = (heights = new Float32Array(4)): HeightField => new HeightField({ columns: 2, rows: 2, cellSize: 1000, heights }, 1000, 1000);
const instanced = (g: Group): InstancedMesh[] => {
  const out: InstancedMesh[] = [];
  g.traverse((o) => o instanceof InstancedMesh && out.push(o));
  return out;
};
const named = (g: Group, name: string): InstancedMesh[] => instanced(g).filter((m) => m.name === name);
const massMeshes = (g: Group, ruin: boolean): InstancedMesh[] =>
  instanced(g).filter((m) => (m.material as Material).name?.startsWith('mass-') && !!m.geometry.getAttribute('aDamage') === ruin);

describe('ruin damage: the shape of a ruin', () => {
  const frame = { cx: 10, cz: -4, ax: 3, az: 0, bx: 0, bz: 2, seatY: 5, height: 8 };

  it("rolls the same ruin from the same id, another from another or from the map's own seed", () => {
    expect(ruinShape(structureSeed('h1'), frame)).toEqual(ruinShape(structureSeed('h1'), frame));
    expect(ruinShape(structureSeed('h1'), frame).heading).not.toBe(ruinShape(structureSeed('h2'), frame).heading);
    expect(ruinSeed({ id: 'h1' })).toBe(structureSeed('h1'));
    expect(ruinSeed({ id: 'h1', damageSeed: 3 })).not.toBe(ruinSeed({ id: 'h1', damageSeed: 4 }));
  });

  it('breaks 1.5 to 4 m up but never above 55 % of the building, bites the top corner it gives way to', () => {
    for (let k = 0; k < 200; k++) {
      const s = ruinShape(structureSeed(`s${k}`), frame);
      const stump = s.breakY - frame.seatY;
      expect(stump).toBeGreaterThanOrEqual(1.5 - 1e-9);
      expect(stump).toBeLessThanOrEqual(Math.min(4, frame.height * 0.55) + 1e-9);
      // The bite lies on the side of the heading, high up, the pivot on the rectangle's edge that way
      const along = (s.biteX - s.cx) * Math.cos(s.heading) + (s.biteZ - s.cz) * Math.sin(s.heading);
      expect(along).toBeGreaterThan(0);
      expect(s.biteY).toBeGreaterThan(frame.seatY + frame.height * 0.8);
      expect(s.reach).toBeLessThanOrEqual(3 + 2 + 1e-9);
      expect(s.fallS).toBeGreaterThanOrEqual(1.2);
      expect(s.fallS).toBeLessThanOrEqual(2.5);
    }
  });

  it('leaves a low shed a stump of 55 % of its height', () => {
    const s = ruinShape(structureSeed('shed'), { ...frame, height: 2 });
    expect(s.breakY - frame.seatY).toBeCloseTo(1.1);
  });
});

describe('ruin damage: the cracks', () => {
  it('draws the same lines every time, hairlines in red, long cracks in green, round the tile edges', () => {
    const a = crackTexels();
    expect(crackTexels()).toEqual(a);
    let red = 0;
    let green = 0;
    let edge = 0;
    for (let i = 0; i < CRACK_SIZE * CRACK_SIZE; i++) {
      if (a[i * 2] > 127) red++;
      if (a[i * 2 + 1] > 127) green++;
      const x = i % CRACK_SIZE;
      if ((x === 0 || x === CRACK_SIZE - 1) && (a[i * 2] | a[i * 2 + 1]) > 127) edge++;
    }
    const n = CRACK_SIZE * CRACK_SIZE;
    // Lines, not a wash: a few per cent of the tile each
    expect(red / n).toBeGreaterThan(0.01);
    expect(red / n).toBeLessThan(0.15);
    expect(green / n).toBeGreaterThan(0.005);
    expect(green / n).toBeLessThan(0.1);
    expect(edge).toBeGreaterThan(0);
  });
});

describe('ruin damage: raised walls split at the break line', () => {
  it('cuts a wall that crosses the line into its stump and the piece above, keeping the wall top for the storeys', () => {
    const walls = massShape(block).walls;
    const split = splitWalls(walls, 3, 0.01);
    const facades = walls.filter((w) => w.kind === 0);
    // Every facade crosses 3 m; the parapet's inside above the roof does not
    expect(split.length).toBe(walls.length + facades.length);
    for (const p of split) {
      expect(p.top <= 3 - 0.004 || p.bottom >= 3 + 0.004).toBe(true);
      if (p.lift !== undefined) expect(p.lift).toBeCloseTo(-p.bottom);
      if (p.wallTop !== undefined) expect(p.wallTop).toBe(12);
    }
  });
});

describe('ruin damage: the object layer', () => {
  const house = (id: string, x: number): MapObject => ({ id, asset: 'house', x, y: 0, z: 0, rotation: 0, scale: 1 });

  it('moves a damaged house into its asset ruin batch and back, with its stage per instance', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los, { ruins: true });
    await layer.setObjects([house('h1', 0), house('h2', 30), { id: 'r1', asset: 'rock', x: 60, y: 0, z: 0, rotation: 0, scale: 1 }]);
    // The ruin batch is there before any damage, for the warm-up; none for the rock
    const ruins = named(los, 'house-damaged');
    expect(ruins).toHaveLength(1);
    expect(named(los, 'rock-damaged')).toHaveLength(0);
    expect(ruins[0].userData['losVertex']).toBe(DAMAGE_LOS);
    expect(ruins[0].customDepthMaterial).toBeDefined();
    expect((ruins[0].material as Material).side).toBe(2);
    layer.showAllForWarmUp(true);
    expect(ruins[0].count).toBe(1);
    layer.showAllForWarmUp(false);
    expect(ruins[0].count).toBe(0);

    layer.setDamage([{ id: 'h2', stage: 3, fallStart: 12.5 }]);
    expect(ruins[0].count).toBe(1);
    expect(named(los, 'house')[0].count).toBe(1);
    const damage = ruins[0].geometry.getAttribute('aDamage').array as Float32Array;
    expect([damage[0], damage[1]]).toEqual([3, 12.5]);
    // Its middle where the house stands (scene x is minus map x), the break line 1.5 to 4 m up
    const c = ruins[0].geometry.getAttribute('aDamageC').array as Float32Array;
    expect(c[0]).toBeCloseTo(-30);
    expect(damage[3]).toBeGreaterThanOrEqual(1.5);
    expect(damage[3]).toBeLessThanOrEqual(4);

    // A worse stage writes the instance anew, a whole one goes back
    layer.setDamage([{ id: 'h1', stage: 1, fallStart: FELL_LONG_AGO }]);
    expect(ruins[0].count).toBe(2);
    expect(named(los, 'house')).toHaveLength(0);
    layer.setDamage([{ id: 'h1', stage: 0, fallStart: FELL_LONG_AGO }, { id: 'h2', stage: 0, fallStart: FELL_LONG_AGO }]);
    expect(ruins[0].count).toBe(0);
    expect(named(los, 'house')[0].count).toBe(2);
    layer.dispose();
  });

  it('builds a house damaged before it was built straight into the ruins', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los, { ruins: true });
    layer.setDamage([{ id: 'h1', stage: 2, fallStart: FELL_LONG_AGO }]);
    await layer.setObjects([house('h1', 0), house('h2', 30)]);
    expect(named(los, 'house-damaged')[0].count).toBe(1);
    expect(named(los, 'house')[0].count).toBe(1);
    layer.dispose();
  });

  it('stands buildings on the ground as the map made it, other objects on the ground as it is', async () => {
    const heights = new Float32Array(4);
    const los = new Group();
    const layer = new MapObjectLayer(field(heights), library(), los, { ruins: true, standingAt: () => 0 });
    await layer.setObjects([house('h1', 0), { id: 'r1', asset: 'rock', x: 60, y: 0, z: 0, rotation: 0, scale: 1 }]);
    // Rubble raises the ground by 2 m
    heights.fill(2);
    layer.refreshHeights();
    expect(named(los, 'house')[0].instanceMatrix.array[13]).toBe(0);
    expect(named(los, 'rock')[0].instanceMatrix.array[13]).toBe(2);
    layer.dispose();
  });
});

describe('ruin damage: raised buildings', () => {
  const raised = (id: string, x: number): MapObject => ({ id, asset: MASS_ASSET, x, y: 0, z: 0, rotation: 0, scale: 1, mass: block });

  it('takes a damaged building out of the intact batches into the ruins, its walls split once it falls', async () => {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los, { ruins: true });
    await layer.setObjects([raised('m1', 0), raised('m2', 60)]);
    const intact = massMeshes(los, false);
    const perBuilding = 8 + massShape(block).roof.length + 4;
    expect(intact.reduce((n, m) => n + m.count, 0)).toBe(2 * perBuilding);
    // Hidden ruin batches of one building per facade and covering, for the warm-up
    const warm = massMeshes(los, true);
    expect(warm.length).toBeGreaterThan(0);
    expect(warm.every((m) => !m.visible && m.userData['losVertex'] === DAMAGE_LOS)).toBe(true);

    layer.setDamage([{ id: 'm2', stage: 2, fallStart: FELL_LONG_AGO }]);
    // Its instances shrink to nothing in the intact batches
    const zeroed = (m: InstancedMesh) => {
      let n = 0;
      for (let i = 0; i < m.count; i++) if (m.instanceMatrix.array[i * 16] === 0 && m.instanceMatrix.array[i * 16 + 5] === 0) n++;
      return n;
    };
    expect(intact.reduce((n, m) => n + zeroed(m), 0)).toBe(perBuilding);
    let ruins = massMeshes(los, true).filter((m) => m.visible);
    expect(ruins.reduce((n, m) => n + m.count, 0)).toBe(perBuilding);
    expect((ruins[0].geometry.getAttribute('aDamage').array as Float32Array)[0]).toBe(2);

    // Fallen: the four facades split at the break line
    layer.setDamage([{ id: 'm2', stage: 3, fallStart: 4 }]);
    ruins = massMeshes(los, true).filter((m) => m.visible);
    expect(ruins.reduce((n, m) => n + m.count, 0)).toBe(perBuilding + 4);

    // Whole again (a new run): everything built anew, no ruins shown
    layer.setDamage([{ id: 'm2', stage: 0, fallStart: FELL_LONG_AGO }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(massMeshes(los, true).filter((m) => m.visible)).toHaveLength(0);
    expect(massMeshes(los, false).reduce((n, m) => n + m.count - zeroed(m), 0)).toBe(2 * perBuilding);
    layer.dispose();
  });
});

describe('ruin damage: from the state, not from the events', () => {
  const houses = (): MapObject[] => ['h1', 'h2', 'h3'].map((id, k) => ({ id, asset: 'house', x: k * 30, y: 0, z: 0, rotation: 0, scale: 1 }));
  /** The view's ruins as stages per house: what the ruin batch draws (aDamage.x), 0 for a house in its own batch */
  const drawn = (los: Group): number[] => {
    const ruin = named(los, 'house-damaged')[0];
    const stages = new Map<number, number>();
    const a = ruin.geometry.getAttribute('aDamageC').array as Float32Array;
    const d = ruin.geometry.getAttribute('aDamage').array as Float32Array;
    for (let i = 0; i < ruin.count; i++) stages.set(Math.round(-a[i * 4] / 30), d[i * 4]);
    return [0, 1, 2].map((k) => stages.get(k) ?? 0);
  };
  /** A layer fed by the structures' stages as the world feeds its view (CustomMapWorld.damageChanged) */
  async function wired(): Promise<{ los: Group; layer: MapObjectLayer; destruction: CustomMapDestruction }> {
    const los = new Group();
    const layer = new MapObjectLayer(field(), library(), los, { ruins: true });
    const objects = houses();
    await layer.setObjects(objects);
    const destruction = new CustomMapDestruction(() => ({ objects }), () => undefined, () => undefined, true, null, (changes, now) =>
      layer.setDamage(changes.map((c) => ({ id: c.object.id, stage: c.stage, fallStart: now && c.stage >= 3 ? 7 : FELL_LONG_AGO }))),
    );
    destruction.setCatalog(catalog.objects);
    return { los, layer, destruction };
  }

  it('comes to the ruins of the stages after a seek, a restore or a new run, whatever happened before', async () => {
    const { los, layer, destruction } = await wired();
    // The fight: one battered, then holed and felled, another felled
    destruction.setStage(0, 1);
    destruction.setStage(0, 2);
    destruction.setStage(1, 3);
    destruction.setStage(0, 3);
    expect(drawn(los)).toEqual([3, 3, 0]);
    // A seek back to where only the first was battered, a save with the third holed, a new run
    destruction.setStages(new Uint8Array([1, 0, 0]));
    expect(drawn(los)).toEqual([1, 0, 0]);
    expect(named(los, 'house')[0].count).toBe(2);
    destruction.setStages(new Uint8Array([0, 0, 2]));
    expect(drawn(los)).toEqual([0, 0, 2]);
    destruction.setStages(new Uint8Array([0, 0, 0]));
    expect(drawn(los)).toEqual([0, 0, 0]);
    expect(named(los, 'house').map((m) => m.count)).toEqual([3]);
    layer.dispose();
  });

  it('lays a ruin the stages brought whole as fallen, one the fight felled falling from now', async () => {
    const { los, layer, destruction } = await wired();
    destruction.setStages(new Uint8Array([3, 0, 0]));
    destruction.setStage(1, 3);
    const d = named(los, 'house-damaged')[0].geometry.getAttribute('aDamage').array as Float32Array;
    expect([d[1], d[5]]).toEqual([FELL_LONG_AGO, 7]);
    layer.dispose();
  });
});

describe('ruin damage: floors and inner walls', () => {
  const frame = { cx: 0, cz: 0, ax: 4, az: 0, bx: 0, bz: 2, seatY: 0, height: 10 };
  const shape = ruinShape(structureSeed('h'), frame);

  it('gives a holed ruin a floor every storey and a wall across each side long enough for two rooms, none below stage 2', () => {
    const slabs = new RuinSlabs();
    slabs.set('h', frame, shape, 1, FELL_LONG_AGO, 'brick');
    expect(slabs.mesh.visible).toBe(false);
    slabs.set('h', frame, shape, 2, FELL_LONG_AGO, 'brick');
    // Floors at 3 and 6 m (9 m is too near the top), one wall across the 8 m side, none across the 4 m one
    expect(slabs.mesh.count).toBe(3);
    const m = slabs.mesh.instanceMatrix.array;
    expect([m[13], m[16 + 13]]).toEqual([3, 6]);
    // The wall stands from the seat up to below the eaves, thin across the long side
    expect(m[32 + 5]).toBeCloseTo(6.2);
    expect(Math.abs(m[32])).toBeCloseTo(0.18);
    // The insides take a smaller bite than the walls: they jut into the hole
    const b = slabs.mesh.geometry.getAttribute('aDamageB').array as Float32Array;
    expect(b[3]).toBeLessThan(shape.biteR);
    // Fallen: only the floors well inside the stump stay, the walls the cut trims
    slabs.set('h', frame, shape, 3, FELL_LONG_AGO, 'brick');
    expect(slabs.mesh.count).toBe(Math.floor((shape.breakY - 1) / 3) + 1);
    slabs.delete('h');
    expect(slabs.mesh.visible).toBe(false);
    slabs.dispose();
  });

  it('builds the insides of a raised building as of a model', async () => {
    const group = new Group();
    const layer = new MapObjectLayer(field(), library(), group, { ruins: true });
    const raised: MapObject = { id: 'm1', asset: MASS_ASSET, x: 0, y: 0, z: 0, rotation: 0, scale: 1, mass: block };
    await layer.setObjects([raised, { id: 'h1', asset: 'house', x: 60, y: 0, z: 0, rotation: 0, scale: 1 }]);
    layer.setDamage([{ id: 'm1', stage: 2, fallStart: FELL_LONG_AGO }, { id: 'h1', stage: 2, fallStart: FELL_LONG_AGO }]);
    const slabs = layer.group.children.find((c) => c.name === 'ruin-slabs') as InstancedMesh;
    // The block (20 x 12 m, 12 m high): three floors, two inner walls; the house (6 x 4 m, 8 m high): two floors, one wall
    expect(slabs.count).toBe(5 + 3);
    layer.dispose();
  });
});
