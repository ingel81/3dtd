import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { clamp01, crackDistance, tilingFbm } from '../tiling-noise';

/**
 * A tiling noise texture for lava (256², RGBA8, built once on the CPU and
 * shared): its crust reads heat, cracks and a warp from it instead of
 * evaluating noise several times per pixel.
 *
 * - R: the heat field, a fractal noise (5 octaves)
 * - G: the cracks between crust plates, the distance to the nearest edge of
 *   a jittered cell grid (CRACK_CELLS per side), 0 on the edge, 1 half a
 *   cell away (`crackDistance`); the grid warped by a smooth noise, so the
 *   plates are not straight-edged polygons
 * - B, A: a smooth warp field (two low-frequency noises), centred on 0.5
 *
 * Every lattice and the cell grid repeat over the texture, so it tiles
 * without seams.
 */

const SIZE = 256;
/** Crust plates per side of the texture */
const CRACK_CELLS = 5;
let texture: DataTexture | null = null;

export function lavaNoiseTexture(): DataTexture {
  if (texture) return texture;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const heat = tilingFbm(SIZE, 5, 4, 11);
  const warpX = tilingFbm(SIZE, 2, 2, 37);
  const warpY = tilingFbm(SIZE, 2, 2, 53);
  const cracks = crackDistance(SIZE, CRACK_CELLS, 23, [tilingFbm(SIZE, 3, 3, 61), tilingFbm(SIZE, 3, 3, 67)], 0.3);
  for (let k = 0; k < SIZE * SIZE; k++) {
    data[k * 4] = Math.round(clamp01(heat[k]) * 255);
    data[k * 4 + 1] = Math.round(clamp01(cracks[k]) * 255);
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
