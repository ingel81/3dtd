/// <reference lib="webworker" />
/**
 * The bake of the lava texture off the page's thread (lava-noise.ts
 * prepareLavaNoise): one message in, the texels back, transferred.
 */
import { bakeLavaNoise } from './lava-noise';

addEventListener('message', () => {
  const data = bakeLavaNoise();
  postMessage(data, [data.buffer]);
});
