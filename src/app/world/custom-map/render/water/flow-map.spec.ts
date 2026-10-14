import { HeightField } from '../height-field';
import { bakeFlowMap, decodeFlow } from './flow-map';
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

const at = (flow: Uint8Array, i: number, j: number): [number, number] => decodeFlow(flow[(j * 101 + i) * 2], flow[(j * 101 + i) * 2 + 1]);

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
