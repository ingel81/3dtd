import { describe, it, expect } from 'vitest';
import { Color, CustomBlending, Fog, Mesh, Scene, SrcColorFactor, ZeroFactor, type ShaderMaterial, type Vector3 } from 'three';
import { BloodMoonMood } from './blood-moon-mood';
import { BLOOD_MOON_LOOK } from '../../configs/blood-moon.config';

const { tint, vignette, skyIntensity, fogColor } = BLOOD_MOON_LOOK.mood;

function setup() {
  const scene = new Scene();
  scene.fog = new Fog(0x1a1f25, 2000, 6000);
  const fogBefore = (scene.fog as Fog).color.clone();
  const mood = new BloodMoonMood(scene);
  const quad = scene.children.find((child) => child.name === 'blood-moon-mood') as Mesh;
  const material = quad.material as ShaderMaterial;
  return { scene, fogBefore, mood, quad, material };
}

describe('BloodMoonMood', () => {
  it('multiplies the frame from the end of the opaque pass, without depth', () => {
    const { quad, material } = setup();
    expect(material.transparent).toBe(false);
    expect(material.blending).toBe(CustomBlending);
    expect(material.blendSrc).toBe(ZeroFactor);
    expect(material.blendDst).toBe(SrcColorFactor);
    expect(material.depthTest).toBe(false);
    expect(material.depthWrite).toBe(false);
    expect(quad.frustumCulled).toBe(false);
    expect(quad.renderOrder).toBeGreaterThan(0);
    expect(material.vertexShader).toContain('#include <logdepthbuf_vertex>');
    expect(material.fragmentShader).toContain('#include <logdepthbuf_fragment>');
  });

  it('stays out of the render list and leaves sky and fog alone at amount 0', () => {
    const { scene, fogBefore, mood } = setup();
    expect(mood.visible).toBe(false);
    mood.setAmount(0, false);
    expect(mood.visible).toBe(false);
    expect(scene.backgroundIntensity).toBe(1);
    expect((scene.fog as Fog).color.equals(fogBefore)).toBe(true);
  });

  it('tints, darkens the corners, dims the sky and reddens the fog at full strength', () => {
    const { scene, mood, material } = setup();
    mood.setAmount(1, false);
    expect(mood.visible).toBe(true);
    const t = material.uniforms['uTint'].value as Vector3;
    expect(t.x).toBeCloseTo(tint.r);
    expect(t.y).toBeCloseTo(tint.g);
    expect(t.z).toBeCloseTo(tint.b);
    expect(material.uniforms['uVignette'].value).toBeCloseTo(vignette);
    expect(material.uniforms['uExponent'].value).toBe(1);
    expect(scene.backgroundIntensity).toBeCloseTo(skyIntensity);
    const fog = (scene.fog as Fog).color;
    const target = new Color(fogColor);
    expect(fog.r).toBeCloseTo(target.r);
    expect(fog.g).toBeCloseTo(target.g);
    expect(fog.b).toBeCloseTo(target.b);
  });

  it('blends halfway at half strength', () => {
    const { scene, mood, material } = setup();
    mood.setAmount(0.5, false);
    const t = material.uniforms['uTint'].value as Vector3;
    expect(t.y).toBeCloseTo(1 + (tint.g - 1) / 2);
    expect(scene.backgroundIntensity).toBeCloseTo(1 + (skyIntensity - 1) / 2);
  });

  it('raises its colour to 2.2 into the linear post-processing target', () => {
    const { mood, material } = setup();
    mood.setAmount(1, true);
    expect(material.uniforms['uExponent'].value).toBeCloseTo(2.2);
  });

  it('puts sky and fog back exactly once the blood moon is gone', () => {
    const { scene, fogBefore, mood } = setup();
    mood.setAmount(0.7, false);
    mood.setAmount(0, false);
    expect(mood.visible).toBe(false);
    expect(scene.backgroundIntensity).toBe(1);
    expect((scene.fog as Fog).color.equals(fogBefore)).toBe(true);
  });

  it('is never hit by a raycast and leaves the scene on dispose', () => {
    const { scene, mood, quad } = setup();
    const hits: unknown[] = [];
    quad.raycast({} as never, hits as never);
    expect(hits).toEqual([]);
    mood.dispose();
    expect(scene.children).not.toContain(quad);
  });
});
