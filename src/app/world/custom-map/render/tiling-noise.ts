/**
 * Tiling fractal value noise on the CPU, for noise textures the shaders read
 * instead of evaluating noise per pixel (lava-noise.ts, variation-texture.ts).
 * Every lattice repeats over the texture, so it tiles without seams.
 */

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Fractal value noise over a `size`² texture, `octaves` from `cells` lattice
 * cells across, about 0..1 around 0.5 (`stretch` widens it: sums of octaves
 * crowd at the middle). `warp` bends the sample point by a coarse noise
 * first (in texels), which gives rounder, more natural blots than the
 * lattice's squares.
 */
export function tilingFbm(size: number, octaves: number, cells: number, seed: number, stretch = 1.8, warp = 0): Float32Array {
  const out = new Float32Array(size * size);
  const lattices: { n: number; values: Float32Array; amp: number }[] = [];
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const values = new Float32Array(n * n);
    let s = seed * 7919 + o * 104729;
    for (let i = 0; i < values.length; i++) {
      s = (s * 16807) % 2147483647;
      values[i] = s / 2147483647;
    }
    lattices.push({ n, values, amp });
    total += amp;
    amp *= 0.5;
  }
  const bend = warp > 0 ? [lattice(Math.max(2, cells >> 1), seed + 101), lattice(Math.max(2, cells >> 1), seed + 211)] : null;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let px = x;
      let py = y;
      if (bend) {
        px += (sample(bend[0], x / size, y / size) - 0.5) * warp;
        py += (sample(bend[1], x / size, y / size) - 0.5) * warp;
      }
      let v = 0;
      for (const l of lattices) v += sample(l, px / size, py / size) * l.amp;
      out[y * size + x] = clamp01(0.5 + (v / total - 0.5) * stretch);
    }
  }
  return out;
}

function lattice(n: number, seed: number): { n: number; values: Float32Array } {
  const values = new Float32Array(n * n);
  let s = seed * 7919 + 13;
  for (let i = 0; i < values.length; i++) {
    s = (s * 16807) % 2147483647;
    values[i] = s / 2147483647;
  }
  return { n, values };
}

/** Smooth value noise of a lattice at texture coordinates (repeating) */
function sample(l: { n: number; values: Float32Array }, u: number, v: number): number {
  const n = l.n;
  const fx = (((u % 1) + 1) % 1) * n;
  const fy = (((v % 1) + 1) % 1) * n;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);
  const x1 = (x0 + 1) % n;
  const y1 = (y0 + 1) % n;
  const r0 = y0 * n;
  const r1 = y1 * n;
  const a = l.values[r0 + x0] + (l.values[r0 + x1] - l.values[r0 + x0]) * tx;
  const b = l.values[r1 + x0] + (l.values[r1 + x1] - l.values[r1 + x0]) * tx;
  return a + (b - a) * ty;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
