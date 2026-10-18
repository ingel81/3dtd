import { describe, expect, it } from 'vitest';
import type { MapObject } from '../../map-document';
import type { CatalogObject } from '../asset-catalog';
import { cableRopes, ropeHeightAt, ropeHeights } from './cable-ride';

const span = { cable: { gauge: 5.2, length: 40 } } as CatalogObject;
const entryOf = (asset: string) => (asset === 'cable-span-40' ? span : undefined);

/** A span from (0, 0) to (0, 40) on the map (its front north), rising 8 m over its length, 20 m over flat ground */
function rising(): MapObject {
  const pitch = -Math.atan2(8, 40);
  return { id: 's', asset: 'cable-span-40', x: 0, y: 20, z: 20, rotation: 0, scale: Math.hypot(40, 8) / 40, pitch };
}

describe('cable ropes', () => {
  it('runs two ropes along a span, a gauge apart, tilted with its pitch', () => {
    const ropes = cableRopes([rising(), { id: 'r', asset: 'rock', x: 0, y: 0, z: 0, rotation: 0, scale: 1 }], entryOf, () => 2);
    expect(ropes).toHaveLength(2);
    const xs = ropes.map((r) => r.a.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-2.6 * rising().scale, 5);
    expect(xs[1]).toBeCloseTo(2.6 * rising().scale, 5);
    // The south end low, the north end high: 22 m at the middle, 4 m apart from end to end
    expect(ropes[0].a.y).toBeCloseTo(0, 5);
    expect(ropes[0].b.y).toBeCloseTo(40, 5);
    expect(ropes[0].ha).toBeCloseTo(18, 5);
    expect(ropes[0].hb).toBeCloseTo(26, 5);
    expect(ropeHeightAt(ropes, { x: 2.7, y: 30 }, 1.5)).toBeCloseTo(24, 1);
    expect(ropeHeightAt(ropes, { x: 0, y: 30 }, 1.5)).toBeNull();
  });

  it('turns a span with its rotation (front east)', () => {
    const o: MapObject = { id: 's', asset: 'cable-span-40', x: 0, y: 0, z: 10, rotation: -Math.PI / 2, scale: 1 };
    const [r] = cableRopes([o], entryOf, () => 0);
    expect(Math.abs(r.b.x - r.a.x)).toBeCloseTo(40, 5);
    expect(Math.abs(r.b.y - r.a.y)).toBeCloseTo(0, 5);
  });

  it('carries a loop over the gaps between ropes, interpolated round it', () => {
    const ropes = cableRopes([rising()], entryOf, () => 2);
    const x = 2.6 * rising().scale;
    // On the rope, past its north end (a station's wheel), back on the rope
    const loop = [{ x, y: 10 }, { x, y: 30 }, { x: 0, y: 46 }, { x: -x, y: 30 }, { x: -x, y: 10 }];
    const h = ropeHeights(loop, ropes, 1.5)!;
    expect(h[0]).toBeCloseTo(20, 1);
    expect(h[1]).toBeCloseTo(24, 1);
    expect(h[2]).toBeCloseTo(24, 1);
    expect(h[4]).toBeCloseTo(20, 1);
    expect(ropeHeights([{ x: 50, y: 50 }], ropes, 1.5)).toBeNull();
  });
});
