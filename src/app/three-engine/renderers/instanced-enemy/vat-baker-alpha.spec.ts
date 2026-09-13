import { describe, it, expect } from 'vitest';
import { DataTexture, MeshBasicMaterial, MeshStandardMaterial, Texture } from 'three';
import { texturePixels, vatAlpha, type TexturePixels } from './vat-surface';

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

describe('texturePixels', () => {
  it('takes the RGBA bytes of an image that holds them, without a canvas', () => {
    const bytes = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 0]);
    const pixels = texturePixels(new DataTexture(bytes, 2, 1), new Map());
    expect(pixels && [...pixels.data]).toEqual([...bytes]);
    expect([pixels?.width, pixels?.height]).toEqual([2, 1]);
  });

  it('lets vatAlpha read the alpha of such a map', () => {
    const cache = new Map<Texture, TexturePixels | null>();
    const read = (map: Texture) => texturePixels(map, cache);
    const material = (alpha: number) => new MeshStandardMaterial({
      transparent: true,
      map: new DataTexture(new Uint8Array([9, 9, 9, 255, 9, 9, 9, alpha]), 2, 1),
    });
    expect(vatAlpha([material(255)], read)).toEqual({ mode: 'opaque', cutoff: 0 });
    expect(vatAlpha([material(128)], read)).toEqual({ mode: 'blend', cutoff: 0 });
  });
});
