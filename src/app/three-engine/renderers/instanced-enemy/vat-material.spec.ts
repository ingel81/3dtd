import { describe, it, expect } from 'vitest';
import { BufferGeometry, DataTexture, FloatType, FrontSide, RGBAFormat, type Vector3 } from 'three';
import { createVATBloodMoonUniforms, createVATMaterial } from './vat-material';
import type { VATData } from './vat-baker';
import type { VATAlpha } from './vat-surface';
import { BLOOD_MOON_LOOK } from '../../../configs/blood-moon.config';

/** A one-texel VAT with the given alpha mode; nothing is drawn. */
function vatWith(alpha: VATAlpha): VATData {
  const vat = {
    positionTexture: new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType),
    encoding: { type: FloatType, origin: [0, 0, 0], extent: [1, 1, 1], halfFloatError: 0 },
    vertexCount: 1,
    totalFrames: 1,
    animations: new Map(),
    geometry: new BufferGeometry(),
    diffuseMap: null,
    isUnlit: false,
    alpha,
    fps: 30,
    texWidth: 1,
    rowsPerFrame: 1,
    baseColor: { r: 1, g: 1, b: 1 },
    side: FrontSide,
    modelMinY: 0,
    modelMaxY: 0,
  };
  return vat as VATData;
}

describe('createVATMaterial', () => {
  it('draws a type without alpha in the opaque pass', () => {
    const material = createVATMaterial(vatWith({ mode: 'opaque', cutoff: 0 }));
    expect(material.transparent).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.defines).toEqual({});
  });

  it('cuts a masked type out at its cutoff and keeps it opaque', () => {
    const material = createVATMaterial(vatWith({ mode: 'mask', cutoff: 0.5 }));
    expect(material.transparent).toBe(false);
    expect(material.defines).toEqual({ VAT_ALPHA_MASK: '' });
    expect(material.uniforms['alphaCutoff'].value).toBe(0.5);
  });

  it('makes only a blending type transparent', () => {
    const material = createVATMaterial(vatWith({ mode: 'blend', cutoff: 0 }));
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
    expect(material.defines).toEqual({ VAT_ALPHA_BLEND: '' });
  });
});

describe('createVATMaterial blood moon', () => {
  it('shares the blood moon uniforms it is given, so one write reaches every type', () => {
    const shared = createVATBloodMoonUniforms();
    const a = createVATMaterial(vatWith({ mode: 'opaque', cutoff: 0 }), { bloodMoon: shared });
    const b = createVATMaterial(vatWith({ mode: 'blend', cutoff: 0 }), { bloodMoon: shared });
    expect(a.uniforms['bloodMoonGlow']).toBe(shared.bloodMoonGlow);
    expect(b.uniforms['bloodMoonGlow']).toBe(shared.bloodMoonGlow);
    expect(b.uniforms['bloodMoonTint']).toBe(shared.bloodMoonTint);
  });

  it('rests without them: no glow, no tint', () => {
    const material = createVATMaterial(vatWith({ mode: 'opaque', cutoff: 0 }));
    expect(material.uniforms['bloodMoonGlow'].value).toBe(0);
    expect((material.uniforms['bloodMoonTint'].value as Vector3).toArray()).toEqual([1, 1, 1]);
    const { color, rim, base } = BLOOD_MOON_LOOK.glow;
    expect((material.uniforms['bloodMoonGlowColor'].value as Vector3).toArray()).toEqual([color.r, color.g, color.b]);
    expect(material.uniforms['bloodMoonRim'].value).toBe(rim);
    expect(material.uniforms['bloodMoonBase'].value).toBe(base);
  });

  it('glows only while the uniform is up, and tints only the blending types after the mood', () => {
    const shader = createVATMaterial(vatWith({ mode: 'opaque', cutoff: 0 })).fragmentShader;
    expect(shader).toContain('if (bloodMoonGlow > 0.0)');
    const blend = shader.slice(shader.indexOf('#ifdef VAT_ALPHA_BLEND'));
    expect(blend.slice(0, blend.indexOf('#else'))).toContain('litColor *= bloodMoonTint;');
  });
});
