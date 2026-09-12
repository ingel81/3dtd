import { describe, it, expect, beforeEach } from 'vitest';
import { BoxGeometry, Euler, MeshBasicMaterial, Vector3 } from 'three';
import { createRocketGeometry, ProjectileInstanceManager } from './three-projectile.renderer';
import { PROJECTILE_TYPES } from '../../configs/projectile-types.config';

describe('createRocketGeometry', () => {
  const geometry = createRocketGeometry();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;

  it('points the nose along +Y, centred on the projectile position', () => {
    expect(box.max.y).toBeCloseTo(-box.min.y, 5);
    expect(box.max.y - box.min.y).toBeGreaterThan(3.5); // readable length
  });

  it('starts the trail at the nozzle', () => {
    const rocket = PROJECTILE_TYPES.rocket;
    expect(rocket.tailOffset).toBeCloseTo(-box.min.y * rocket.scale, 5);
  });

  it('colours every vertex (one material, one draw call)', () => {
    expect(geometry.getAttribute('color').count).toBe(geometry.getAttribute('position').count);
    expect(geometry.groups).toHaveLength(0);
  });
});

describe('ProjectileInstanceManager', () => {
  let manager: ProjectileInstanceManager;
  const scale = new Vector3(1, 1, 1);
  const add = (id: string) => manager.add(id, new Vector3(), new Euler(), scale);

  beforeEach(() => {
    manager = new ProjectileInstanceManager(new BoxGeometry(), new MeshBasicMaterial(), 4);
  });

  it('shrinks the draw count when the top projectiles are removed', () => {
    add('a');
    add('b');
    add('c');
    const mesh = manager.instancedMesh;
    expect(mesh.count).toBe(3);

    manager.remove('b'); // a hole, c still holds the top slot
    expect(mesh.count).toBe(3);
    manager.remove('c');
    expect(mesh.count).toBe(1);

    add('d');
    expect(mesh.count).toBe(2);
    manager.clear();
    expect(mesh.count).toBe(0);
    expect(manager.count).toBe(0);
  });

  it('uploads one range over the drawn slots per flush', () => {
    add('a');
    add('b');
    add('c');
    const matrix = manager.instancedMesh.instanceMatrix;
    const version = matrix.version;
    manager.updatePosition('a', new Vector3(1, 2, 3));
    manager.update('b', new Vector3(4, 5, 6), new Euler(0.1, 0.2, 0.3));
    expect(matrix.version).toBe(version); // nothing uploads before the flush

    manager.flush();
    expect(matrix.version).toBe(version + 1);
    expect(matrix.updateRanges).toEqual([{ start: 0, count: 48 }]);

    manager.remove('c');
    manager.flush();
    expect(matrix.updateRanges).toEqual([{ start: 0, count: 32 }]);

    manager.flush(); // nothing written since
    expect(matrix.version).toBe(version + 2);
  });

  it('adds no zero-length range once every projectile is gone', () => {
    add('a');
    manager.flush();
    const matrix = manager.instancedMesh.instanceMatrix;
    matrix.clearUpdateRanges(); // stands in for the upload
    const version = matrix.version;

    manager.remove('a');
    manager.flush();
    // (0, 0) would make three upload the whole buffer.
    expect(matrix.updateRanges).toEqual([]);
    expect(matrix.version).toBe(version);
  });

  it('skips projectiles beyond the pool size instead of drawing past the buffer', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) add(id);
    expect(manager.count).toBe(4);
    expect(manager.instancedMesh.count).toBe(4);

    manager.remove('e'); // never placed: no-op
    manager.remove('a');
    add('f');
    expect(manager.count).toBe(4);
  });

  it('stays out of the render list while no projectile is in flight', () => {
    const mesh = manager.instancedMesh;
    expect(mesh.visible).toBe(false);

    add('a');
    add('b');
    expect(mesh.visible).toBe(true);
    manager.remove('a');
    expect(mesh.visible).toBe(true);
    manager.remove('b');
    expect(mesh.visible).toBe(false);

    add('c');
    manager.clear();
    expect(mesh.visible).toBe(false);
  });
});
