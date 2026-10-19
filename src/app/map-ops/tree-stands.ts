/**
 * Trees grow in stands of an age: a young stand is small, an old one tall,
 * a tree a little either side of its stand's. Placing trees (the scatter
 * brush, OSM woods) takes their scale from where they stand (standScale),
 * so a wood of one model reads as grown in its own time, not one size
 * scattered evenly. Written into the document's `scale` when the tree is
 * placed: maps already made keep theirs, and every client reads the same.
 * The mean over a wood stays the placer's middle scale (the line of sight
 * sees as much tree on average as before).
 */

/** Edge of a cell of the stands' age field, m */
const STAND_CELL = 42;
/** A stand's size from young to old, against the placer's middle scale */
const STAND_SIZE: readonly [number, number] = [0.68, 1.3];
/** A tree's own spread round its stand's size */
const OWN_SIZE = 0.08;

/** A repeatable fraction for a cell of the field and a seed */
function cellHash(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The age of the stand at map point (x, y), 0 young to 1 old: smooth value
 * noise over cells of STAND_CELL, its middle values eased apart so stands
 * read as young or old more than as middling
 */
export function standAge(x: number, y: number, seed = 0): number {
  const gx = x / STAND_CELL;
  const gy = y / STAND_CELL;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const sx = (gx - i) * (gx - i) * (3 - 2 * (gx - i));
  const sy = (gy - j) * (gy - j) * (3 - 2 * (gy - j));
  const a = cellHash(i, j, seed) + (cellHash(i + 1, j, seed) - cellHash(i, j, seed)) * sx;
  const b = cellHash(i, j + 1, seed) + (cellHash(i + 1, j + 1, seed) - cellHash(i, j + 1, seed)) * sx;
  const v = a + (b - a) * sy;
  return v * v * (3 - 2 * v);
}

/**
 * The scale of a tree placed at (x, y) whose placer would pick from
 * [`min`, `max`]: their middle times its stand's size (0.68 to 1.3) and its
 * own (`own` 0..1 spreads it 0.92 to 1.08)
 */
export function standScale(x: number, y: number, min: number, max: number, own: number, seed = 0): number {
  const stand = STAND_SIZE[0] + (STAND_SIZE[1] - STAND_SIZE[0]) * standAge(x, y, seed);
  return ((min + max) / 2) * stand * (1 + (own * 2 - 1) * OWN_SIZE);
}
