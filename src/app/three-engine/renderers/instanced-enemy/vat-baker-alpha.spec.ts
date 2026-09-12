import { describe, it, expect } from 'vitest';
import { MeshBasicMaterial, MeshStandardMaterial, Texture } from 'three';
import { vatAlpha, type TexturePixels } from './vat-baker';

describe('vatAlpha', () => {
  const pixels = (...alphas: number[]) => (): TexturePixels => ({
    data: new Uint8ClampedArray(alphas.flatMap((a) => [90, 90, 90, a])),
    width: alphas.length,
    height: 1,
  });
  const unreadable = () => null;
  const OPAQUE = { mode: 'opaque', cutoff: 0 };
  const BLEND = { mode: 'blend', cutoff: 0 };

  it('ignores alpha when no material uses it', () => {
    expect(vatAlpha([new MeshStandardMaterial(), [new MeshBasicMaterial()]], unreadable)).toEqual(OPAQUE);
  });

  it('ignores the texture alpha of an opaque material, as three.js does', () => {
    expect(vatAlpha([new MeshStandardMaterial({ map: new Texture() })], pixels(255, 0))).toEqual(OPAQUE);
  });

  it('cuts out at the lowest alphaTest (glTF MASK)', () => {
    const materials = [new MeshStandardMaterial({ alphaTest: 0.5 }), new MeshStandardMaterial({ alphaTest: 0.3 })];
    expect(vatAlpha(materials, unreadable)).toEqual({ mode: 'mask', cutoff: 0.3 });
  });

  it('blends a transparent material with opacity below 1', () => {
    expect(vatAlpha([new MeshStandardMaterial({ transparent: true, opacity: 0.4 })], unreadable)).toEqual(BLEND);
  });

  it('blends a transparent material whose map has translucent texels', () => {
    const material = new MeshStandardMaterial({ transparent: true, map: new Texture() });
    expect(vatAlpha([material], pixels(255, 254))).toEqual(BLEND);
  });

  it('draws a transparent material opaque when nothing in it is below alpha 1', () => {
    const material = new MeshStandardMaterial({ transparent: true, map: new Texture() });
    expect(vatAlpha([material], pixels(255, 255))).toEqual(OPAQUE);
    expect(vatAlpha([new MeshStandardMaterial({ transparent: true })], unreadable)).toEqual(OPAQUE);
  });

  it('keeps blending when the map cannot be read', () => {
    const material = new MeshStandardMaterial({ transparent: true, map: new Texture() });
    expect(vatAlpha([material], unreadable)).toEqual(BLEND);
  });

  it('lets one blending mesh make the whole type blend', () => {
    const materials = [new MeshStandardMaterial({ alphaTest: 0.5 }), new MeshStandardMaterial({ transparent: true, opacity: 0.7 })];
    expect(vatAlpha(materials, unreadable)).toEqual(BLEND);
  });
});
