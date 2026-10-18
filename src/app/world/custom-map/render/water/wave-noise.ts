/**
 * A tiling normal texture of sums of waves with whole-number frequencies
 * (so it repeats seamlessly), shared by all water surfaces (256², RGBA8,
 * baked once in a worker).
 */
import type { DataTexture } from 'three';
import { BakedNoise } from '../baked-noise';

const SIZE = 256;

/** The texture's texels (RGBA8, SIZE²): the bake, on whichever thread runs it */
export function bakeWaves(): Uint8Array {
  const size = SIZE;
  const data = new Uint8Array(size * size * 4);
  let seed = 11;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const list = Array.from({ length: 24 }, (_, n) => {
    const freq = 1 + Math.floor(rnd() * (3 + n));
    const angle = rnd() * Math.PI * 2;
    return {
      kx: Math.round(Math.cos(angle) * freq),
      ky: Math.round(Math.sin(angle) * freq),
      amp: 1 / (1 + n * 0.35),
      phase: rnd() * Math.PI * 2,
    };
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of list) {
        const a = ((w.kx * x + w.ky * y) / size) * Math.PI * 2 + w.phase;
        const c = Math.cos(a) * w.amp;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const nx = -dx * 0.02;
      const ny = -dy * 0.02;
      const len = Math.hypot(nx, ny, 1);
      const q = (y * size + x) * 4;
      data[q] = Math.round((nx / len) * 127.5 + 127.5);
      data[q + 1] = Math.round((ny / len) * 127.5 + 127.5);
      data[q + 2] = Math.round((1 / len) * 127.5 + 127.5);
      data[q + 3] = 255;
    }
  }
  return data;
}

/** Baked in a worker (baked-noise.ts); a still surface until then */
const NOISE = new BakedNoise('waves', { size: SIZE, neutral: [128, 128, 255, 255] }, bakeWaves);

/** The shared texture, at once (its bake: prepareWaves) */
export function waveTexture(): DataTexture {
  return NOISE.texture();
}

/** Bakes the texture once; a view starts it as it loads and its `ready` waits for it */
export function prepareWaves(): Promise<void> {
  return NOISE.prepare();
}
