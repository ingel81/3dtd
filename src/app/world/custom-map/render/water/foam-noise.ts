import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';
import { clamp01, crackDistance, tilingFbm } from '../tiling-noise';

/**
 * A tiling texture for the foam on water (256², RGBA8, built once on the CPU
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
let texture: DataTexture | null = null;

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

/**
 * The shared texture, at once: until its bake is in (prepareFoamNoise) it
 * holds no foam (every texel in a bubble's middle), so a water material made
 * meanwhile draws without shore foam instead of waiting for it
 */
export function foamNoiseTexture(): DataTexture {
  if (texture) return texture;
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let k = 0; k < SIZE * SIZE; k++) data[k * 4] = 255;
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

let baked: Promise<void> | null = null;

/**
 * Bakes the texture once (some 50 to 100 ms), in a worker where there are
 * workers (foam-noise.worker.ts), inline where not. A view starts it as it
 * loads (CustomMapView, game and editor alike) and its `ready` waits for
 * it, so neither the first frames nor the first pour of water in the editor
 * bake it on the page's thread.
 */
export function prepareFoamNoise(): Promise<void> {
  if (baked) return baked;
  const fill = (data: Uint8Array): void => {
    const t = foamNoiseTexture();
    (t.image.data as Uint8Array).set(data);
    t.needsUpdate = true;
  };
  if (typeof Worker === 'undefined') {
    fill(bakeFoamNoise());
    return (baked = Promise.resolve());
  }
  baked = new Promise<void>((resolve) => {
    const worker = new Worker(new URL('./foam-noise.worker', import.meta.url), { type: 'module' });
    const done = (data: Uint8Array): void => {
      fill(data);
      worker.terminate();
      resolve();
    };
    worker.onmessage = (e: MessageEvent<Uint8Array>) => done(e.data);
    // A worker that fails: the bake here after all
    worker.onerror = () => done(bakeFoamNoise());
    worker.postMessage(null);
  });
  return baked;
}
