import { describe, it, expect, beforeEach } from 'vitest';
import { BoxGeometry, Euler, MeshBasicMaterial, Vector3 } from 'three';
import { ProjectileInstanceManager } from './three-projectile.renderer';

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

  it('skips projectiles beyond the pool size instead of drawing past the buffer', () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) add(id);
    expect(manager.count).toBe(4);
    expect(manager.instancedMesh.count).toBe(4);

    manager.remove('e'); // never placed: no-op
    manager.remove('a');
    add('f');
    expect(manager.count).toBe(4);
  });
});
