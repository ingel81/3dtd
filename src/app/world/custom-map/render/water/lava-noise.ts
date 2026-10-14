import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { clamp01, tilingFbm } from '../tiling-noise';

/**
 * A tiling noise texture for lava (256², RGBA8, built once on the CPU and
 * shared): its crust reads plates, veins and a warp from it instead of
 * evaluating 5-octave noise several times per pixel.
 *
 * - R: plates, a fractal noise (5 octaves)
 * - G: veins, a ridged noise (1 at the ridge of a second fractal)
 * - B, A: a smooth warp field (two low-frequency noises), centred on 0.5
 *
 * Every lattice repeats over the texture, so it tiles without seams.
 */

const SIZE = 256;
let texture: DataTexture | null = null;

export function lavaNoiseTexture(): DataTexture {
  if (texture) return texture;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const plates = tilingFbm(SIZE, 5, 4, 11);
  const ridge = tilingFbm(SIZE, 4, 8, 23);
  const warpX = tilingFbm(SIZE, 2, 2, 37);
  const warpY = tilingFbm(SIZE, 2, 2, 53);
  for (let k = 0; k < SIZE * SIZE; k++) {
    const vein = 1 - Math.min(1, Math.abs(ridge[k] - 0.5) / 0.08);
    data[k * 4] = Math.round(clamp01(plates[k]) * 255);
    data[k * 4 + 1] = Math.round(clamp01(vein) * 255);
    data[k * 4 + 2] = Math.round(clamp01(warpX[k]) * 255);
    data[k * 4 + 3] = Math.round(clamp01(warpY[k]) * 255);
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
