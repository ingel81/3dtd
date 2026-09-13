import { describe, expect, it, vi } from 'vitest';
import { Group, Mesh, MeshStandardMaterial } from 'three';
import { TowerPlinthPreview } from './tower-plinth-preview';

describe('TowerPlinthPreview', () => {
  const setup = () => {
    const parent = new Group();
    const preview = new TowerPlinthPreview();
    const mesh = () => parent.children[0] as Mesh | undefined;
    const material = () => mesh()!.material as MeshStandardMaterial;
    return { parent, preview, mesh, material };
  };

  it('stands a see-through plinth under the foot, tinted like the preview tower', () => {
    const { parent, preview, mesh, material } = setup();
    preview.show(parent, 4, 12, -3, 3.6, 2.5, true);

    expect(mesh()!.visible).toBe(true);
    expect(mesh()!.position.toArray()).toEqual([4, 9.5, -3]);
    expect(material().transparent).toBe(true);
    expect(material().opacity).toBeCloseTo(0.7);
    expect(material().depthWrite).toBe(false);
    expect(material().emissive.g).toBeGreaterThan(material().emissive.r);

    preview.show(parent, 4, 12, -3, 3.6, 2.5, false);
    expect(material().emissive.r).toBeGreaterThan(material().emissive.g);
  });

  it('hides on even ground and comes back with the next plinth', () => {
    const { parent, preview, mesh } = setup();
    preview.show(parent, 0, 5, 0, 3.6, 1, true);
    preview.show(parent, 0, 5, 0, 3.6, 0, true);
    expect(mesh()!.visible).toBe(false);

    preview.show(parent, 0, 5, 0, 3.6, 1, true);
    expect(mesh()!.visible).toBe(true);
  });

  it('only builds a new mesh when the footprint asks for another height or width', () => {
    const { parent, preview, mesh } = setup();
    preview.show(parent, 0, 5, 0, 3.6, 1, true);
    const first = mesh()!;
    const dispose = vi.spyOn(first.geometry, 'dispose');

    preview.show(parent, 8, 6, 2, 3.6, 1, true);
    expect(mesh()).toBe(first);
    expect(first.position.toArray()).toEqual([8, 5, 2]);

    preview.show(parent, 8, 6, 2, 3.6, 1.5, true);
    expect(dispose).toHaveBeenCalled();
    expect(parent.children).toHaveLength(1);
    expect(mesh()).not.toBe(first);
    // The new mesh keeps the look of the preview.
    expect((mesh()!.material as MeshStandardMaterial).transparent).toBe(true);
  });

  it('takes the plinth down and frees it on dispose', () => {
    const { parent, preview, mesh, material } = setup();
    preview.show(parent, 0, 5, 0, 3.6, 1, true);
    const geometryDispose = vi.spyOn(mesh()!.geometry, 'dispose');
    const materialDispose = vi.spyOn(material(), 'dispose');

    preview.dispose();

    expect(parent.children).toHaveLength(0);
    expect(geometryDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    expect(() => preview.dispose()).not.toThrow();
  });
});
