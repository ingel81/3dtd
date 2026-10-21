import { pixelDistance } from '../asset-catalog';
import { objectCost, sceneCost, type CostEntry } from './scene-cost';

const LARGE = 2048 * 2048;
const SMALL = 512 * 512;

const tuft: CostEntry = { category: 'plant', height: 0.5, file: 'm.glb', triangles: 10 };
const house: CostEntry = { category: 'building', height: 8, file: 'm.glb', triangles: 3758 };
const tree: CostEntry = { category: 'tree', height: 12, file: 'm.glb', triangles: 844 };
/** A low wall piece of 0.5 m radius */
const wall: CostEntry = { category: 'wall', height: 0.5, footprint: 0.5, file: 'm.glb', triangles: 200 };

describe('objectCost', () => {
  it('costs a house its triangles and a grass tuft next to nothing', () => {
    expect(objectCost(house, LARGE)).toBeCloseTo(3758 + 2, 0);
    // 10 triangles in the disc where its 0.3 m radius stays above 1.5 px of a 1080-line view (187 m), plus the instance
    const reach = 0.3 / ((1.5 / 540) * Math.tan(Math.PI / 6));
    expect(reach).toBeCloseTo(187, 0);
    expect(objectCost(tuft, LARGE)).toBeCloseTo(2 + (10 * Math.PI * reach * reach) / LARGE, 3);
    expect(objectCost(tuft, LARGE)).toBeLessThan(objectCost(house, LARGE) / 1000);
  });

  it('weights each band by the share of the map in it, a Small map sees a small object more often', () => {
    expect(objectCost(tuft, SMALL)).toBeGreaterThan(objectCost(tuft, LARGE));
    // A house is drawn over every map: its cost does not depend on the size
    expect(objectCost(house, SMALL)).toBeCloseTo(objectCost(house, LARGE));
  });

  it('counts the LOD models and the far impostor of a tree in their bands', () => {
    const r1 = Math.PI * 300 * 300;
    // Tree: model to max(380, 12 * 25 = 300) = 380 m, the impostor of 4 triangles beyond
    const near = Math.PI * 380 * 380;
    expect(objectCost(tree, LARGE)).toBeCloseTo(2 + (844 * near + 4 * (LARGE - near)) / LARGE, 3);
    // The house's radius is 4.8 m (its height 8 times 0.6): this screen share is 300 m out
    const at300 = 4.8 / (300 * Math.tan(Math.PI / 6));
    const withLod: CostEntry = { ...house, lod: [{ file: 'l.glb', screen: at300, triangles: 1000 }] };
    expect(objectCost(withLod, LARGE)).toBeCloseTo(2 + (3758 * r1 + 1000 * (LARGE - r1)) / LARGE, 3);
    // A LOD without its own count draws as many as the model
    expect(objectCost({ ...house, lod: [{ file: 'l.glb', screen: at300 }] }, LARGE)).toBeCloseTo(objectCost(house, LARGE));
  });

  it('adds the particles of effects, also for an entry without a model', () => {
    const fire: CostEntry = { category: 'fx', height: 1, file: '', effects: [{ kind: 'fire', rate: 25 }, { kind: 'smoke' }] };
    expect(objectCost(fire, LARGE)).toBe(2 + 25 * 20 + 20);
  });

  it('draws the piece of a line as far as the map, a piece alone to its pixel limit', () => {
    const alone = pixelDistance(0.5, 1.5);
    expect(objectCost(wall, LARGE)).toBeCloseTo(2 + (200 * Math.PI * alone * alone) / LARGE, 3);
    expect(objectCost(wall, LARGE, true)).toBeCloseTo(2 + 200, 3);
    // Only walls and structures make lines: a grouped plant still goes at its own size
    expect(objectCost(tuft, LARGE, true)).toBeCloseTo(objectCost(tuft, LARGE));
  });

  it('counts a model without a triangle count, or an unknown asset, as 500 triangles', () => {
    const { triangles: _, ...uncounted } = house;
    expect(objectCost(uncounted, SMALL)).toBeCloseTo(502);
    expect(objectCost(undefined, SMALL)).toBeCloseTo(502);
  });
});

describe('sceneCost', () => {
  it('sums every object by the cost of its asset, asking once per asset alone and once in a group', () => {
    const asked: string[] = [];
    const costOf = (a: string, grouped: boolean) => (asked.push(`${a}${grouped ? '+' : ''}`), a === 'house' ? 100 : grouped ? 5 : 1);
    const objects = [{ asset: 'house' }, { asset: 'wall' }, { asset: 'wall', group: 'g1' }, { asset: 'wall', group: 'g2' }, { asset: 'house' }];
    expect(sceneCost(objects, costOf)).toBe(211);
    expect(asked).toEqual(['house', 'wall', 'wall+']);
  });
});
