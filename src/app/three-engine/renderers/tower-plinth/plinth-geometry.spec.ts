import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  BRACE_SLOPE,
  BRACE_TOP_Y,
  createPlinthGeometry,
  PLINTH_EMBED_M,
  PLINTH_RIM_M,
  plinthWallRadius,
} from './plinth-geometry';

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

  it('keeps the wall where plinthWallRadius says', () => {
    for (let i = 0; i < segments; i++) {
      const v = vertex(segments + i);
      const theta = Math.atan2(v.z, v.x);
      expect(radial(v)).toBeCloseTo(plinthWallRadius(RADIUS, HEIGHT, theta, v.y), 5);
    }
  });
});

describe('createPlinthGeometry with braces (E18)', () => {
  const RADIUS = 3.6;
  const HEIGHT = 1.5;
  const brace = { angle: Math.PI / 4, topReach: 3.6, footReach: 1.5 };
  const plainCount = createPlinthGeometry(RADIUS, HEIGHT).getAttribute('position').count;
  const geometry = createPlinthGeometry(RADIUS, HEIGHT, [brace]);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const vertex = (i: number) => new Vector3().fromBufferAttribute(position, i);
  const normalAt = (i: number) => new Vector3().fromBufferAttribute(normal, i);
  /** After wall and top face: the bottom face (centre and a ring), then the brace, 6 faces of 4 vertices */
  const braceStart = position.count - 24;
  const braceVertices = Array.from({ length: 24 }, (_, i) => vertex(braceStart + i));
  const along = (v: Vector3) => v.x * Math.cos(brace.angle) + v.z * Math.sin(brace.angle);

  it('closes the plinth underneath with a face turned down', () => {
    expect(braceStart - plainCount).toBeGreaterThan(16);
    for (let i = plainCount; i < braceStart; i++) {
      expect(vertex(i).y).toBeCloseTo(-PLINTH_EMBED_M, 6);
      expect(normalAt(i).y).toBeCloseTo(-1, 6);
    }
  });

  it('slants the brace at BRACE_SLOPE from under the rim down to its foot', () => {
    const drop = (brace.topReach - brace.footReach) * BRACE_SLOPE;
    expect(Math.max(...braceVertices.map((v) => v.y))).toBeCloseTo(BRACE_TOP_Y, 6);
    expect(Math.min(...braceVertices.map((v) => v.y))).toBeCloseTo(BRACE_TOP_Y - drop, 6);
    expect(Math.max(...braceVertices.map(along))).toBeCloseTo(brace.topReach, 6);
    expect(Math.min(...braceVertices.map(along))).toBeCloseTo(brace.footReach, 6);
    // The lowest point is at the foot, the outer top edge is at the top
    for (const v of braceVertices) {
      if (Math.abs(v.y - (BRACE_TOP_Y - drop)) < 1e-6) expect(along(v)).toBeCloseTo(brace.footReach, 6);
      if (Math.abs(along(v) - brace.topReach) < 1e-6) expect(v.y).toBeCloseTo(BRACE_TOP_Y, 6);
    }
  });

  it('keeps the brace under the plinth: its top inside the plinth, nothing out beyond the rim', () => {
    expect(BRACE_TOP_Y).toBeGreaterThan(-PLINTH_EMBED_M);
    expect(BRACE_TOP_Y).toBeLessThan(0);
    for (const v of braceVertices) {
      expect(Math.hypot(v.x, v.z)).toBeLessThan(RADIUS + PLINTH_RIM_M);
    }
  });

  it('turns every brace face outwards', () => {
    const middle = braceVertices.reduce((sum, v) => sum.add(v), new Vector3()).divideScalar(braceVertices.length);
    for (let i = 0; i < 24; i++) {
      const v = vertex(braceStart + i);
      expect(normalAt(braceStart + i).dot(v.clone().sub(middle))).toBeGreaterThan(0);
    }
  });

  it('bounds the brace too, for culling', () => {
    const lowest = braceVertices.reduce((low, v) => (v.y < low.y ? v : low));
    expect(geometry.boundingSphere!.containsPoint(lowest)).toBe(true);
  });
});
