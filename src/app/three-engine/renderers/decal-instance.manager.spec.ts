import { describe, it, expect, vi } from 'vitest';
import { BufferAttribute, Color, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
import { DecalInstanceManager } from './decal-instance.manager';

describe('DecalInstanceManager', () => {
  const create = (maxCount: number) =>
    new DecalInstanceManager(new PlaneGeometry(), new ShaderMaterial(), maxCount);
  const add = (decals: DecalInstanceManager, id: string) =>
    decals.add(id, new Vector3(), 1, 0, new Color(1, 0, 0), 1, 0, 1, 1);
  // spawnTime, Fade-Delay und Fade-Dauer in ms
  const addTimed = (
    decals: DecalInstanceManager,
    id: string,
    spawnTime: number,
    fadeDelay: number,
    fadeDuration: number,
    opacity = 1
  ) => decals.add(id, new Vector3(), 1, 0, new Color(), opacity, spawnTime, fadeDelay, fadeDuration);
  const opacityOf = (decals: DecalInstanceManager) =>
    decals.instancedMesh.geometry.getAttribute('instanceOpacity') as BufferAttribute;

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

  it('fades from the opacity it was added with and removes the decal at the end', () => {
    const decals = create(8);
    const opacity = opacityOf(decals);
    addTimed(decals, 'a', 0, 100, 100, 0.8);
    const version = opacity.version;

    decals.updateFades(50); // Delay läuft noch
    expect(opacity.version).toBe(version);
    expect(opacity.getX(0)).toBeCloseTo(0.8);

    decals.updateFades(150);
    expect(opacity.getX(0)).toBeCloseTo(0.4);

    decals.updateFades(200);
    expect(decals.getInstance('a')).toBeUndefined();
    expect(decals.instancedMesh.count).toBe(0);
  });

  it('does not walk the decals before the earliest fade is due', () => {
    const decals = create(8);
    addTimed(decals, 'a', 0, 1000, 100); // fadet 1000-1100
    addTimed(decals, 'b', 500, 1000, 100); // fadet 1500-1600
    const instances = (decals as unknown as { instances: Map<string, unknown> }).instances;
    const walk = vi.spyOn(instances, 'values');

    for (let now = 0; now < 1000; now += 16) decals.updateFades(now);
    expect(walk).not.toHaveBeenCalled();

    decals.updateFades(1050); // a fadet
    decals.updateFades(1100); // a ist durch, b wartet bis 1500
    expect(walk).toHaveBeenCalledTimes(2);
    expect(decals.getInstance('a')).toBeUndefined();

    for (let now = 1116; now < 1500; now += 16) decals.updateFades(now);
    expect(walk).toHaveBeenCalledTimes(2);

    decals.updateFades(1600);
    expect(decals.count).toBe(0);
  });

  it('wakes up for a decal added after the loop went idle', () => {
    const decals = create(8);
    addTimed(decals, 'a', 0, 1000, 100);
    decals.updateFades(10);
    addTimed(decals, 'b', 20, 10, 100); // fadet ab 30, vor a

    decals.updateFades(80);
    expect(decals.getInstance('b')).toBeDefined();
    expect(opacityOf(decals).getX(decals.getInstance('b')!.index)).toBeCloseTo(0.5);
  });
});
