import { afterEach, describe, expect, it, vi } from 'vitest';
import { Matrix4, Scene, Vector3, type ShaderMaterial } from 'three';
import { BLOOD_DECAL_CONFIG, GOO_DECAL_CONFIG } from '../../configs/visual-effects.config';
import { bloodMoonMultiplier } from '../blood-moon/blood-moon-mood';
import type { ScorchGround } from './scorch-marks';
import { GroundDecals, type GooSplash } from './ground-decals';
import { DISPLAY_OUTPUT_GLSL } from './display-output';

/** Every point lies on the route, its ground at 0. */
const FLAT_ROUTE: ScorchGround = {
  getCellAt: (x, z) => ({ key: Math.round(x) * 1000 + Math.round(z) }),
  getGroundLocalYAt: () => 0,
};

/** Twice as long as wide, unturned */
const SPLASH: GooSplash = { size: 4, stretch: 2, rotation: 0, variation: 0.25, color: 0x6fe021 };

describe('GroundDecals', () => {
  afterEach(() => vi.restoreAllMocks());

  it('adds its four decal meshes to the scene and takes them out again on dispose', () => {
    const scene = new Scene();
    const decals = new GroundDecals(scene);
    expect(scene.children).toEqual([
      decals.blood.instancedMesh, decals.ice.instancedMesh, decals.scorch.decals.instancedMesh, decals.goo.instancedMesh,
    ]);
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

  it('lays an ooze splash as given: size across, stretched along its turn, its pattern seed, nothing at random', () => {
    const decals = new GroundDecals(new Scene());
    const random = vi.spyOn(Math, 'random');
    const at = new Vector3(3, 10, 4);
    expect(decals.layGoo(at, SPLASH)).toBe('goo_decal_0');
    expect(random).not.toHaveBeenCalled();
    expect(at.y).toBeCloseTo(10 + GOO_DECAL_CONFIG.heightOffset, 9);

    const matrix = new Matrix4();
    const scale = new Vector3();
    decals.goo.instancedMesh.getMatrixAt(0, matrix);
    scale.setFromMatrixScale(matrix);
    expect(scale.x).toBeCloseTo(4); // radius 2, twice as long
    expect(scale.z).toBeCloseTo(2);
    expect(decals.goo.instancedMesh.geometry.getAttribute('instanceVariation').getX(0)).toBe(0.25);
  });

  it('keeps an ooze splash 2.5 times as long as blood, in a pool the blood does not push it out of', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const decals = new GroundDecals(new Scene());
    decals.layGoo(new Vector3(), SPLASH);
    for (let i = 0; i < BLOOD_DECAL_CONFIG.maxDecals + 5; i++) decals.layBlood(new Vector3(), 2);
    expect(decals.goo.count).toBe(1);

    const { fadeDelay, fadeDuration, baseOpacity, maxDecals } = GOO_DECAL_CONFIG;
    expect((fadeDelay + fadeDuration) / (BLOOD_DECAL_CONFIG.fadeDelay + BLOOD_DECAL_CONFIG.fadeDuration)).toBe(2.5);
    const opacity = () => decals.goo.instancedMesh.geometry.getAttribute('instanceOpacity').getX(0);
    decals.updateFades(1000 + fadeDelay);
    expect(opacity()).toBeCloseTo(baseOpacity, 6);
    decals.updateFades(1000 + fadeDelay + fadeDuration / 2);
    expect(opacity()).toBeCloseTo(baseOpacity / 2, 6);
    decals.updateFades(1000 + fadeDelay + fadeDuration);
    expect(decals.goo.count).toBe(0);

    // Three full bodies of 64, then the oldest goes
    expect(maxDecals).toBe(3 * 64);
    for (let i = 0; i < maxDecals + 3; i++) decals.layGoo(new Vector3(), SPLASH);
    expect(decals.goo.count).toBe(maxDecals);
  });

  it('tints all four pools with the blood moon mood through one shared uniform', () => {
    const decals = new GroundDecals(new Scene());
    const materials = [decals.blood, decals.ice, decals.scorch.decals, decals.goo]
      .map((pool) => pool.instancedMesh.material as ShaderMaterial);
    const tint = materials[0].uniforms['uBloodMoonTint'];
    for (const material of materials) {
      expect(material.uniforms['uBloodMoonTint']).toBe(tint);
      expect(material.fragmentShader).toContain('* uBloodMoonTint');
      expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
    }
    expect((tint.value as Vector3).toArray()).toEqual([1, 1, 1]);

    // The mood's multiplier, in display values on the canvas, linear in the composer target
    decals.setBloodMoon(1, false);
    expect((tint.value as Vector3).toArray()).toEqual(bloodMoonMultiplier(1, false, new Vector3()).toArray());
    decals.setBloodMoon(1, true);
    expect((tint.value as Vector3).toArray()).toEqual(bloodMoonMultiplier(1, true, new Vector3()).toArray());
    decals.setBloodMoon(0, true);
    expect((tint.value as Vector3).toArray()).toEqual([1, 1, 1]);
  });

  it('writes each decal colour for the target, the tint in the target\'s values after it', () => {
    const decals = new GroundDecals(new Scene());
    for (const pool of [decals.blood, decals.ice, decals.scorch.decals, decals.goo]) {
      const shader = (pool.instancedMesh.material as ShaderMaterial).fragmentShader;
      expect(shader).toContain(DISPLAY_OUTPUT_GLSL);
      expect(shader).toContain('gl_FragColor = vec4(displayOutput(color) * uBloodMoonTint, alpha');
      expect(shader).not.toContain('vec4(color * uBloodMoonTint');
    }
  });

  it('clears blood, ice, scorch and goo marks together', () => {
    const decals = new GroundDecals(new Scene());
    decals.setScorchGround(FLAT_ROUTE);
    decals.layBlood(new Vector3(), 2);
    decals.layIce(new Vector3(), 2);
    decals.markScorch(0, 0, 0, 'cannon', 0);
    decals.layGoo(new Vector3(), SPLASH);
    const count = () => decals.blood.count + decals.ice.count + decals.scorch.decals.count + decals.goo.count;
    expect(count()).toBe(4);

    decals.clear();
    expect(count()).toBe(0);
  });
});
