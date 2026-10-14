import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { tilingFbm } from '../tiling-noise';

/**
 * The ground's variation as one tiling texture (512², RGBA8, built once on
 * the CPU and shared): blots bent by a coarse warp, so patches of drier
 * grass, damp hollows and lichen read as natural shapes rather than the
 * lattice squares of value noise. The terrain and the grass read it at
 * three scales (VARIATION_GLSL) instead of evaluating about a dozen value
 * noises per pixel.
 *
 * Channels, in cells across the texture: R 8 (with `variationAt` over
 * 512 m: patches of about 60 m), G 2 (250 m), B 56 (9 m), A 56 (another
 * seed). Each about 0..1 around 0.5.
 */

const SIZE = 512;
let texture: DataTexture | null = null;

export function variationTexture(): DataTexture {
  if (texture) return texture;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const channels = [
    tilingFbm(SIZE, 4, 8, 3, 1.35, 40),
    tilingFbm(SIZE, 3, 2, 7, 1.35, 60),
    tilingFbm(SIZE, 3, 56, 11, 1.35, 6),
    tilingFbm(SIZE, 3, 56, 19, 1.35, 6),
  ];
  for (let k = 0; k < SIZE * SIZE; k++) {
    for (let c = 0; c < 4; c++) data[k * 4 + c] = Math.round(channels[c][k] * 255);
  }
  const t = new DataTexture(data, SIZE, SIZE, RGBAFormat, UnsignedByteType);
  t.colorSpace = NoColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  texture = t;
  return t;
}

/**
 * GLSL: `variationAt(p)` reads the variation texture over 512 m of map
 * space (R about 60 m patches, G 250 m, B and A about 9 m),
 * `variationFine(p)` the same texture over 96 m (B and A about 1.7 m) and
 * `variationFiner(p)` over 28 m (B and A about 0.5 m). Needs `uVariation`.
 */
export const VARIATION_GLSL = /* glsl */ `
uniform sampler2D uVariation;
vec4 variationAt(vec2 p) { return texture2D(uVariation, p / 512.0); }
vec4 variationFine(vec2 p) { return texture2D(uVariation, p / 96.0 + 0.37); }
vec4 variationFiner(vec2 p) { return texture2D(uVariation, p / 28.0 + 0.71); }
`;
