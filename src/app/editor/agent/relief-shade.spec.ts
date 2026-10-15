import { createMapDocument } from '../../world/custom-map/map-create';
import { heightAt } from '../model/grid';
import { shadeRelief } from './relief-shade';

describe('shadeRelief', () => {
  it('lights slopes facing north-west, darkens those facing south-east and leaves flat ground as it is', () => {
    const doc = createMapDocument({ id: 'm', name: 'M', width: 128, depth: 128, cellSize: 2, starter: false, now: new Date(0) });
    const g = doc.terrain.grid;
    g.heights.fill(0);
    // A round hill of 20 m in the middle
    for (let j = 0; j < g.rows; j++) {
      for (let i = 0; i < g.columns; i++) {
        const x = i * g.cellSize - 64;
        const y = j * g.cellSize - 64;
        g.heights[j * g.columns + i] = Math.max(0, 20 - Math.hypot(x, y) * 0.6);
      }
    }
    expect(heightAt(doc.terrain, 0, 0)).toBeCloseTo(20, 0);
    const size = 64;
    const pixels = new Uint8ClampedArray(size * size * 4).fill(100);
    shadeRelief(pixels, size, size, doc.terrain);
    const at = (x: number, y: number) => pixels[(Math.floor(((64 - y) / 128) * size) * size + Math.floor(((x + 64) / 128) * size)) * 4];
    // North-west flank, south-east flank, flat corner
    expect(at(-12, 12)).toBeGreaterThan(110);
    expect(at(12, -12)).toBeLessThan(90);
    expect(at(60, -60)).toBe(100);
  });
});
