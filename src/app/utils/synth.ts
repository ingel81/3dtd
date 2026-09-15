/**
 * Building blocks of the sounds synthesised in code (utils/ooze-sound.ts,
 * utils/nuke-sound.ts, utils/laser-sound.ts): a seeded random source, so every run builds the
 * same samples, the one-pole low-pass they filter noise with and the
 * normalising of a finished sample.
 */

import { SeededRandom } from './seeded-random';

/** Seeded PRNG (mulberry32), 0..1 */
export function seeded(seed: number): () => number {
  return new SeededRandom(seed).next;
}

/** One-pole low-pass coefficient for cutoff `hz` at `sampleRate` */
export function onePoleCoefficient(hz: number, sampleRate: number): number {
  return 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
}

/** Scale `out` so its loudest sample is `peak`. */
export function normalise(out: Float32Array, peak: number): Float32Array {
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < out.length; i++) out[i] *= k;
  }
  return out;
}
