import { objectCost, sceneCost, type CostEntry } from './scene-cost';

const LARGE = 2048 * 2048;
const SMALL = 512 * 512;

const tuft: CostEntry = { category: 'plant', height: 0.5, drawDistance: 140, file: 'm.glb', triangles: 10 };
const house: CostEntry = { category: 'building', height: 8, drawDistance: 3000, file: 'm.glb', triangles: 3758 };
const tree: CostEntry = { category: 'tree', height: 12, drawDistance: 2500, file: 'm.glb', triangles: 844 };

describe('objectCost', () => {
  it('costs a house its triangles and a grass tuft next to nothing', () => {
    expect(objectCost(house, LARGE)).toBeCloseTo(3758 + 2, 0);
    // 10 triangles in a 140 m disc out of 2 km by 2 km, plus the instance
    expect(objectCost(tuft, LARGE)).toBeCloseTo(2 + (10 * Math.PI * 140 * 140) / LARGE, 3);
    expect(objectCost(tuft, LARGE)).toBeLessThan(objectCost(house, LARGE) / 1000);
  });

  it('weights each band by the share of the map in it, a Small map sees a short draw distance more often', () => {
    expect(objectCost(tuft, SMALL)).toBeGreaterThan(objectCost(tuft, LARGE));
    // A house is drawn over every map: its cost does not depend on the size
    expect(objectCost(house, SMALL)).toBeCloseTo(objectCost(house, LARGE));
  });

  it('counts the LOD models and the far impostor of a tree in their bands', () => {
    const r1 = Math.PI * 300 * 300;
    // Tree: model to max(380, 12 * 25 = 300) = 380 m, the impostor of 4 triangles beyond
    const near = Math.PI * 380 * 380;
    expect(objectCost(tree, LARGE)).toBeCloseTo(2 + (844 * near + 4 * (LARGE - near)) / LARGE, 3);
    const withLod: CostEntry = { ...house, lod: [{ file: 'l.glb', distance: 300, triangles: 1000 }] };
    expect(objectCost(withLod, LARGE)).toBeCloseTo(2 + (3758 * r1 + 1000 * (LARGE - r1)) / LARGE, 3);
    // A LOD without its own count draws as many as the model
    expect(objectCost({ ...house, lod: [{ file: 'l.glb', distance: 300 }] }, LARGE)).toBeCloseTo(objectCost(house, LARGE));
  });

  it('adds the particles of effects, also for an entry without a model', () => {
    const fire: CostEntry = { category: 'fx', height: 1, drawDistance: 1500, file: '', effects: [{ kind: 'fire', rate: 25 }, { kind: 'smoke' }] };
    expect(objectCost(fire, LARGE)).toBe(2 + 25 * 20 + 20);
  });

  it('counts a model without a triangle count, or an unknown asset, as 500 triangles', () => {
    const { triangles: _, ...uncounted } = house;
    expect(objectCost(uncounted, SMALL)).toBeCloseTo(502);
    expect(objectCost(undefined, SMALL)).toBeCloseTo(502);
  });
});

describe('sceneCost', () => {
  it('sums every object by the cost of its asset, asking once per asset', () => {
    const asked: string[] = [];
    const costOf = (a: string) => (asked.push(a), a === 'house' ? 100 : 1);
    expect(sceneCost([{ asset: 'house' }, { asset: 'tuft' }, { asset: 'tuft' }, { asset: 'house' }], costOf)).toBe(202);
    expect(asked).toEqual(['house', 'tuft']);
  });
});
