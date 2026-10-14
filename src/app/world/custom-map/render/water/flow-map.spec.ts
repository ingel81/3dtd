import { HeightField } from '../height-field';
import { bakeFlow, bakeFlowMap, bakeFlowOffThread, decodeFlow, flowInput, SHORE_FIELD_MAX, SLOPE_FIELD_MAX } from './flow-map';
import type { MapWater } from '../../map-document';

/** A round lake (radius 40 m, 20 cells) of 2 m cells on a 101² grid, an island of 10 m in its middle */
function lake(kind: MapWater['kind']): { field: HeightField; water: MapWater } {
  const n = 101;
  const heights = new Float32Array(n * n);
  const mask = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(i - 50, j - 50) * 2;
      const wet = r < 40 && r > 10;
      heights[j * n + i] = wet ? -2 : 1;
      mask[j * n + i] = r < 40 ? 255 : 0;
    }
  }
  const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights }, 200, 200);
  return { field, water: { level: 0, mask, color: '#336655', kind } };
}

const at = (flow: Uint8Array, i: number, j: number): [number, number] => decodeFlow(flow[(j * 101 + i) * 4], flow[(j * 101 + i) * 4 + 1]);
/** Distance to the shore (m) and the bank's slope at a sample */
const shore = (flow: Uint8Array, i: number, j: number): [number, number] => [
  (flow[(j * 101 + i) * 4 + 2] / 255) * SHORE_FIELD_MAX,
  (flow[(j * 101 + i) * 4 + 3] / 255) * SLOPE_FIELD_MAX,
];

/** A square pool (cells 20 to 80) of 2 m cells: a quay wall on its west side, a beach rising 0.2 m per metre on the others */
function pool(): { field: HeightField; water: MapWater } {
  const n = 101;
  const heights = new Float32Array(n * n);
  const mask = new Uint8Array(n * n).fill(255);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      // Metres into the pool from its nearest side, negative outside
      const into = Math.min(i - 20, 80 - i, j - 20, 80 - j) * 2;
      heights[j * n + i] = i < 20 ? 3 : i - 20 <= Math.min(80 - i, j - 20, 80 - j) ? -3 : Math.max(-3, -into * 0.2);
    }
  }
  const field = new HeightField({ columns: n, rows: n, cellSize: 2, heights }, 200, 200);
  return { field, water: { level: 0, mask, color: '#336655', kind: 'sea' } };
}

describe('bakeFlowMap', () => {
  it('runs water along its banks, still at the bank and on land', () => {
    const { field, water } = lake('water');
    const flow = bakeFlowMap(field, water);
    // On land, and right at the outer bank: still
    expect(Math.hypot(...at(flow, 0, 0))).toBeLessThan(0.02);
    // Between island and outer bank, east of the middle: along the circle (no radial part)
    const [fx, fz] = at(flow, 50 + 12, 50);
    expect(Math.hypot(fx, fz)).toBeGreaterThan(0.05);
    expect(Math.abs(fx)).toBeLessThan(Math.abs(fz) * 0.3);
  });

  it('turns lava over in cells that neither gather nor tear the crust', () => {
    const { field, water } = lake('lava');
    const flow = bakeFlowMap(field, water);
    // Divergence over the open lava (1/s) times the cell scale (about 5 m) stays small against the speeds
    let div = 0;
    let speed = 0;
    let count = 0;
    for (let j = 44; j < 57; j++) {
      for (let i = 57; i < 66; i++) {
        const [ax] = at(flow, i - 1, j);
        const [bx] = at(flow, i + 1, j);
        const [, az] = at(flow, i, j - 1);
        const [, bz] = at(flow, i, j + 1);
        // Scene x runs against map x (the grid's i): its change along +i is minus the scene derivative
        div += Math.abs((ax - bx) / 4 + (bz - az) / 4);
        speed += Math.hypot(...at(flow, i, j)) / 2;
        count++;
      }
    }
    expect(speed / count).toBeGreaterThan(0.03);
    expect((div / count) * 5).toBeLessThan((speed / count) * 0.3);
  });
});

describe('the shore field', () => {
  it('gives the distance to the shore in metres, its lines rounded at the corners', () => {
    const { field, water } = lake('sea');
    const flow = bakeFlowMap(field, water);
    // Out from the outer bank (r 40 m, cell 20 east) towards the island the distance grows
    const d = [19, 17, 15].map((i) => shore(flow, 50 + i, 50)[0]);
    expect(d[0]).toBeLessThan(d[1]);
    expect(d[1]).toBeLessThan(d[2]);
    expect(d[0]).toBeLessThan(3);
    // A square pool's corner: 6 cells in from both sides reads nearer the shore than 6 cells in from one side
    const sq = bakeFlowMap(pool().field, pool().water);
    expect(shore(sq, 74, 74)[0]).toBeLessThan(shore(sq, 74, 50)[0] - 1);
  });

  it('tells a quay wall from a beach', () => {
    const { field, water } = pool();
    const flow = bakeFlowMap(field, water);
    // Just off the west wall (6 m up in one cell) against just off the east beach
    expect(shore(flow, 22, 50)[1]).toBeGreaterThan(1.5);
    expect(shore(flow, 77, 50)[1]).toBeLessThan(0.5);
  });
});

describe('bakeFlowOffThread', () => {
  it('bakes from copies what the page bakes from the map, and the copies leave the map alone', async () => {
    for (const kind of ['water', 'lava'] as const) {
      const { field, water } = lake(kind);
      const input = flowInput(field, water, true);
      expect(input.heights).not.toBe(field.grid.heights);
      expect(input.mask).not.toBe(water.mask);
      const here = bakeFlowMap(field, water);
      expect(bakeFlow(input)).toEqual(here);
      // Without workers (tests) it bakes inline, with the same result
      expect(await bakeFlowOffThread(flowInput(field, water, true))).toEqual(here);
    }
  });
});
