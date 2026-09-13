import { describe, it, expect } from 'vitest';
import {
  BackSide,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  FloatType,
  FrontSide,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RGBAFormat,
  type Side,
} from 'three';
import type { VATData } from './vat-baker';
import { vatSide } from './vat-surface';
import { createVATMaterial } from './vat-material';

const withSide = (side: Side) => new MeshStandardMaterial({ side });

describe('vatSide', () => {
  it('draws front faces when every material does', () => {
    expect(vatSide([withSide(FrontSide), [withSide(FrontSide), new MeshBasicMaterial()]])).toBe(FrontSide);
  });

  it('draws both faces for double-sided materials (glTF doubleSided)', () => {
    expect(vatSide([withSide(DoubleSide), withSide(DoubleSide)])).toBe(DoubleSide);
  });

  it('draws both faces when the materials disagree', () => {
    expect(vatSide([withSide(FrontSide), withSide(DoubleSide)])).toBe(DoubleSide);
    expect(vatSide([withSide(FrontSide), withSide(BackSide)])).toBe(DoubleSide);
  });

  it('keeps back faces when every material draws those', () => {
    expect(vatSide([withSide(BackSide)])).toBe(BackSide);
  });
});

describe('createVATMaterial sides', () => {
  /** A one-texel blending VAT with the given side; nothing is drawn. */
  function vatWith(side: Side): VATData {
    const vat = {
      positionTexture: new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType),
      encoding: { type: FloatType, origin: [0, 0, 0], extent: [1, 1, 1], halfFloatError: 0 },
      vertexCount: 1,
      totalFrames: 1,
      animations: new Map(),
      geometry: new BufferGeometry(),
      diffuseMap: null,
      isUnlit: false,
      alpha: { mode: 'blend', cutoff: 0 },
      fps: 30,
      texWidth: 1,
      rowsPerFrame: 1,
      baseColor: { r: 1, g: 1, b: 1 },
      side,
      modelMinY: 0,
      modelMaxY: 0,
    };
    return vat as VATData;
  }

  it('draws the faces the baked materials draw', () => {
    expect(createVATMaterial(vatWith(DoubleSide)).side).toBe(DoubleSide);
    expect(createVATMaterial(vatWith(FrontSide)).side).toBe(FrontSide);
  });

  it('blends a double-sided type in one pass, not in three.js\'s back-then-front two', () => {
    const material = createVATMaterial(vatWith(DoubleSide));
    expect(material.transparent).toBe(true);
    expect(material.forceSinglePass).toBe(true);
  });
});
