import { describe, it, expect } from 'vitest';
import {
  AlwaysStencilFunc,
  BackSide,
  DecrementWrapStencilOp,
  FrontSide,
  IncrementWrapStencilOp,
  KeepStencilOp,
  Mesh,
  NotEqualStencilFunc,
  Raycaster,
  Scene,
  Vector3,
  ZeroStencilOp,
} from 'three';
import { RangeRingKit, createRangeRingGeometry, placeRangeRing } from './range-ring';

/** The volume's corners as the vertex shader places them at unit range: inner wall at 0.9, outer at 1. */
function corners(segments: number): { points: Vector3[]; index: number[] } {
  const geometry = createRangeRingGeometry(segments);
  const position = geometry.getAttribute('position');
  const outer = geometry.getAttribute('aOuter');
  const points: Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    const radius = outer.getX(i) === 1 ? 1 : 0.9;
    points.push(new Vector3(position.getX(i) * radius, position.getY(i), position.getZ(i) * radius));
  }
  return { points, index: Array.from(geometry.getIndex()!.array) };
}

describe('range ring volume', () => {
  it('winds every face outwards, which the front and back face passes rely on', () => {
    const { points, index } = corners(16);
    const ys = points.map((p) => p.y);
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const ab = new Vector3();
    const ac = new Vector3();
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [points[index[t]], points[index[t + 1]], points[index[t + 2]]];
      const normal = ab.subVectors(b, a).cross(ac.subVectors(c, a));
      const centroid = new Vector3().add(a).add(b).add(c).divideScalar(3);
      // A point inside the volume at the same bearing
      const inside = new Vector3(centroid.x, 0, centroid.z).normalize().multiplyScalar(0.95).setY(midY);
      expect(normal.dot(centroid.sub(inside)), `triangle ${t / 3}`).toBeGreaterThan(0);
    }
  });

  it('is closed: every edge borders two faces, once in each direction', () => {
    const { index } = corners(16);
    const edges = new Map<string, number>();
    for (let t = 0; t < index.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const key = `${index[t + k]}>${index[t + ((k + 1) % 3)]}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [key, count] of edges) {
      const [from, to] = key.split('>');
      expect(count, key).toBe(1);
      expect(edges.get(`${to}>${from}`), key).toBe(1);
    }
    // 16 bearings, four quads each
    expect(index.length / 3).toBe(16 * 4 * 2);
  });
});

describe('RangeRingKit', () => {
  it('marks back, then front faces without colour, then paints where a mark stays and clears it', () => {
    const kit = new RangeRingKit();
    const [markBack, markFront, paint] = kit.materials;

    for (const mark of [markBack, markFront]) {
      expect(mark.colorWrite).toBe(false);
      expect([mark.depthTest, mark.depthWrite]).toEqual([true, false]);
      expect([mark.stencilWrite, mark.stencilFunc, mark.stencilZPass, mark.stencilFail])
        .toEqual([true, AlwaysStencilFunc, KeepStencilOp, KeepStencilOp]);
    }
    expect([markBack.side, markBack.stencilZFail]).toEqual([BackSide, IncrementWrapStencilOp]);
    expect([markFront.side, markFront.stencilZFail]).toEqual([FrontSide, DecrementWrapStencilOp]);

    expect([paint.side, paint.colorWrite, paint.depthTest, paint.depthWrite]).toEqual([BackSide, true, false, false]);
    expect([paint.stencilWrite, paint.stencilFunc, paint.stencilRef, paint.stencilZPass])
      .toEqual([true, NotEqualStencilFunc, 0, ZeroStencilOp]);

    // All three after the opaque surfaces, in pass order
    const ring = kit.create();
    const meshes = ring.children as Mesh[];
    expect(meshes.map((mesh) => mesh.material)).toEqual([markBack, markFront, paint]);
    expect(meshes.every((mesh, i) => i === 0 || mesh.renderOrder > meshes[i - 1].renderOrder)).toBe(true);
    expect(kit.materials.every((material) => material.transparent)).toBe(true);
  });

  it('gives every ring the same geometry and materials, hidden until shown', () => {
    const kit = new RangeRingKit();
    const a = kit.create().children as Mesh[];
    const ringB = kit.create();
    const b = ringB.children as Mesh[];

    expect(ringB.visible).toBe(false);
    expect(b.map((mesh) => mesh.geometry)).toEqual(a.map((mesh) => mesh.geometry));
    expect(b.map((mesh) => mesh.material)).toEqual(a.map((mesh) => mesh.material));
  });

  it('stands at the tower foot with the range as its radius and is never hit by a ray', () => {
    const kit = new RangeRingKit();
    const ring = kit.create();
    placeRangeRing(ring, 5, 10, 7, 40);
    expect(ring.position.toArray()).toEqual([5, 10, 7]);
    expect(ring.scale.toArray()).toEqual([40, 1, 40]);

    // Straight down through the band: the camera controls must not stop on it
    const scene = new Scene();
    ring.visible = true;
    scene.add(ring);
    scene.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(5 + 39.5, 500, 7), new Vector3(0, -1, 0));
    expect(ray.intersectObject(scene, true)).toEqual([]);
  });
});
