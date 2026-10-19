/**
 * The shapes the fight leaves in the ground (docs/DESTRUCTION_PLAN.md): a
 * crater, a bowl with a low wall round it, and a heap of rubble where a
 * structure fell. One function per shape for everything that reads them:
 * the simulation's stamp raster (the height and pace of the enemies), the
 * ground the main thread draws and the editor's impact brush.
 *
 * Whole centimetres out of `+ - * /` alone, no `Math.sqrt` or `Math.exp`:
 * IEEE 754 makes those the same on every engine, so every coop client and
 * every replay stamps the same raster. A shape is a function of the squared
 * distance, nothing needs the distance itself.
 */

/** A crater's wall: its height as a share of the depth, and where it peaks (squared distance over the squared radius) */
export const CRATER_LIP = { share: 0.16, peak: 1.1, halfWidth: 0.7 } as const;

/** Out to this squared distance over the squared radius a crater reaches, its wall included */
export const CRATER_REACH_SQ = CRATER_LIP.peak + CRATER_LIP.halfWidth;

/**
 * Centimetres a crater of `radius` m and `depthCm` changes the ground at
 * squared distance `d2` (m²) from its middle: down to -depthCm in the
 * middle, the bowl's floor round and its rim smooth ((1 - s)² (1 + 2s) of
 * s = d2 / r², flat at both ends), a wall of CRATER_LIP's share of the depth
 * just outside the rim. 0 beyond CRATER_REACH_SQ.
 */
export function craterCm(d2: number, radius: number, depthCm: number): number {
  const r2 = radius * radius;
  if (r2 <= 0 || depthCm <= 0) return 0;
  const s = d2 / r2;
  if (s >= CRATER_REACH_SQ) return 0;
  let cm = 0;
  if (s < 1) {
    const u = 1 - s;
    cm -= depthCm * u * u * (1 + 2 * s);
  }
  const w = (s - CRATER_LIP.peak) / CRATER_LIP.halfWidth;
  if (w > -1 && w < 1) {
    const v = 1 - w * w;
    cm += depthCm * CRATER_LIP.share * v * v;
  }
  return Math.trunc(cm);
}

/**
 * Centimetres a heap of `radius` m with its top `peakCm` high raises the
 * ground at squared distance `d2` (m²) from its middle: flat on top, its
 * foot running out smooth ((1 - s)² (1 + 2s) of s = d2 / r²). 0 beyond the radius.
 */
export function rubbleCm(d2: number, radius: number, peakCm: number): number {
  const r2 = radius * radius;
  if (r2 <= 0 || peakCm <= 0) return 0;
  const s = d2 / r2;
  if (s >= 1) return 0;
  const u = 1 - s;
  return Math.trunc(peakCm * u * u * (1 + 2 * s));
}

/** Edge of the patches a heap of rubble is lumpy in, m */
export const RUBBLE_LUMP_M = 1.6;

/**
 * The lumps of a heap at map point (`x`, `y`): a factor 0.7 to 1.15 on its
 * height, one per RUBBLE_LUMP_M patch from an integer hash of the patch, so
 * a heap is a pile of chunks and slabs, not a smooth dome. The point's
 * frame decides the patches: the simulation's field and the drawn ground ask
 * it in map metres (`x` east as the map has it), the same patch for the
 * same spot on every engine.
 */
export function rubbleLump(x: number, y: number): number {
  let h = Math.imul(Math.floor(x / RUBBLE_LUMP_M), 0x27d4eb2d) ^ Math.imul(Math.floor(y / RUBBLE_LUMP_M), 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return 0.7 + ((h >>> 0) % 1000) * 0.00045;
}
