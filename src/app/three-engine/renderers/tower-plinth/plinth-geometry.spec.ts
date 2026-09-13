import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createPlinthGeometry, PLINTH_EMBED_M, PLINTH_RIM_M } from './plinth-geometry';

describe('createPlinthGeometry', () => {
  const RADIUS = 3.6;
  const HEIGHT = 2.5;
  const geometry = createPlinthGeometry(RADIUS, HEIGHT);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const vertex = (i: number) => new Vector3().fromBufferAttribute(position, i);
  const radial = (v: Vector3) => Math.hypot(v.x, v.z);

  /** The top face comes last: its centre and one ring as wide as the bottom ring. */
  const bottomRing = Array.from({ length: position.count }, (_, i) => vertex(i))
    .filter((v) => Math.abs(v.y + PLINTH_EMBED_M) < 1e-6);
  const segments = bottomRing.length;
  const capStart = position.count - (segments + 1);

  it('reaches from below the lowest point of the footprint up to the foot', () => {
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.y).toBeCloseTo(-PLINTH_EMBED_M, 6);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(HEIGHT, 6);
    expect(geometry.boundingSphere).not.toBeNull();
  });

  it('is as wide as the footprint plus the rim at the top and leans out towards the foot', () => {
    const top = Array.from({ length: capStart }, (_, i) => vertex(i)).filter((v) => Math.abs(v.y - HEIGHT) < 1e-6);
    const mean = (vs: Vector3[]) => vs.reduce((sum, v) => sum + radial(v), 0) / vs.length;

    expect(top).toHaveLength(segments);
    for (const v of top) {
      expect(radial(v)).toBeGreaterThan((RADIUS + PLINTH_RIM_M) * 0.97);
      expect(radial(v)).toBeLessThan((RADIUS + PLINTH_RIM_M) * 1.03);
    }
    expect(mean(bottomRing)).toBeGreaterThan(mean(top) + 0.1);
  });

  it('turns the wall outwards and the top face up', () => {
    const n = new Vector3();
    for (let i = 0; i < capStart; i++) {
      const v = vertex(i);
      n.fromBufferAttribute(normal, i);
      expect(n.x * v.x + n.z * v.z).toBeGreaterThan(0);
    }
    for (let i = capStart; i < position.count; i++) {
      n.fromBufferAttribute(normal, i);
      expect(n.y).toBeCloseTo(1, 6);
    }
  });

  it('closes the wall without a seam: every wall vertex is shared by six triangles', () => {
    const index = geometry.getIndex()!;
    const uses = new Array<number>(position.count).fill(0);
    for (let i = 0; i < index.count; i++) uses[index.getX(i)]++;
    const middleRing = uses.slice(segments, 2 * segments);
    expect(middleRing.every((u) => u === 6)).toBe(true);
  });

  it('gets more segments on a wider footprint', () => {
    const narrow = createPlinthGeometry(2.4, HEIGHT).getAttribute('position').count;
    const wide = createPlinthGeometry(10, HEIGHT).getAttribute('position').count;
    expect(wide).toBeGreaterThan(narrow * 3);
  });
});
