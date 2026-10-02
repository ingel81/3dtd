import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { SCAFFOLD_DISMANTLE_MS, TowerBuild, layerCount, layeredHeight } from './tower-scaffold';

describe('layeredHeight', () => {
  it('grows from nothing to the top, course by course, never back', () => {
    expect(layeredHeight(0, 4)).toBe(0);
    expect(layeredHeight(1, 4)).toBe(1);
    // A course rises early in its slot and then holds
    expect(layeredHeight(0.2, 4)).toBeCloseTo(0.25, 6);
    expect(layeredHeight(0.24, 4)).toBeCloseTo(0.25, 6);
    let last = 0;
    for (let p = 0; p <= 1; p += 0.01) {
      const h = layeredHeight(p, 5);
      expect(h).toBeGreaterThanOrEqual(last - 1e-12);
      last = h;
    }
  });

  it('builds a taller tower in more courses', () => {
    expect(layerCount(4)).toBe(3);
    expect(layerCount(15)).toBe(6);
  });
});

describe('TowerBuild', () => {
  function model(): { root: Group; material: MeshStandardMaterial } {
    const material = new MeshStandardMaterial();
    const mesh = new Mesh(new BoxGeometry(2, 10, 2), material);
    mesh.position.y = 5;
    const root = new Group();
    root.add(mesh);
    return { root, material };
  }

  it('cuts the model off at its course, puts up a scaffold and takes both away when it stands', () => {
    const scene = new Group();
    const { root, material } = model();
    scene.add(root);
    const build = new TowerBuild(scene, root, 3, 5000, 5000);
    expect(scene.children).toHaveLength(2);
    const plane = material.clippingPlanes![0];
    expect(plane.constant).toBeCloseTo(0, 6);

    build.update(2500);
    const half = plane.constant;
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(10);
    // The end waits for the simulation
    build.update(10_000);
    expect(material.clippingPlanes).not.toBeNull();
    expect(plane.constant).toBeLessThanOrEqual(10);

    build.set(0, 5000);
    expect(material.clippingPlanes).toBeNull();
    build.update(SCAFFOLD_DISMANTLE_MS);
    expect(build.finished).toBe(true);
    build.dispose();
    expect(scene.children).toEqual([root]);
  });
});
