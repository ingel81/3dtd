import { describe, it, expect, vi } from 'vitest';
import { BufferAttribute, Color, Matrix4, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';
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

  it('evicts the oldest decal when they share one fade delay', () => {
    const decals = create(2);
    decals.removeNextToFade(); // leerer Pool, nichts zu tun
    addTimed(decals, 'b', 10, 1000, 100);
    addTimed(decals, 'a', 0, 1000, 100);

    decals.removeNextToFade();
    expect(decals.getInstance('a')).toBeUndefined();
    expect(decals.getInstance('b')).toBeDefined();

    addTimed(decals, 'c', 20, 1000, 100);
    decals.removeNextToFade();
    expect(decals.getInstance('b')).toBeUndefined();
    expect(decals.getInstance('c')).toBeDefined();
    expect(decals.count).toBe(1);
  });

  it('evicts the decal whose fade comes first, not the oldest, when the delays differ', () => {
    const decals = create(4);
    addTimed(decals, 'long', 0, 5000, 100); // fadet ab 5000
    addTimed(decals, 'short', 10, 1000, 100); // fadet ab 1010
    decals.removeNextToFade();
    expect(decals.getInstance('short')).toBeUndefined();
    expect(decals.getInstance('long')).toBeDefined();
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

  it('reinforces a decal from what it shows, capped, and restarts its fade', () => {
    const decals = create(8);
    const opacity = opacityOf(decals);
    addTimed(decals, 'a', 0, 100, 100, 0.5); // fadet 100-200
    expect(decals.reinforce('a', 0.2, 0.8, 50, 100)).toBe(true); // fadet jetzt 150-250
    expect(opacity.getX(0)).toBeCloseTo(0.7);

    decals.updateFades(149);
    expect(opacity.getX(0)).toBeCloseTo(0.7);
    decals.updateFades(200);
    expect(opacity.getX(0)).toBeCloseTo(0.35);

    decals.reinforce('a', 0.2, 0.8, 200, 100); // vom ausgeblendeten Wert aus
    expect(opacity.getX(0)).toBeCloseTo(0.55);
    decals.reinforce('a', 0.5, 0.8, 200, 100);
    expect(opacity.getX(0)).toBeCloseTo(0.8);
    expect(decals.reinforce('missing', 0.1, 1, 0, 0)).toBe(false);
  });

  it('treats a reinforced decal as the youngest for removeNextToFade', () => {
    const decals = create(4);
    addTimed(decals, 'a', 0, 1000, 100);
    addTimed(decals, 'b', 10, 1000, 100);
    decals.reinforce('a', 0.1, 1, 20, 1000);
    decals.removeNextToFade();
    expect(decals.getInstance('b')).toBeUndefined();
    expect(decals.getInstance('a')).toBeDefined();
  });

  it('scales the quad to a round decal of the given radius', () => {
    const decals = create(4);
    decals.add('round', new Vector3(), 3, 1.2, new Color(), 1, 0, 1, 1);
    const matrix = new Matrix4();
    const scale = new Vector3();

    decals.instancedMesh.getMatrixAt(0, matrix);
    scale.setFromMatrixScale(matrix);
    expect(scale.x).toBeCloseTo(3);
    expect(scale.z).toBeCloseTo(3);
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

  it('stays out of the render list while no decal is placed', () => {
    const decals = create(8);
    expect(decals.instancedMesh.visible).toBe(false);

    addTimed(decals, 'a', 0, 10, 10);
    expect(decals.instancedMesh.visible).toBe(true);
    decals.updateFades(100); // faded out and removed
    expect(decals.count).toBe(0);
    expect(decals.instancedMesh.visible).toBe(false);

    add(decals, 'b');
    decals.clear();
    expect(decals.instancedMesh.visible).toBe(false);
  });
});
