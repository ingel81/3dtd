import { DoubleSide, FrontSide, type Material, type MeshStandardMaterial, type Side, type Texture } from 'three';

/**
 * Faces the VAT material draws, from the materials of the baked meshes
 * (glTF doubleSided is DoubleSide). A type has one material, so when its
 * meshes disagree it draws both sides: a missing face shows, an extra back
 * face mostly stays behind the front one.
 */
export function vatSide(materials: (Material | Material[])[]): Side {
  const sides = new Set(materials.flat().map((material) => material.side));
  if (sides.size > 1) return DoubleSide;
  return sides.values().next().value ?? FrontSide;
}

/** RGBA bytes of a texture's image, read through a 2D canvas or as the image holds them. */
export interface TexturePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * The pixels of `tex`, read once per cache. An image that already holds RGBA
 * bytes (DataTexture, the PNGs the model-budget generator decodes in Node) is
 * taken as it is, any other goes through a 2D canvas. Null when the texture
 * has no decoded image or no 2D canvas is available.
 */
export function texturePixels(tex: Texture, cache: Map<Texture, TexturePixels | null>): TexturePixels | null {
  if (cache.has(tex)) return cache.get(tex) ?? null;
  let pixels: TexturePixels | null = null;
  try {
    const img = tex.image as HTMLImageElement | ImageBitmap | HTMLCanvasElement;
    const width = (img as HTMLImageElement).naturalWidth || img.width || 0;
    const height = (img as HTMLImageElement).naturalHeight || img.height || 0;
    const bytes = (img as { data?: unknown }).data;
    if (ArrayBuffer.isView(bytes) && width > 0 && height > 0 && bytes.byteLength === width * height * 4) {
      pixels = { data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength), width, height };
    } else if (width > 0 && height > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img as CanvasImageSource, 0, 0);
      pixels = { data: ctx.getImageData(0, 0, width, height).data, width, height };
    }
  } catch {
    pixels = null;
  }
  cache.set(tex, pixels);
  return pixels;
}

/**
 * How the VAT shader treats alpha: 'opaque' ignores it and draws in the
 * opaque pass, 'mask' discards below the cutoff, 'blend' is transparent.
 */
export type VATAlphaMode = 'opaque' | 'mask' | 'blend';

export interface VATAlpha {
  mode: VATAlphaMode;
  /** Alpha below which 'mask' discards a fragment (0 for the other modes). */
  cutoff: number;
}

/**
 * The alpha mode of a type from the materials of its baked meshes, the way
 * three.js draws them: a transparent material blends (glTF BLEND), one with
 * alphaTest cuts out below it (glTF MASK), any other ignores alpha. A
 * transparent material without alpha below 1 (opacity 1, no translucent
 * texel in its map) draws opaque. A type has one material, so one blending
 * mesh makes all of it blend; among masks the lowest cutoff wins.
 * `pixels` reads a map; a map it cannot read counts as translucent.
 */
export function vatAlpha(
  materials: (Material | Material[])[],
  pixels: (map: Texture) => TexturePixels | null,
): VATAlpha {
  let cutoff = Infinity;
  for (const material of materials.flat()) {
    if (material.transparent) {
      const map = (material as MeshStandardMaterial).map;
      if (material.opacity < 1 || (map && !isOpaque(pixels(map)))) return { mode: 'blend', cutoff: 0 };
    } else if (material.alphaTest > 0) {
      cutoff = Math.min(cutoff, material.alphaTest);
    }
  }
  return cutoff < Infinity ? { mode: 'mask', cutoff } : { mode: 'opaque', cutoff: 0 };
}

/** Every texel fully opaque; unknown pixels count as translucent. */
function isOpaque(pixels: TexturePixels | null): boolean {
  if (!pixels) return false;
  const { data } = pixels;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) return false;
  }
  return true;
}
