import { createMapDocument } from '../../world/custom-map/map-create';
import { measureLine } from '../tools/measure-tool';
import { contourLines } from './contours';
import { raiseDab } from './terrain-ops';

describe('height lines and measuring', () => {
  it('draws a closed ring of lines around a hill, every fifth level major', () => {
    const t = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, cellSize: 2, starter: false }).terrain;
    raiseDab(t, 0, 0, { radius: 40, strength: 1, falloff: 1 }, 26);
    const c = contourLines(t, 5);
    expect(c.minor.length).toBeGreaterThan(0);
    expect(c.major.length).toBeGreaterThan(0);
    // Every segment end lies at its level
    for (let k = 0; k < c.minor.length; k += 3) expect(c.minor[k + 2] % 5).toBe(0);
    expect(contourLines(createMapDocument({ id: 'f', name: 'F', width: 50, depth: 50 }).terrain, 5).minor.length).toBe(0);
  });

  it('measures along the ground longer than on the map over a hill', () => {
    const t = createMapDocument({ id: 'm', name: 'M', width: 200, depth: 200, cellSize: 2, starter: false }).terrain;
    raiseDab(t, 0, 0, { radius: 30, strength: 1, falloff: 1 }, 20);
    const r = measureLine(t, [{ x: -60, y: 0 }, { x: 60, y: 0 }]);
    expect(r.flat).toBeCloseTo(120);
    expect(r.ground).toBeGreaterThan(r.flat);
    expect(r.climb).toBeCloseTo(r.drop, 0);
    expect(r.climb).toBeGreaterThan(15);
  });
});
