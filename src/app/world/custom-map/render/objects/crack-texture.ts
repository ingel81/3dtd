import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGFormat, UnsignedByteType } from 'three';

/**
 * The cracks of a damaged building (ruin-damage.ts), drawn once as lines,
 * not noise: noise reads as dirt, a crack is a line that runs, forks and
 * thins out. Two channels of one tile that repeats (each line wraps round
 * its edges): red holds hairlines, short and many, green the few long
 * cracks that run across a wall and branch. The shader lays the tile over
 * the walls in metres from three sides (triplanar), so no model needs UVs
 * for it.
 */

/** Texels a side; one repeat covers CRACK_TILE_M metres of wall */
export const CRACK_SIZE = 256;
export const CRACK_TILE_M = 4;

/** Small deterministic random numbers: the same cracks on every machine and in every test */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A line from (x0, y0) to (x1, y1), `width` texels wide, into channel `c` (0 red, 1 green), wrapped round the tile */
function stroke(data: Uint8Array, c: number, x0: number, y0: number, x1: number, y1: number, width: number): void {
  const n = CRACK_SIZE;
  const half = width / 2 + 1;
  const minX = Math.floor(Math.min(x0, x1) - half);
  const maxX = Math.ceil(Math.max(x0, x1) + half);
  const minY = Math.floor(Math.min(y0, y1) - half);
  const maxY = Math.ceil(Math.max(y0, y1) + half);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      // Distance of the texel's middle to the segment
      const px = x + 0.5 - x0;
      const py = y + 0.5 - y0;
      const t = Math.min(1, Math.max(0, (px * dx + py * dy) / len2));
      const ex = px - dx * t;
      const ey = py - dy * t;
      const d = Math.sqrt(ex * ex + ey * ey);
      // Soft by one texel at the edge, so the mip levels thin it out instead of breaking it up
      const v = Math.min(1, Math.max(0, width / 2 - d + 0.5));
      if (v <= 0) continue;
      const at = ((((y % n) + n) % n) * n + (((x % n) + n) % n)) * 2 + c;
      const value = Math.round(v * 255);
      if (value > data[at]) data[at] = value;
    }
  }
}

/**
 * One crack: a run of short steps whose heading wanders, thinning from
 * `width` to a hairline, now and then forking off a thinner branch
 */
function crack(data: Uint8Array, c: number, rnd: () => number, x: number, y: number, heading: number, length: number, width: number, depth: number): void {
  let walked = 0;
  while (walked < length) {
    const step = 2.5 + rnd() * 3.5;
    // Mostly straight with a kink now and then: a crack follows the weakest line, it does not curl
    heading += (rnd() - 0.5) * (rnd() < 0.15 ? 1.4 : 0.45);
    const nx = x + Math.cos(heading) * step;
    const ny = y + Math.sin(heading) * step;
    const w = Math.max(0.6, width * (1 - walked / length) + 0.35);
    stroke(data, c, x, y, nx, ny, w);
    if (depth > 0 && rnd() < 0.09) {
      const side = rnd() < 0.5 ? -1 : 1;
      crack(data, c, rnd, nx, ny, heading + side * (0.5 + rnd() * 0.6), (length - walked) * (0.35 + rnd() * 0.3), w * 0.65, depth - 1);
    }
    x = nx;
    y = ny;
    walked += step;
  }
}

/** The tile's texels (red hairlines, green long cracks), two bytes each */
export function crackTexels(seed = 7): Uint8Array {
  const data = new Uint8Array(CRACK_SIZE * CRACK_SIZE * 2);
  const rnd = random(seed);
  // Long cracks: from a corner of a window or a joint, across most of the tile
  for (let i = 0; i < 6; i++) {
    crack(data, 1, rnd, rnd() * CRACK_SIZE, rnd() * CRACK_SIZE, rnd() * Math.PI * 2, 90 + rnd() * 120, 3.2 + rnd() * 1.6, 2);
  }
  // Hairlines: short, thin, often in little clusters
  for (let i = 0; i < 34; i++) {
    const x = rnd() * CRACK_SIZE;
    const y = rnd() * CRACK_SIZE;
    const k = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < k; j++) crack(data, 0, rnd, x + (rnd() - 0.5) * 12, y + (rnd() - 0.5) * 12, rnd() * Math.PI * 2, 12 + rnd() * 34, 1.2 + rnd() * 0.6, 1);
  }
  return data;
}

let shared: DataTexture | null = null;

/** The crack tile as a repeating texture with mip levels, made once for every view */
export function crackTexture(): DataTexture {
  if (!shared) {
    const t = new DataTexture(crackTexels(), CRACK_SIZE, CRACK_SIZE, RGFormat, UnsignedByteType);
    t.wrapS = t.wrapT = RepeatWrapping;
    t.magFilter = LinearFilter;
    t.minFilter = LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.name = 'ruin-cracks';
    t.needsUpdate = true;
    shared = t;
  }
  return shared;
}
