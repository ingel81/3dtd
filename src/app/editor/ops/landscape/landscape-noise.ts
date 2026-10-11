/**
 * Noise and hashing for the landscape brushes. Everything is a function of
 * the stroke's seed and the map position, never of how often or where the
 * mouse stopped, so a stroke gives the same land however it was painted.
 */
import type { NoiseFunction2D } from 'simplex-noise';
import { billowed, createSeededNoise, fbm, ridged, type SeededNoiseCollection } from '../../../devworld/utils/seeded-random';

export class LandscapeNoise {
  private readonly n: SeededNoiseCollection;

  constructor(readonly seed: number) {
    this.n = createSeededNoise(seed);
  }

  /** Smooth layered noise in about [-1, 1] at wavelength `wave` metres */
  fbm(x: number, y: number, wave: number, octaves = 4, which: keyof SeededNoiseCollection = 'n1'): number {
    return fbm(this.n[which] as NoiseFunction2D, x / wave, y / wave, octaves);
  }

  /** Sharp ridges in [0, 1] */
  ridged(x: number, y: number, wave: number, octaves = 5): number {
    return ridged(this.n.n2, x / wave, y / wave, octaves);
  }

  /** Soft rounded bumps in [0, 1] (dunes) */
  billowed(x: number, y: number, wave: number, octaves = 3): number {
    return billowed(this.n.n3, x / wave, y / wave, octaves);
  }

  /** Ragged edge factor in [0, 1]: noise that frays the rim of a brush */
  fray(x: number, y: number): number {
    return 0.5 + 0.5 * this.fbm(x, y, 9, 3, 'n4');
  }

  /** A uniform number in [0, 1) for an integer cell and a channel */
  hash(i: number, j: number, channel = 0): number {
    return hashCell(i, j, this.seed * 31 + channel);
  }
}

/** Integer hash of a cell to [0, 1) */
export function hashCell(i: number, j: number, seed: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** smoothstep from edge0 to edge1 */
export function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A fresh stroke seed */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}
