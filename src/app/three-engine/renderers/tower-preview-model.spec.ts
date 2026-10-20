import { describe, it, expect, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { buildPreviewModel, makeModelTransparent, PREVIEW_OPACITY, tintPreviewModel } from './tower-preview-model';

const model = () => {
  const root = new Group();
  const single = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  const multi = new Mesh(new BoxGeometry(), [new MeshStandardMaterial(), new MeshBasicMaterial()]);
  const nested = new Group();
  nested.add(multi);
  root.add(single, nested);
  return { root, single, multi };
};

describe('tower preview model', () => {
  it('makes every material see-through without depth writes, nested and in arrays', () => {
    const { root, single, multi } = model();
    makeModelTransparent(root, 0.7);

    const materials = [single.material, ...(multi.material as MeshStandardMaterial[])] as MeshStandardMaterial[];
    for (const mat of materials) {
      expect(mat.transparent).toBe(true);
      expect(mat.opacity).toBeCloseTo(0.7);
      expect(mat.depthWrite).toBe(false);
    }
  });

  it('tints green for a valid spot and red for an invalid one', () => {
    const { root, single } = model();
    const mat = single.material as MeshStandardMaterial;

    tintPreviewModel(root, true);
    expect(mat.emissive.g).toBeGreaterThan(mat.emissive.r);
    expect(mat.emissiveIntensity).toBeCloseTo(0.5);

    tintPreviewModel(root, false);
    expect(mat.emissive.r).toBeGreaterThan(mat.emissive.g);
  });

  it('leaves materials without an emissive channel alone', () => {
    const { root, multi } = model();
    const basic = (multi.material as [MeshStandardMaterial, MeshBasicMaterial])[1];
    expect(() => tintPreviewModel(root, true)).not.toThrow();
    expect((basic as unknown as { emissive?: unknown }).emissive).toBeUndefined();
  });

  it('builds the preview from a clone at rest, at the type scale and base rotation, see-through', () => {
    const { root, single } = model();
    const assets = { cloneModel: vi.fn(() => root) };

    const preview = buildPreviewModel(assets, { modelUrl: 'tower.glb', scale: 2.5, rotationY: 0.3 });

    expect(assets.cloneModel).toHaveBeenCalledWith('tower.glb', { atRest: true });
    expect(preview).toBe(root);
    expect(root.scale.x).toBe(2.5);
    expect(root.rotation.y).toBeCloseTo(0.3);
    const mat = single.material as MeshStandardMaterial;
    expect([mat.transparent, mat.depthWrite, mat.opacity]).toEqual([true, false, PREVIEW_OPACITY]);
  });

  it('builds no preview while the model is not loaded', () => {
    expect(buildPreviewModel({ cloneModel: () => null }, { modelUrl: 'x.glb', scale: 1 })).toBeNull();
  });
});
