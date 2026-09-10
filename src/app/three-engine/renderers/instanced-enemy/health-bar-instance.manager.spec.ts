import { describe, it, expect, beforeEach } from 'vitest';
import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Mesh,
  PerspectiveCamera,
  Scene,
  Vector3,
} from 'three';
import { HealthBarInstanceManager } from './health-bar-instance.manager';

describe('HealthBarInstanceManager', () => {
  let bars: HealthBarInstanceManager;
  let meshes: Mesh[];

  const add = (id: string) => bars.add(id, new Vector3(), 2, false, null, 6, 1);
  const attribute = (name: string) =>
    meshes[0].geometry.getAttribute(name) as InstancedBufferAttribute;
  /** Instances each of the two passes draws. */
  const drawCounts = () => meshes.map((m) => (m.geometry as InstancedBufferGeometry).instanceCount);

  beforeEach(() => {
    const scene = new Scene();
    bars = new HealthBarInstanceManager(scene);
    meshes = scene.children as Mesh[];
  });

  it('draws both passes from one instanced geometry, without an instanceMatrix', () => {
    expect(meshes).toHaveLength(2);
    expect(meshes[1].geometry).toBe(meshes[0].geometry);
    expect(meshes[0].geometry).toBeInstanceOf(InstancedBufferGeometry);
    for (const mesh of meshes) {
      expect(mesh).not.toBeInstanceOf(InstancedMesh);
      expect('instanceMatrix' in mesh).toBe(false);
      expect(mesh.frustumCulled).toBe(false);
    }
    expect(drawCounts()).toEqual([0, 0]);
  });

  it('shrinks the draw count when the top bars are removed', () => {
    expect([add('a'), add('b'), add('c')]).toEqual([0, 1, 2]);
    expect(drawCounts()).toEqual([3, 3]);

    bars.remove('b'); // a hole, c still holds the top slot
    expect(drawCounts()).toEqual([3, 3]);
    bars.remove('c');
    expect(drawCounts()).toEqual([1, 1]);

    expect(add('d')).toBe(1);
    expect(drawCounts()).toEqual([2, 2]);

    bars.remove('a');
    bars.remove('d');
    expect(drawCounts()).toEqual([0, 0]);
  });

  it('uploads only the drawn slice of the per-frame buffers', () => {
    add('a');
    add('b');
    add('c');
    bars.remove('c');
    bars.remove('b');

    bars.updateAt(0, new Vector3(1, 2, 3), 2, 0.5, 6, 1);
    bars.updateBillboard(new PerspectiveCamera());

    expect(attribute('aCenter').updateRanges).toEqual([{ start: 0, count: 3 }]);
    expect(attribute('aHealth').updateRanges).toEqual([{ start: 0, count: 1 }]);
  });
});
