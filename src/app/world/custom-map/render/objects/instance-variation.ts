/**
 * How one plant differs from the next of its model, from a hash of its id
 * (the same object keeps its look across rebuilds and on every client): its
 * brightness and a hue drift, a size, and for trees a lean. All of it
 * goes into the instance's matrix and colour, so a forest of one model
 * looks grown, not cloned, without a draw call more. Autumn foliage
 * (catalogue tag `autumn`) spreads further, between red, rust and yellow:
 * a stand of one autumn model turns at its own pace, tree by tree.
 */

/** Size of a tree against its object's scale: 0.88 to 1.12 */
const TREE_SIZE = 0.12;
/** Size of other vegetation against its object's scale: 0.92 to 1.08 */
const PLANT_SIZE = 0.08;
/** Most a tree leans off the vertical, radians (about 4 degrees) */
const TREE_LEAN = 0.07;

export interface InstanceVariation {
  /** Factor on the object's scale */
  size: number;
  /** Lean off the vertical (radians) and the map direction it leans toward (radians from map +x) */
  lean: number;
  leanToward: number;
  /** Factors on the instance colour */
  r: number;
  g: number;
  b: number;
}

/** Fractions in 0..1 from an object's id, FNV-1a and two more mixes */
function idHashes(id: string): [number, number, number, number, number, number] {
  let h = 2166136261;
  for (let k = 0; k < id.length; k++) h = Math.imul(h ^ id.charCodeAt(k), 16777619);
  let g = Math.imul(h ^ (h >>> 15), 2246822519);
  g = Math.imul(g ^ (g >>> 13), 3266489917);
  g ^= g >>> 16;
  return [
    ((h >>> 0) % 1000) / 1000,
    ((h >>> 10) % 1000) / 1000,
    ((h >>> 20) % 1000) / 1000,
    ((g >>> 0) % 1000) / 1000,
    ((g >>> 10) % 1000) / 1000,
    ((g >>> 20) % 1000) / 1000,
  ];
}

/**
 * The variation of an object of `category` with the catalogue's `tags`:
 * trees get size and lean, plants a smaller size spread, both a shade
 * (other categories only a shade, used where they are tinted)
 */
export function instanceVariation(id: string, category: string, tags?: readonly string[]): InstanceVariation {
  const [r1, r2, r3, r4, r5, r6] = idHashes(id);
  const tree = category === 'tree';
  // Rocks, buildings and props keep the size they were placed at
  const size = tree || category === 'plant' ? 1 + (r5 * 2 - 1) * (tree ? TREE_SIZE : PLANT_SIZE) : 1;
  // Most stand nearly upright, a few lean clearly
  const lean = tree ? TREE_LEAN * r6 * r6 : 0;
  const leanToward = r4 * Math.PI * 2;
  if (tags?.includes('autumn')) {
    // Wider brightness, and a turn from red (less green) through rust to yellow (less blue) on the leaves' own colour
    const v = 0.76 + r1 * 0.4;
    const turn = r2 * 2 - 1;
    return {
      size,
      lean,
      leanToward,
      r: v * (1 + r3 * 0.12),
      g: v * (0.86 + turn * 0.24),
      b: v * (0.96 - Math.max(0, turn) * 0.3),
    };
  }
  // Brightness, then a hue drift: some crowns yellower, some bluer, a few turning early
  const v = 0.8 + r1 * 0.32;
  const turning = tree && r3 > 0.93 ? 1 : 0;
  // Trees drift further along green to olive: a stand of one model reads as several
  const olive = tree ? (r4 - 0.5) * 0.12 : 0;
  return {
    size,
    lean,
    leanToward,
    r: v * (0.92 + r2 * 0.16 + turning * 0.25 + olive),
    g: v * (0.96 + r3 * 0.06),
    b: v * (1.06 - r2 * 0.2 - turning * 0.2 - olive),
  };
}
