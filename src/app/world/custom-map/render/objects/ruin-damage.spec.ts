import { BoxGeometry, CylinderGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, PlaneGeometry, type Material } from 'three';
import { describe, expect, it } from 'vitest';
import { MASS_ASSET, type MapMass, type MapObject } from '../../map-document';
import type { AssetCatalog, CatalogObject } from '../asset-catalog';
import { HeightField } from '../height-field';
import { MapAssetLibrary } from '../map-asset-library';
import { CRACK_SIZE, crackTexels } from './crack-texture';
import { massShape, splitWalls } from './mass-layer';
import { MapObjectLayer } from './object-layer';
import { footprintRects, RuinSlabs, type FootprintRect, type RuinFootprint } from './ruin-slabs';
import { modelSection } from './ruin-section';
import type { CatalogRoof } from '../../object-roof';
import { CustomMapDestruction } from '../../custom-map-destruction';
import {
  COLLAPSE_VARIANTS, collapseCuts, collapseRoll, collapseSeconds, collapseVariant, fallImpact, fallsAsTower, DAMAGE_ATTRIBUTES, DAMAGE_LOS, DAMAGE_UNIFORMS, damageArrays, FELL_LONG_AGO,
  readDamage, ruinSeed, ruinShape, sceneHeading, setCollapseVariant, structureSeed, writeDamage, type DamageArrays,
} from './ruin-damage';

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

  it('gives way to the heading of the hit that brought its stage, its bite on that side; the seed only without one', () => {
    // Map heading 0 (pushed east, map +x) is scene -x: a half turn in the scene
    expect(sceneHeading(0)).toBeCloseTo(Math.PI);
    expect(sceneHeading(64)).toBeCloseTo(Math.PI / 2);
    expect(sceneHeading(-1)).toBeNull();
    const pushed = ruinShape(structureSeed('h1'), frame, Math.PI);
    expect(pushed.heading).toBe(Math.PI);
    expect(pushed.biteX).toBeLessThan(frame.cx);
    expect(ruinShape(structureSeed('h1'), frame, null)).toEqual(ruinShape(structureSeed('h1'), frame));
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
    expect([Math.floor(damage[0]), damage[1]]).toEqual([3, 12.5]);
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
    expect(Math.floor((ruins[0].geometry.getAttribute('aDamage').array as Float32Array)[0])).toBe(2);

    // Fallen: the four facades split at the break line and where the collapse variants cut it across
    layer.setDamage([{ id: 'm2', stage: 3, fallStart: 4 }]);
    ruins = massMeshes(los, true).filter((m) => m.visible);
    const fallen = readDamage(DAMAGE_ATTRIBUTES.map((a) => ruins[0].geometry.getAttribute(a).array) as unknown as DamageArrays, 0);
    expect(collapseCuts(fallen).length).toBeGreaterThan(0);
    expect(ruins.reduce((n, m) => n + m.count, 0)).toBe(perBuilding + 4 * (1 + collapseCuts(fallen).length));

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
    for (let i = 0; i < ruin.count; i++) stages.set(Math.round(-a[i * 4] / 30), Math.floor(d[i * 4]));
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
    const g = slabs.mesh.geometry;
    const inside = readDamage(DAMAGE_ATTRIBUTES.map((a) => g.getAttribute(a).array) as unknown as DamageArrays, 0);
    expect(inside.biteR).toBeLessThan(shape.biteR);
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

describe('ruin damage: the collapse variants', () => {
  const frame = { cx: 10, cz: -4, ax: 6, az: 0, bx: 0, bz: 4, seatY: 5, height: 18 };

  it('rolls the same numbers for the same id on every partner, another building others', () => {
    const a = ruinShape(structureSeed('b1'), frame, 1.2);
    expect(ruinShape(structureSeed('b1'), frame, 1.2)).toEqual(a);
    expect(a.roll).toBe(Math.fround(a.roll));
    expect(a.roll).toBeGreaterThanOrEqual(0);
    expect(a.roll).toBeLessThan(1);
    expect([a.seatY, a.topY]).toEqual([5, 23]);
    const rolls = new Set(Array.from({ length: 50 }, (_, k) => ruinShape(structureSeed(`b${k}`), frame, 1.2).roll));
    expect(rolls.size).toBe(50);
  });

  it('packs the roll, seat and top into the three attributes and reads them back as the shader does', () => {
    expect(DAMAGE_ATTRIBUTES).toHaveLength(3);
    for (let k = 0; k < 50; k++) {
      const s = ruinShape(structureSeed(`p${k}`), frame);
      const arrays = damageArrays(2);
      for (const stage of [1, 2, 3]) {
        writeDamage(arrays, 1, stage, 7, s);
        const back = readDamage(arrays, 1);
        // The stage stays where the shader's tests look (over n - 0.5, under n + 0.5), the roll exactly
        expect(arrays[0][4]).toBeGreaterThanOrEqual(stage);
        expect(arrays[0][4]).toBeLessThan(stage + 0.5);
        expect(back.roll).toBe(s.roll);
        expect(back.topY).toBeCloseTo(s.topY, 4);
        expect(back.seatY).toBeCloseTo(s.seatY, 1);
        expect(back.biteR).toBeCloseTo(s.biteR, 2);
        expect(back.fallS).toBeCloseTo(s.fallS, 2);
        expect([back.breakY, back.cx, back.reach]).toEqual([s.breakY, s.cx, s.reach].map(Math.fround));
        expect(Math.cos(back.heading)).toBeCloseTo(Math.cos(s.heading), 5);
        expect(Math.sin(back.heading)).toBeCloseTo(Math.sin(s.heading), 5);
        expect(back.holeRow).toBe(-1);
      }
    }
  });

  it('cuts the upper part across between the break line and the top, the same heights from the same roll', () => {
    for (let k = 0; k < 100; k++) {
      const s = ruinShape(structureSeed(`c${k}`), frame);
      const cuts = collapseCuts(s);
      expect(collapseCuts({ ...s })).toEqual(cuts);
      // Three for a building over 9 m above its break line, rising, each inside the upper part
      expect(cuts).toHaveLength(3);
      for (let i = 0; i < cuts.length; i++) {
        expect(cuts[i]).toBeGreaterThan(s.breakY);
        expect(cuts[i]).toBeLessThan(s.topY);
        if (i) expect(cuts[i]).toBeGreaterThanOrEqual(cuts[i - 1]);
      }
      // The shader's rolls: the roll times its multiplier plus k times 0.618, its fraction
      expect(collapseRoll(s.roll, 1)).toBeCloseTo((s.roll * 7 + 0.618) % 1, 9);
    }
    // A low shed: one cut only
    expect(collapseCuts(ruinShape(structureSeed('shed'), { ...frame, height: 5 }))).toHaveLength(1);
  });

  it('switches how every ruin falls by one uniform, as the window does: by shape, or all tip, or all cave in', () => {
    const s = ruinShape(structureSeed('v1'), frame);
    expect(COLLAPSE_VARIANTS).toEqual(['auto', 'tip', 'cave-in']);
    setCollapseVariant('tip');
    expect(DAMAGE_UNIFORMS.uCollapse.value).toBe(1);
    expect(collapseVariant()).toBe('tip');
    expect(fallsAsTower(s)).toBe(true);
    expect(collapseSeconds(s)).toBe(s.fallS);
    setCollapseVariant('cave-in');
    expect(fallsAsTower(s)).toBe(false);
    setCollapseVariant('auto');
    expect(fallsAsTower(s)).toBe(s.tower);
  });

  it('carries its row of holes in the heading, the heading kept to a thousandth of its sine and cosine (row 400)', () => {
    const arrays = damageArrays(1);
    for (const row of [-1, 0, 7, 400]) {
      for (const heading of [-Math.PI, -1, 0, 2.5, Math.PI]) {
        writeDamage(arrays, 0, 2, 0, { ...ruinShape(structureSeed('r'), frame, heading), holeRow: row });
        const back = readDamage(arrays, 0);
        expect(back.holeRow).toBe(row);
        expect(Math.cos(back.heading)).toBeCloseTo(Math.cos(heading), 3);
        expect(Math.sin(back.heading)).toBeCloseTo(Math.sin(heading), 3);
      }
    }
  });

  it('tips a slender tower, caves in every other building, and keeps which in the reach of its attributes', () => {
    // 18 m high over a ground of 12 by 8 m: a building; over 4 by 4 m: a tower (more than 2.5 times its width)
    const wide = ruinShape(structureSeed('w'), frame);
    const slender = ruinShape(structureSeed('w'), { ...frame, ax: 2, bz: 2 });
    expect([wide.tower, slender.tower]).toEqual([false, true]);
    const arrays = damageArrays(2);
    writeDamage(arrays, 0, 3, 0, wide);
    writeDamage(arrays, 1, 3, 0, slender);
    expect(arrays[2][2]).toBeGreaterThan(0);
    expect(arrays[2][6]).toBeLessThan(0);
    expect(readDamage(arrays, 0).tower).toBe(false);
    expect(readDamage(arrays, 1)).toMatchObject({ tower: true, reach: Math.fround(slender.reach) });
  });

  it('says where and when it comes down: a cave-in in its footprint as it starts to land, a tower beyond its foot', () => {
    const s = ruinShape(structureSeed('i1'), frame, 0);
    const cave = fallImpact(s, 2);
    expect([cave.x, cave.z, cave.y]).toEqual([s.cx, s.cz, s.seatY]);
    expect(cave.length).toBeCloseTo(2 * s.reach);
    // The foot gives 0.35 s, half a second later the first parts reach the floors below them
    expect(cave.delay).toBeCloseTo(0.85);
    const tower = fallImpact(s, 1);
    expect([tower.dx, tower.dz]).toEqual([1, 0]);
    expect(tower.x).toBeCloseTo(s.cx + s.reach + (s.topY - s.breakY) * 0.4);
    expect(tower.delay).toBeCloseTo(s.fallS * 0.7);
  });
});

describe('ruin damage: floors inside the footprint', () => {
  /** A round tower's top grid: 16 x 16 cells of 0.5 m, 10 m high within 4 m of the middle (its battlement) */
  const round = (): CatalogRoof => {
    const columns = 16;
    let bytes = '';
    for (let j = 0; j < columns; j++) {
      for (let i = 0; i < columns; i++) {
        const r = Math.hypot(-4 + (i + 0.5) * 0.5, -4 + (j + 0.5) * 0.5);
        bytes += String.fromCharCode(r < 4 ? 100 : 0);
      }
    }
    return { x: -4, z: -4, cell: 0.5, columns, rows: columns, step: 0.1, heights: btoa(bytes) };
  };
  const square: FootprintRect = { x0: -4, x1: 4, z0: -4, z1: 4 };
  const corners = (r: FootprintRect) => [[r.x0, r.z0], [r.x1, r.z0], [r.x0, r.z1], [r.x1, r.z1]];

  it("lays a round tower's floors as boxes inside its circle, not over its ground square", () => {
    const rects = footprintRects(round(), 3.6, square);
    expect(rects.length).toBeGreaterThan(4);
    for (const r of rects) for (const [x, z] of corners(r)) expect(Math.hypot(x, z)).toBeLessThan(4 + 0.25);
    // They cover most of the circle and none overlap
    const area = rects.reduce((sum, r) => sum + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    expect(area / (Math.PI * 16)).toBeGreaterThan(0.75);
    for (const a of rects) for (const b of rects) if (a !== b) expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.z1 <= b.z0 || b.z1 <= a.z0).toBe(true);
    // None where the building is lower than the floor
    expect(footprintRects(round(), 11, square)).toEqual([]);
  });

  it("keeps a round tower's floors inside its wall where the battlement reaches out past it", () => {
    // A shaft of 3 m radius, 10 m high; the grid's battlement reaches 4 m
    const shaft = new CylinderGeometry(3, 3, 10, 24, 1, true).translate(0, 5, 0);
    const rects = footprintRects(round(), 3.6, square, modelSection([shaft], round(), 3.5));
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) for (const [x, z] of corners(r)) expect(Math.hypot(x, z)).toBeLessThan(3);
  });

  it('builds the slabs and inner walls of a round building inside its circle, in the group frame', () => {
    const slabs = new RuinSlabs();
    const frame = { cx: 20, cz: 0, ax: 4, az: 0, bx: 0, bz: 4, seatY: 0, height: 10 };
    const footprint: RuinFootprint = { roof: round(), box: [0, 0, 4, 4], ox: 20, oz: 0, ux: 1, uz: 0, vx: 0, vz: 1, sy: 1 };
    slabs.set('t', frame, ruinShape(structureSeed('t'), frame), 2, FELL_LONG_AGO, 'stone', footprint);
    const m = slabs.mesh.instanceMatrix.array;
    const all = Array.from({ length: slabs.mesh.count }, (_, k) => k * 16);
    // A floor is thin: the corners of its box within the circle round (20, 0)
    const floors = all.filter((at) => m[at + 5] < 0.3);
    expect(floors.length).toBeGreaterThan(4);
    for (const at of floors) {
      for (const [sx, sz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
        const x = m[at + 12] + m[at] * sx + m[at + 8] * sz;
        const z = m[at + 14] + m[at + 2] * sx + m[at + 10] * sz;
        expect(Math.hypot(x - 20, z)).toBeLessThan(4.25);
      }
    }
    // The inner walls end inside it too, below the eaves
    const walls = all.filter((at) => m[at + 5] >= 0.3);
    expect(walls.length).toBeGreaterThan(0);
    for (const at of walls) {
      for (const end of [-0.5, 0.5]) expect(Math.hypot(m[at + 12] + m[at + 8] * end - 20, m[at + 14] + m[at + 10] * end)).toBeLessThan(4.25);
      expect(m[at + 5]).toBeLessThanOrEqual(10 * 0.62 + 1e-6);
    }
    slabs.dispose();
  });
});
