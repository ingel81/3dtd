/// <reference lib="webworker" />
/**
 * The bakes of the noise textures off the page's thread (baked-noise.ts):
 * a noise's name in, its texels back, transferred.
 */
import type { NoiseName } from './baked-noise';
import { bakeVariation } from './terrain/variation-texture';
import { bakeFoamNoise } from './water/foam-noise';
import { bakeLavaNoise } from './water/lava-noise';
import { bakeWaves } from './water/wave-noise';

const BAKES: Record<NoiseName, () => Uint8Array> = {
  variation: bakeVariation,
  waves: bakeWaves,
  foam: bakeFoamNoise,
  lava: bakeLavaNoise,
};

addEventListener('message', (e: MessageEvent<NoiseName>) => {
  const data = BAKES[e.data]();
  postMessage(data, [data.buffer]);
});
