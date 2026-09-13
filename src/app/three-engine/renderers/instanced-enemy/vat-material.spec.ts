import { describe, it, expect } from 'vitest';
import { BufferGeometry, DataTexture, FloatType, FrontSide, RGBAFormat } from 'three';
import { createVATMaterial } from './vat-material';
import type { VATData } from './vat-baker';
import type { VATAlpha } from './vat-surface';

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
