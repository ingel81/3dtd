import { DataTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, RGBAFormat, UnsignedByteType } from 'three';

/**
 * A tiling noise texture for lava (256², RGBA8, built once on the CPU and
 * shared): its crust reads plates, veins and a warp from it instead of
 * evaluating 5-octave noise several times per pixel.
 *
 * - R: plates, a fractal noise (5 octaves)
 * - G: veins, a ridged noise (1 at the ridge of a second fractal)
 * - B, A: a smooth warp field (two low-frequency noises), centred on 0.5
 *
 * Every lattice repeats over the texture, so it tiles without seams.
 */

const SIZE = 256;
let texture: DataTexture | null = null;

export function lavaNoiseTexture(): DataTexture {
  if (texture) return texture;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const plates = fbm(5, 4, 11);
  const ridge = fbm(4, 8, 23);
  const warpX = fbm(2, 2, 37);
  const warpY = fbm(2, 2, 53);
  for (let k = 0; k < SIZE * SIZE; k++) {
    const vein = 1 - Math.min(1, Math.abs(ridge[k] - 0.5) / 0.08);
    data[k * 4] = Math.round(clamp01(plates[k]) * 255);
    data[k * 4 + 1] = Math.round(clamp01(vein) * 255);
    data[k * 4 + 2] = Math.round(clamp01(warpX[k]) * 255);
    data[k * 4 + 3] = Math.round(clamp01(warpY[k]) * 255);
  }
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

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Fractal value noise over the texture, `octaves` from `cells` lattice cells across, normalised to about 0..1 */
function fbm(octaves: number, cells: number, seed: number): Float32Array {
  const out = new Float32Array(SIZE * SIZE);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const lattice = new Float32Array(n * n);
    let s = seed * 7919 + o * 104729;
    for (let i = 0; i < lattice.length; i++) {
      s = (s * 16807) % 2147483647;
      lattice[i] = s / 2147483647;
    }
    for (let y = 0; y < SIZE; y++) {
      const fy = (y / SIZE) * n;
      const y0 = Math.floor(fy);
      const ty = smooth(fy - y0);
      const r0 = (y0 % n) * n;
      const r1 = ((y0 + 1) % n) * n;
      for (let x = 0; x < SIZE; x++) {
        const fx = (x / SIZE) * n;
        const x0 = Math.floor(fx);
        const tx = smooth(fx - x0);
        const c0 = x0 % n;
        const c1 = (x0 + 1) % n;
        const a = lattice[r0 + c0] + (lattice[r0 + c1] - lattice[r0 + c0]) * tx;
        const b = lattice[r1 + c0] + (lattice[r1 + c1] - lattice[r1 + c0]) * tx;
        out[y * SIZE + x] += (a + (b - a) * ty) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  // Stretch around the middle: sums of octaves crowd at 0.5
  for (let i = 0; i < out.length; i++) out[i] = 0.5 + ((out[i] / total) - 0.5) * 1.8;
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
