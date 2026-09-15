import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import {
  BRACE_COURSES,
  BRACE_TOP_Y,
  BRACE_WIDTH_M,
  braceCourse,
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

describe('createPlinthGeometry with a corbel (E18)', () => {
  const RADIUS = 3.6;
  const HEIGHT = 1.5;
  const brace = { angle: Math.PI / 4, offset: 0.4, topReach: 3.3, edgeReach: 2.1, footReach: 1.2 };
  const { step, height } = braceCourse(brace);
  const plainCount = createPlinthGeometry(RADIUS, HEIGHT).getAttribute('position').count;
  const geometry = createPlinthGeometry(RADIUS, HEIGHT, [brace]);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex()!;
  const vertex = (i: number) => new Vector3().fromBufferAttribute(position, i);
  const normalAt = (i: number) => new Vector3().fromBufferAttribute(normal, i);
  /**
   * After wall and top face: the bottom face (centre and a ring), then the
   * corbel, a face per side of its profile (2 + 2 per course) and a
   * rectangle per course on each side, 4 vertices each
   */
  const corbelQuads = 2 + 2 * BRACE_COURSES + 2 * BRACE_COURSES;
  const corbelStart = position.count - corbelQuads * 4;
  const corbel = Array.from({ length: corbelQuads * 4 }, (_, i) => vertex(corbelStart + i));
  const along = (v: Vector3) => v.x * Math.cos(brace.angle) + v.z * Math.sin(brace.angle);
  const across = (v: Vector3) => -v.x * Math.sin(brace.angle) + v.z * Math.cos(brace.angle);
  const lowest = -PLINTH_EMBED_M - BRACE_COURSES * height;

  it('closes the plinth underneath with a face turned down', () => {
    expect(corbelStart - plainCount).toBeGreaterThan(16);
    for (let i = plainCount; i < corbelStart; i++) {
      expect(vertex(i).y).toBeCloseTo(-PLINTH_EMBED_M, 6);
      expect(normalAt(i).y).toBeCloseTo(-1, 6);
    }
  });

  it('steps the corbel out course by course from its flat underside to the front face under the rim', () => {
    // A course is as high as it steps out: 1.2 m from the roof's edge to the front in three courses
    expect(step).toBeCloseTo(0.4, 9);
    expect(height).toBeCloseTo(0.4, 9);
    expect(Math.max(...corbel.map((v) => v.y))).toBeCloseTo(BRACE_TOP_Y, 6);
    expect(Math.min(...corbel.map((v) => v.y))).toBeCloseTo(lowest, 6);
    expect(Math.max(...corbel.map(along))).toBeCloseTo(brace.topReach, 6);
    expect(Math.min(...corbel.map(along))).toBeCloseTo(brace.footReach, 6);

    // The flat underside of the lowest course, from the back to its front
    const underside = corbel.filter((v) => Math.abs(v.y - lowest) < 1e-6).map(along);
    expect(Math.min(...underside)).toBeCloseTo(brace.footReach, 6);
    expect(Math.max(...underside)).toBeCloseTo(brace.topReach - (BRACE_COURSES - 1) * step, 6);
    // The front face goes one course down below the plinth
    const front = corbel.filter((v) => Math.abs(along(v) - brace.topReach) < 1e-6).map((v) => v.y);
    expect(Math.min(...front)).toBeCloseTo(-PLINTH_EMBED_M - height, 6);
    // Each course reaches one step further out than the one below
    for (let k = 1; k <= BRACE_COURSES; k++) {
      const course = corbel.filter((v) => Math.abs(v.y - (-PLINTH_EMBED_M - k * height)) < 1e-6).map(along);
      expect(Math.max(...course)).toBeCloseTo(brace.topReach - (k - 1) * step, 6);
    }
  });

  it('is BRACE_WIDTH_M across, centred on its offset', () => {
    expect(Math.min(...corbel.map(across))).toBeCloseTo(brace.offset - BRACE_WIDTH_M / 2, 6);
    expect(Math.max(...corbel.map(across))).toBeCloseTo(brace.offset + BRACE_WIDTH_M / 2, 6);
  });

  it('keeps the corbel under the plinth: its top inside the plinth, nothing out beyond the rim', () => {
    expect(BRACE_TOP_Y).toBeGreaterThan(-PLINTH_EMBED_M);
    expect(BRACE_TOP_Y).toBeLessThan(0);
    for (const v of corbel) {
      expect(Math.hypot(v.x, v.z)).toBeLessThan(RADIUS + PLINTH_RIM_M);
    }
  });

  it('turns every face outwards: its faces enclose the volume of the block', () => {
    let volume = 0;
    for (let i = index.count - corbelQuads * 6; i < index.count; i += 3) {
      const [a, b, c] = [vertex(index.getX(i)), vertex(index.getX(i + 1)), vertex(index.getX(i + 2))];
      volume += a.dot(b.clone().cross(c)) / 6;
    }
    const top = BRACE_TOP_Y - (-PLINTH_EMBED_M - height);
    const profile = (brace.topReach - brace.footReach) * top
      + (brace.topReach - step - brace.footReach) * height
      + (brace.topReach - 2 * step - brace.footReach) * height;
    expect(volume).toBeCloseTo(profile * BRACE_WIDTH_M, 5);
  });

  it('bounds the corbel too, for culling', () => {
    const low = corbel.reduce((a, v) => (v.y < a.y ? v : a));
    expect(geometry.boundingSphere!.containsPoint(low)).toBe(true);
  });
});
