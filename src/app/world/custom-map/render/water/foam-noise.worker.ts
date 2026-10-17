/// <reference lib="webworker" />
/**
 * The bake of the foam texture off the page's thread (foam-noise.ts
 * prepareFoamNoise): one message in, the texels back, transferred.
 */
import { bakeFoamNoise } from './foam-noise';

addEventListener('message', () => {
  const data = bakeFoamNoise();
  postMessage(data, [data.buffer]);
});
