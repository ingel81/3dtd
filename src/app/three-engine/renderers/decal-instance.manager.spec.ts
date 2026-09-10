import { describe, it, expect } from 'vitest';
import { Color, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import { DecalInstanceManager } from './decal-instance.manager';

describe('DecalInstanceManager', () => {
  const create = (maxCount: number) =>
    new DecalInstanceManager(new PlaneGeometry(), new ShaderMaterial(), maxCount);
  const add = (decals: DecalInstanceManager, id: string) =>
    decals.add(id, new Vector3(), 1, 0, new Color(1, 0, 0), 1, 0, 1, 1);

  it('shrinks the draw count when the top decals are removed', () => {
    const decals = create(8);
    for (const id of ['a', 'b', 'c']) add(decals, id);
    expect(decals.instancedMesh.count).toBe(3);

    decals.remove('b'); // a hole, c still holds the top slot
    expect(decals.instancedMesh.count).toBe(3);
    decals.remove('c');
    expect(decals.instancedMesh.count).toBe(1);

    add(decals, 'd');
    expect(decals.getInstance('d')!.index).toBe(1);
    expect(decals.instancedMesh.count).toBe(2);

    decals.clear();
    expect(decals.instancedMesh.count).toBe(0);
    expect(decals.count).toBe(0);
  });

  it('skips a decal beyond the pool size instead of drawing past the buffer', () => {
    const decals = create(2);
    for (const id of ['a', 'b', 'c']) add(decals, id);
    expect(decals.count).toBe(2);
    expect(decals.getInstance('c')).toBeUndefined();
    expect(decals.instancedMesh.count).toBe(2);
  });
});
