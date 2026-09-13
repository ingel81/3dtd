import { afterEach, describe, expect, it, vi } from 'vitest';
import { Matrix4, Scene, Vector3 } from 'three';
import { BLOOD_DECAL_CONFIG } from '../../configs/visual-effects.config';
import type { ScorchGround } from './scorch-marks';
import { GroundDecals } from './ground-decals';

/** Every point lies on the route, its ground at 0. */
const FLAT_ROUTE: ScorchGround = {
  getCellAt: (x, z) => ({ key: Math.round(x) * 1000 + Math.round(z) }),
  getGroundLocalYAt: () => 0,
};

describe('GroundDecals', () => {
  afterEach(() => vi.restoreAllMocks());

  it('adds its three decal meshes to the scene and takes them out again on dispose', () => {
    const scene = new Scene();
    const decals = new GroundDecals(scene);
    expect(scene.children).toEqual([decals.blood.instancedMesh, decals.ice.instancedMesh, decals.scorch.decals.instancedMesh]);
    decals.dispose();
    expect(scene.children).toHaveLength(0);
  });

  it('lays blood and ice round, with size as the diameter, lifted by their height offset', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // no size variation
    const decals = new GroundDecals(new Scene());
    const at = new Vector3(3, 10, 4);
    expect(decals.layBlood(at, 2.8)).toBe('blood_decal_0');
    expect(at.y).toBeCloseTo(10 + BLOOD_DECAL_CONFIG.heightOffset, 9);
    expect(decals.layIce(new Vector3(), 3.7)).toBe('ice_decal_1');

    const matrix = new Matrix4();
    const scale = new Vector3();
    for (const [pool, diameter] of [[decals.blood, 2.8], [decals.ice, 3.7]] as const) {
      pool.instancedMesh.getMatrixAt(0, matrix);
      scale.setFromMatrixScale(matrix);
      expect(scale.x).toBeCloseTo(diameter / 2);
    }
  });

  it('drops the oldest blood decal once the pool is full', () => {
    const decals = new GroundDecals(new Scene());
    for (let i = 0; i < BLOOD_DECAL_CONFIG.maxDecals + 3; i++) decals.layBlood(new Vector3(), 2);
    expect(decals.blood.count).toBe(BLOOD_DECAL_CONFIG.maxDecals);
  });

  it('clears blood, ice and scorch marks together', () => {
    const decals = new GroundDecals(new Scene());
    decals.setScorchGround(FLAT_ROUTE);
    decals.layBlood(new Vector3(), 2);
    decals.layIce(new Vector3(), 2);
    decals.markScorch(0, 0, 0, 'cannon', 0);
    expect(decals.blood.count + decals.ice.count + decals.scorch.decals.count).toBe(3);

    decals.clear();
    expect(decals.blood.count + decals.ice.count + decals.scorch.decals.count).toBe(0);
  });
});
