import type { DataTexture } from 'three';
import { BakedNoise } from '../baked-noise';
import { clamp01, crackDistance, tilingFbm } from '../tiling-noise';

/**
 * A tiling texture for the foam on water (256², RGBA8, baked once in a worker
 * and shared), so the shore's foam reads as lace with holes and gaps
 * instead of a line of noise:
 *
 * - R: the lace, how far a texel lies inside a bubble (0 on a bubble's wall,
 *   1 in its middle): the walls of a coarse jittered cell grid (FOAM_CELLS),
 *   subdivided in patches by a finer one, both bent by a smooth noise, so
 *   the bubbles differ in size and are not polygons. The shader keeps the
 *   texels whose value lies under the foam's density there: dense foam
 *   keeps all but the bubbles' middles, thin foam only the walls
 * - G: patches, a warped fractal noise (where foam gathers and where it
 *   leaves holes)
 * - B: a second, smoother warped noise (how wide the foam reaches out from
 *   the shore, read at a large scale)
 * - A: a fine noise, the jitter of the lace's popping
 */

const SIZE = 256;
/** Bubbles per side of the texture, coarse and fine */
const FOAM_CELLS = 9;
const FOAM_CELLS_FINE = 22;

/** The lace (channel R) on its own, `size`² texels, 0 on the bubbles' walls, 1 in their middles */
export function foamLace(size: number): Float32Array {
  const bend: [Float32Array, Float32Array] = [tilingFbm(size, 3, 3, 71), tilingFbm(size, 3, 3, 73)];
  const coarse = crackDistance(size, FOAM_CELLS, 29, bend, 0.45);
  const fine = crackDistance(size, FOAM_CELLS_FINE, 31, bend, 0.6);
  // Where the fine walls subdivide the coarse bubbles: in patches, so some bubbles stay large
  const split = tilingFbm(size, 3, 4, 79);
  const out = new Float32Array(size * size);
  for (let k = 0; k < out.length; k++) {
    const subdivide = clamp01((split[k] - 0.4) * 4);
    out[k] = Math.min(coarse[k], fine[k] + (1 - subdivide));
  }
  return out;
}

/** The texture's texels (RGBA8, SIZE²): the bake, on whichever thread runs it */
export function bakeFoamNoise(): Uint8Array {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const lace = foamLace(SIZE);
  const patches = tilingFbm(SIZE, 4, 4, 83, 1.8, 24);
  const reach = tilingFbm(SIZE, 3, 3, 89, 2.0, 40);
  const jitter = tilingFbm(SIZE, 2, 16, 97);
  for (let k = 0; k < SIZE * SIZE; k++) {
    data[k * 4] = Math.round(clamp01(lace[k]) * 255);
    data[k * 4 + 1] = Math.round(patches[k] * 255);
    data[k * 4 + 2] = Math.round(reach[k] * 255);
    data[k * 4 + 3] = Math.round(jitter[k] * 255);
  }
  return data;
}

/** Baked in a worker (baked-noise.ts); no lace until then */
const NOISE = new BakedNoise('foam', { size: SIZE, neutral: [255, 0, 0, 0] }, bakeFoamNoise);

/** The shared texture, at once (its bake: prepareFoamNoise) */
export function foamNoiseTexture(): DataTexture {
  return NOISE.texture();
}

/** Bakes the texture once; a view starts it as it loads and its `ready` waits for it */
export function prepareFoamNoise(): Promise<void> {
  return NOISE.prepare();
}
