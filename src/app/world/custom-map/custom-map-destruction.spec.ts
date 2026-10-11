import { CustomMapDestruction, STRUCTURE_HP, structureHp } from './custom-map-destruction';
import { MAP_METERS_PER_DEGREE, type MapObject } from './map-document';

const CATALOG = [
  { id: 'house', category: 'building', footprint: 4, height: 6 },
  { id: 'wall', category: 'wall', footprint: 2, height: 3 },
  { id: 'oak', category: 'tree', footprint: 3, height: 12 },
];

const object = (id: string, asset: string, x: number, y: number, scale = 1): MapObject =>
  ({ id, asset, x, y, z: 0, rotation: 0, scale });
/** A geo point at map (x, y) */
const at = (x: number, y: number) => ({ lat: y / MAP_METERS_PER_DEGREE, lon: x / MAP_METERS_PER_DEGREE });

describe('CustomMapDestruction', () => {
  let objects: MapObject[];
  let fell: string[][];
  let rose: string[][];
  let destruction: CustomMapDestruction;

  beforeEach(() => {
    objects = [object('h1', 'house', 0, 0), object('h2', 'house', 50, 0, 2), object('w1', 'wall', 10, 0), object('t1', 'oak', 5, 5)];
    fell = [];
    rose = [];
    destruction = new CustomMapDestruction(
      () => objects,
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

  it('shows the fallen set the simulation says, each fall once, and stands up what is no longer in it (TODO E131)', () => {
    expect(destruction.setFallen(['w1']).map((s) => s.id)).toEqual(['w1']);
    expect(fell).toEqual([['w1']]);
    expect(destruction.structures()[2].hp).toBe(0);
    // The same set again: nothing new falls
    expect(destruction.setFallen(['w1'])).toEqual([]);
    expect(fell).toHaveLength(1);
    // A restore with another set: the wall stands, the house falls
    destruction.setFallen(['h1']);
    expect(fell).toEqual([['w1'], ['h1']]);
    expect(rose).toEqual([['w1']]);
    // A new run: everything stands at full HP
    destruction.setFallen([]);
    expect(rose).toEqual([['w1'], ['h1']]);
    expect(destruction.structures().every((s) => s.hp === s.maxHp)).toBe(true);
  });

  it('hands the simulation its structures for the run rules, in map degrees with their full HP', () => {
    const [h1] = destruction.asRunStructures();
    expect(h1).toEqual({ id: 'h1', ...at(0, 0), radius: 4, height: 6, hp: structureHp(4, 6) });
    expect(destruction.asRunStructures().map((s) => s.id)).toEqual(['h1', 'h2', 'w1']);
  });
});
