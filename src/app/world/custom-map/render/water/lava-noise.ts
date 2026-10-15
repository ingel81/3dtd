import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { clamp01, tilingFbm } from '../tiling-noise';

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

/**
 * Distance from each texel to the nearest edge between two cells of a
 * jittered grid that wraps (`cells` per side; a cell's point in its middle
 * 80 %), in cells: the bisector of the nearest two points. Scaled by 2 and
 * capped at 1. `warp` (two tiling noises around 0.5, `size`² each) moves
 * each texel up to `bend` cells before the test.
 */
export function crackDistance(
  size: number,
  cells: number,
  seed: number,
  warp: [Float32Array, Float32Array] | null = null,
  bend = 0,
): Float32Array {
  let s = seed;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const points = new Float32Array(cells * cells * 2);
  for (let k = 0; k < cells * cells; k++) {
    points[k * 2] = 0.1 + 0.8 * rnd();
    points[k * 2 + 1] = 0.1 + 0.8 * rnd();
  }
  const wrap = (i: number): number => ((i % cells) + cells) % cells;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = y * size + x;
      const gx = ((x + 0.5) / size) * cells + (warp ? (warp[0][at] - 0.5) * 2 * bend : 0);
      const gy = ((y + 0.5) / size) * cells + (warp ? (warp[1][at] - 0.5) * 2 * bend : 0);
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);
      // The nearest point, relative to the texel
      let best = Infinity;
      let nx = 0;
      let ny = 0;
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const k = wrap(cy + j) * cells + wrap(cx + i);
          const rx = cx + i + points[k * 2] - gx;
          const ry = cy + j + points[k * 2 + 1] - gy;
          const d = rx * rx + ry * ry;
          if (d < best) {
            best = d;
            nx = rx;
            ny = ry;
          }
        }
      }
      // The nearest bisector to any other point
      let edge = Infinity;
      for (let j = -2; j <= 2; j++) {
        for (let i = -2; i <= 2; i++) {
          const k = wrap(cy + j) * cells + wrap(cx + i);
          const rx = cx + i + points[k * 2] - gx;
          const ry = cy + j + points[k * 2 + 1] - gy;
          const dx = rx - nx;
          const dy = ry - ny;
          const len = Math.hypot(dx, dy);
          if (len < 1e-6) continue;
          edge = Math.min(edge, ((nx + rx) * 0.5 * dx + (ny + ry) * 0.5 * dy) / len);
        }
      }
      out[at] = Math.min(1, edge * 2);
    }
  }
  return out;
}

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
