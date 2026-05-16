/**
 * Seeded Random Utilities for DevWorld
 *
 * Provides deterministic random number generation and noise functions
 * for reproducible terrain, street, and building generation.
 *
 * All functions are seeded - same seed = same output.
 */

import { createNoise2D, NoiseFunction2D } from 'simplex-noise';

// ========================================
// PRNG - Mulberry32
// ========================================

/**
 * Mulberry32 PRNG - fast, deterministic pseudo-random number generator.
 * Returns a function that generates numbers in [0, 1).
 *
 * @param seed - Integer seed value
 * @returns Function that returns random numbers [0, 1)
 */
export function mulberry32(seed: number): () => number {
  return function (): number {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ========================================
// Seeded Noise Collection
// ========================================

export interface SeededNoiseCollection {
  /** Primary noise function */
  n1: NoiseFunction2D;
  /** Secondary noise function */
  n2: NoiseFunction2D;
  /** Tertiary noise function (often used for warping) */
  n3: NoiseFunction2D;
  /** Fourth noise function (often used for warping) */
  n4: NoiseFunction2D;
  /** Fifth noise function (detail layers) */
  n5: NoiseFunction2D;
  /** Sixth noise function (detail layers) */
  n6: NoiseFunction2D;
}

/**
 * Creates a collection of seeded simplex noise functions.
 * Each noise function in the collection is independent but deterministic.
 *
 * @param seed - Integer seed value
 * @returns Collection of 6 seeded noise functions
 */
export function createSeededNoise(seed: number): SeededNoiseCollection {
  const rng = mulberry32(seed);
  return {
    n1: createNoise2D(rng),
    n2: createNoise2D(rng),
    n3: createNoise2D(rng),
    n4: createNoise2D(rng),
    n5: createNoise2D(rng),
    n6: createNoise2D(rng),
  };
}

// ========================================
// Noise Functions
// ========================================

/**
 * Fractional Brownian Motion (FBM) - Standard layered noise.
 * Creates natural-looking terrain with multiple detail levels.
 *
 * @param noise - Noise function to use
 * @param x - X coordinate
 * @param z - Z coordinate
 * @param octaves - Number of noise layers (more = more detail)
 * @param lacunarity - Frequency multiplier per octave (default: 2.0)
 * @param gain - Amplitude multiplier per octave (default: 0.5)
 * @returns Normalized value roughly in [-1, 1]
 */
export function fbm(
  noise: NoiseFunction2D,
  x: number,
  z: number,
  octaves: number,
  lacunarity = 2.0,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    sum += noise(x * freq, z * freq) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return sum / maxAmp;
}

/**
 * Ridged Multifractal Noise - Creates sharp mountain ridges.
 * Uses absolute value and inversion for ridge-like features.
 *
 * @param noise - Noise function to use
 * @param x - X coordinate
 * @param z - Z coordinate
 * @param octaves - Number of noise layers
 * @param lacunarity - Frequency multiplier per octave (default: 2.0)
 * @param gain - Amplitude multiplier per octave (default: 0.5)
 * @returns Normalized value in [0, 1]
 */
export function ridged(
  noise: NoiseFunction2D,
  x: number,
  z: number,
  octaves: number,
  lacunarity = 2.0,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    let n = noise(x * freq, z * freq);
    n = 1 - Math.abs(n); // Invert absolute value
    n = n * n; // Sharpen ridges
    sum += n * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return sum / maxAmp;
}

/**
 * Billowed/Turbulence Noise - Creates soft, cloud-like bumps.
 * Uses absolute value for smooth rounded features.
 *
 * @param noise - Noise function to use
 * @param x - X coordinate
 * @param z - Z coordinate
 * @param octaves - Number of noise layers
 * @param lacunarity - Frequency multiplier per octave (default: 2.0)
 * @param gain - Amplitude multiplier per octave (default: 0.5)
 * @returns Normalized value in [0, 1]
 */
export function billowed(
  noise: NoiseFunction2D,
  x: number,
  z: number,
  octaves: number,
  lacunarity = 2.0,
  gain = 0.5
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    sum += Math.abs(noise(x * freq, z * freq)) * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return sum / maxAmp;
}

// ========================================
// Domain Warping
// ========================================

export interface WarpResult {
  x: number;
  z: number;
}

/**
 * Domain Warping - Distorts coordinates for organic shapes.
 * Creates twisted, naturally flowing terrain features.
 *
 * @param n1 - First noise function for X displacement
 * @param n2 - Second noise function for Z displacement
 * @param x - X coordinate
 * @param z - Z coordinate
 * @param strength - How far to warp (in world units)
 * @param scale - Noise frequency scale
 * @returns Warped coordinates
 */
export function warp(
  n1: NoiseFunction2D,
  n2: NoiseFunction2D,
  x: number,
  z: number,
  strength: number,
  scale: number
): WarpResult {
  const wx = n1(x * scale, z * scale) * strength;
  const wz = n2(x * scale + 100, z * scale + 100) * strength;
  return { x: x + wx, z: z + wz };
}

/**
 * Multi-layer Domain Warping - Creates more organic shapes.
 * Recommended by terrain expert for natural-looking terrain.
 *
 * @param noise - Noise collection
 * @param x - X coordinate
 * @param z - Z coordinate
 * @param iterations - Number of warp iterations (default: 3)
 * @param strength - Base warp strength
 * @param scale - Base noise scale
 * @returns Warped coordinates
 */
export function multiWarp(
  noise: SeededNoiseCollection,
  x: number,
  z: number,
  iterations = 3,
  strength = 100,
  scale = 0.002
): WarpResult {
  let wx = x;
  let wz = z;
  let currentStrength = strength;
  let currentScale = scale;

  const noiseFuncs = [
    [noise.n3, noise.n4],
    [noise.n5, noise.n6],
    [noise.n1, noise.n2],
  ];

  for (let i = 0; i < iterations; i++) {
    const [n1, n2] = noiseFuncs[i % noiseFuncs.length];
    const result = warp(n1, n2, wx, wz, currentStrength, currentScale);
    wx = result.x;
    wz = result.z;
    currentStrength *= 0.6;
    currentScale *= 1.5;
  }

  return { x: wx, z: wz };
}

// ========================================
// Cellular/Voronoi Noise
// ========================================

export interface CellularResult {
  /** Distance to nearest cell point */
  f1: number;
  /** Distance to second nearest cell point */
  f2: number;
}

/**
 * Fast Voronoi with spatial hash - optimized version.
 * Uses pre-computed jitter for consistent cell positions.
 *
 * @param x - X coordinate
 * @param z - Z coordinate
 * @param scale - Cell density
 * @param seed - Seed for cell positions
 * @returns Distances to nearest and second-nearest cell points
 */
export function fastCellular(
  x: number,
  z: number,
  scale: number,
  seed: number
): CellularResult {
  const sx = x * scale;
  const sz = z * scale;
  const cellX = Math.floor(sx);
  const cellZ = Math.floor(sz);

  let minDist = 8; // Max possible distance in 3x3 grid
  let secondDist = 8;

  // Unrolled loop for better performance
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = cellX + i;
      const cz = cellZ + j;

      // Fast hash: multiply by large primes and take fractional part
      const h = Math.sin(cx * 127.1 + cz * 311.7 + seed) * 43758.5453;
      const px = cx + (h - Math.floor(h));

      const h2 = Math.sin(cx * 269.5 + cz * 183.3 + seed) * 43758.5453;
      const pz = cz + (h2 - Math.floor(h2));

      const dx = sx - px;
      const dz = sz - pz;
      const dist = dx * dx + dz * dz; // Squared distance for speed

      if (dist < minDist) {
        secondDist = minDist;
        minDist = dist;
      } else if (dist < secondDist) {
        secondDist = dist;
      }
    }
  }

  // Return actual distances (sqrt)
  return { f1: Math.sqrt(minDist), f2: Math.sqrt(secondDist) };
}

/**
 * Hash a seed to get a different but deterministic seed.
 * Useful for deriving sub-seeds from a master seed.
 */
export function hashSeed(seed: number, salt: number): number {
  return Math.abs(Math.imul(seed, 0x9e3779b9) ^ salt);
}
