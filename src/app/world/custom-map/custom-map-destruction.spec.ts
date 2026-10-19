import { CustomMapDestruction, STRUCTURE_HP, passingObjectIds, structureHp } from './custom-map-destruction';
import { MAP_METERS_PER_DEGREE, MASS_ASSET, type MapGameplay, type MapMass, type MapObject } from './map-document';
import { presetHp } from '../../configs/destruction.config';
import type { CatalogRoof } from './object-roof';

const CATALOG = [
  { id: 'house', category: 'building', footprint: 4, height: 6, box: [1, 0, 3, 2] as const, roof: {} as CatalogRoof },
  { id: 'wall', category: 'wall', footprint: 2, height: 3 },
  { id: 'oak', category: 'tree', footprint: 3, height: 12 },
];

const object = (id: string, asset: string, x: number, y: number, scale = 1): MapObject =>
  ({ id, asset, x, y, z: 0, rotation: 0, scale });
/** A geo point at map (x, y) */
const at = (x: number, y: number) => ({ lat: y / MAP_METERS_PER_DEGREE, lon: x / MAP_METERS_PER_DEGREE });

describe('CustomMapDestruction', () => {
  let objects: MapObject[];
  let gameplay: MapGameplay;
  let fell: string[][];
  let rose: string[][];
  let destruction: CustomMapDestruction;

  beforeEach(() => {
    objects = [object('h1', 'house', 0, 0), object('h2', 'house', 50, 0, 2), object('w1', 'wall', 10, 0), object('t1', 'oak', 5, 5)];
    gameplay = { destructible: true };
    fell = [];
    rose = [];
    destruction = new CustomMapDestruction(
      () => ({ objects, gameplay }),
      (fallen) => fell.push(fallen.map((o) => o.id)),
      (risen) => rose.push(risen.map((o) => o.id)),
    );
    destruction.setCatalog(CATALOG);
  });

  it('takes the buildings, walls and structures of the catalogue, with HP by their size', () => {
    expect(destruction.structures().map((s) => s.id)).toEqual(['h1', 'h2', 'w1']);
    const [h1, h2] = destruction.structures();
    expect(h1.maxHp).toBe(structureHp(4, 6));
    // Twice the scale: twice the radius and height, more HP
    expect(h2.radius).toBe(8);
    expect(h2.maxHp).toBeGreaterThan(h1.maxHp);
    expect(structureHp(0.1, 0.1)).toBe(STRUCTURE_HP.min);
    expect(structureHp(100, 100)).toBe(STRUCTURE_HP.max);
  });

  it('wears down a building raised from its footprint as a cylinder of its own ground and height (E235)', () => {
    const mass: MapMass = { rings: [[-10, -5, 10, -5, 10, 5, -10, 5]], height: 9, floors: 3, roof: 'flat', facade: 'plaster' };
    objects = [{ ...object('m1', MASS_ASSET, 0, 0), mass }];
    destruction.setCatalog([...CATALOG, { id: MASS_ASSET, category: 'building', footprint: 16.7, height: 4 }]);
    const [m1] = destruction.structures();
    expect(m1.radius).toBeCloseTo(Math.sqrt(200 / Math.PI));
    expect(m1.height).toBe(9);
    expect(m1.maxHp).toBe(structureHp(m1.radius, 9));
    // Its rubble and its roof follow its own rectangle, the roof its outline
    expect(destruction.asRunStructures()[0].box!.slice(2, 4)).toEqual([10, 5]);
    expect(destruction.asRunStructures()[0].mass).toEqual({ x: 0, y: 0, turn: 0, scale: 1, rings: mass.rings });
  });

  it('tells every change of stage for the looks, as it happens or as the stages came whole', () => {
    const heard: [string, number, boolean][] = [];
    destruction = new CustomMapDestruction(
      () => ({ objects, gameplay }),
      () => undefined,
      () => undefined,
      true,
      null,
      (changes, now) => heard.push(...changes.map((c): [string, number, boolean] => [c.object.id, c.stage, now])),
    );
    destruction.setCatalog(CATALOG);
    destruction.setStages(new Uint8Array([2, 0, 3]));
    destruction.setStage(0, 3);
    // Unchanged stages say nothing
    destruction.setStage(0, 3);
    destruction.setStages(new Uint8Array([3, 0, 0]));
    expect(heard).toEqual([['h1', 2, false], ['w1', 3, false], ['h1', 3, true], ['w1', 0, false]]);
  });

  it('shows the stages the simulation says, each fall once, and stands up what no longer lies fallen', () => {
    destruction.setStages(new Uint8Array([0, 0, 3]));
    expect(fell).toEqual([['w1']]);
    expect(destruction.structures()[2].stage).toBe(3);
    // The same again: nothing new falls
    destruction.setStages(new Uint8Array([0, 0, 3]));
    expect(fell).toHaveLength(1);
    // One stage at a time, as the damage comes: battered first, no fall
    destruction.setStage(0, 1);
    expect(fell).toHaveLength(1);
    destruction.setStage(0, 3);
    expect(fell).toEqual([['w1'], ['h1']]);
    // A restore: the wall stands, the house lies; a new run stands everything
    destruction.setStages(new Uint8Array([3, 0, 0]));
    expect(rose).toEqual([['w1']]);
    destruction.setStages(new Uint8Array([0, 0, 0]));
    expect(rose).toEqual([['w1'], ['h1']]);
    expect(destruction.structures().every((s) => s.stage === 0)).toBe(true);
  });

  it('hands the simulation its structures for the run rules: map degrees, HP, ground plan and roof', () => {
    const [h1, h2, w1] = destruction.asRunStructures();
    // The house's box turns with it; its middle 1 m along the model's x, which the renderer turns to the map's -x
    expect(h1).toEqual({ id: 'h1', ...at(0, 0), radius: 4, height: 6, hp: structureHp(4, 6), box: [-1, 0, 3, 2, 0], roof: true });
    expect(h2.box).toEqual([48, 0, 6, 4, 0]);
    expect(w1).toEqual({ id: 'w1', ...at(10, 0), radius: 2, height: 3, hp: structureHp(2, 3) });
  });

  it('leaves out what the map keeps standing and what a wave event moves; scales the HP and starts what it damaged beforehand', () => {
    objects[0].destructible = false;
    objects[1].damage = 2;
    objects[2].damage = 3;
    gameplay = { destructible: true, structureHp: 200, events: [{ wave: 3, kind: 'objects', ids: ['w1'], show: false }] };
    destruction.setCatalog(CATALOG);
    const run = destruction.asRunStructures();
    expect(run.map((s) => s.id)).toEqual(['h2']);
    expect(run[0].hp).toBe(structureHp(8, 12) * 2);
    expect(run[0].start).toBe(presetHp(run[0].hp, 2));
    // Held in bounds
    gameplay = { destructible: true, structureHp: 9000 };
    destruction.setCatalog(CATALOG);
    expect(destruction.asRunStructures()[0].hp).toBe(structureHp(8, 12) * 3);
    // The objects of wave events carry no tower; a destructible roof does
    expect([...passingObjectIds({ gameplay: { events: [{ wave: 3, kind: 'objects', ids: ['w1'], show: false }] } })]).toEqual(['w1']);
  });
});
