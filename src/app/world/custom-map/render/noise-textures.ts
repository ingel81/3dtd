import { prepareVariation } from './terrain/variation-texture';
import { prepareFoamNoise } from './water/foam-noise';
import { prepareLavaNoise } from './water/lava-noise';
import { prepareWaves } from './water/wave-noise';

/**
 * Every noise texture's bake (baked-noise.ts): the app starts them as it
 * starts (main.ts), so a map opened later finds them done; a view's `ready`
 * waits for them all the same
 */
export function prepareNoiseTextures(): Promise<void> {
  return Promise.all([prepareVariation(), prepareWaves(), prepareFoamNoise(), prepareLavaNoise()]).then(() => undefined);
}
