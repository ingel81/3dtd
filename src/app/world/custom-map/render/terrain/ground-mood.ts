import type { MapBiome } from '../../map-document';

/**
 * How the ground of a biome reads the land's shape (E214): the terrain
 * shader knows crests, hollows and runnels (ground-occlusion.ts), the edges
 * of roads and paths (a coarse level of the path mask), the feet of steep
 * ground and the shore (grid normals), and large patches
 * (variation-texture.ts); this says what they look like here. A temperate
 * crest dries to straw while its hollow stays deep green, level grass
 * carries islands of clover in flower, paths have trodden earthen rims, a
 * lake a pale gravel shore; in the marsh the hollows are peat and the
 * runnels bleed iron; in the desert the crests bleach, the hollows carry
 * desert varnish and the runnels salt.
 *
 * Tints multiply the painted ground's colour (1 keeps it); `bare`, `worn`,
 * `shore` and `flower` are colours (sRGB 0..1): the earth where turf tears
 * on steep slopes, the trodden rims of roads and paths, the strip along the
 * water, the bloom on the clover islands (`clover` tints their sward).
 * `saturation` scales the colour of the whole ground.
 */
export interface GroundMood {
  crest: [number, number, number];
  hollow: [number, number, number];
  drain: [number, number, number];
  /** Large patches: one kind (dry, sunlit) and its counterpart (lush, cool) */
  patchA: [number, number, number];
  patchB: [number, number, number];
  bare: [number, number, number];
  worn: [number, number, number];
  shore: [number, number, number];
  clover: [number, number, number];
  flower: [number, number, number];
  saturation: number;
}

const TEMPERATE: GroundMood = {
  crest: [1.16, 1.07, 0.76],
  hollow: [0.74, 0.92, 0.8],
  drain: [0.7, 0.88, 0.78],
  patchA: [1.2, 1.08, 0.66],
  patchB: [0.76, 0.94, 0.86],
  bare: [0.29, 0.22, 0.15],
  worn: [0.4, 0.32, 0.23],
  shore: [0.6, 0.55, 0.45],
  clover: [0.74, 1.0, 0.76],
  flower: [0.9, 0.87, 0.64],
  saturation: 0.93,
};

export const GROUND_MOODS: Record<MapBiome, GroundMood> = {
  temperate: TEMPERATE,
  city: { ...TEMPERATE, crest: [1.08, 1.04, 0.9], patchA: [1.07, 1.03, 0.88], worn: [0.42, 0.38, 0.32], saturation: 0.9 },
  mountain: {
    crest: [1.08, 1.05, 0.88],
    hollow: [0.78, 0.96, 0.82],
    drain: [0.74, 0.9, 0.86],
    patchA: [1.1, 1.05, 0.82],
    patchB: [0.86, 0.95, 0.98],
    bare: [0.32, 0.29, 0.26],
    worn: [0.42, 0.38, 0.33],
    shore: [0.56, 0.55, 0.52],
    clover: [0.86, 1.0, 0.86],
    flower: [0.7, 0.58, 0.78],
    saturation: 0.86,
  },
  swamp: {
    crest: [1.1, 1.04, 0.78],
    hollow: [0.52, 0.5, 0.42],
    drain: [1.1, 0.72, 0.46],
    patchA: [1.09, 1.03, 0.72],
    patchB: [0.72, 0.84, 0.7],
    bare: [0.14, 0.11, 0.075],
    worn: [0.2, 0.16, 0.11],
    shore: [0.24, 0.2, 0.14],
    clover: [0.86, 0.98, 0.78],
    flower: [0.84, 0.84, 0.78],
    saturation: 0.88,
  },
  desert: {
    crest: [1.12, 1.07, 0.96],
    hollow: [0.78, 0.68, 0.6],
    drain: [1.2, 1.16, 1.1],
    patchA: [1.09, 1.01, 0.86],
    patchB: [0.88, 0.84, 0.8],
    bare: [0.48, 0.36, 0.24],
    worn: [0.6, 0.48, 0.34],
    shore: [0.7, 0.62, 0.5],
    clover: [1, 1, 1],
    flower: [0.7, 0.62, 0.5],
    saturation: 1,
  },
  arctic: {
    crest: [1.05, 1.05, 1.06],
    hollow: [0.82, 0.89, 1.04],
    drain: [0.8, 0.89, 1.06],
    patchA: [1.06, 1.03, 0.96],
    patchB: [0.88, 0.94, 1.05],
    bare: [0.3, 0.28, 0.27],
    worn: [0.66, 0.68, 0.72],
    shore: [0.62, 0.66, 0.72],
    clover: [1, 1, 1],
    flower: [0.9, 0.92, 0.95],
    saturation: 1,
  },
  hell: {
    crest: [0.96, 0.93, 0.9],
    hollow: [0.76, 0.58, 0.5],
    drain: [0.7, 0.56, 0.5],
    patchA: [1.02, 0.96, 0.92],
    patchB: [0.85, 0.8, 0.8],
    bare: [0.11, 0.09, 0.08],
    worn: [0.16, 0.13, 0.11],
    shore: [0.14, 0.12, 0.11],
    clover: [1, 1, 1],
    flower: [0.3, 0.2, 0.16],
    saturation: 1,
  },
  moon: {
    crest: [1.08, 1.08, 1.08],
    hollow: [0.76, 0.76, 0.78],
    drain: [0.84, 0.84, 0.86],
    patchA: [1.06, 1.06, 1.05],
    patchB: [0.9, 0.9, 0.91],
    bare: [0.3, 0.3, 0.3],
    worn: [0.36, 0.36, 0.36],
    shore: [0.4, 0.4, 0.4],
    clover: [1, 1, 1],
    flower: [0.4, 0.4, 0.4],
    saturation: 1,
  },
  mars: {
    crest: [1.12, 1.0, 0.88],
    hollow: [0.74, 0.62, 0.56],
    drain: [0.84, 0.7, 0.62],
    patchA: [1.1, 0.98, 0.86],
    patchB: [0.86, 0.78, 0.76],
    bare: [0.34, 0.19, 0.11],
    worn: [0.42, 0.26, 0.16],
    shore: [0.46, 0.3, 0.2],
    clover: [1, 1, 1],
    flower: [0.46, 0.3, 0.2],
    saturation: 1,
  },
  apocalypse: {
    crest: [1.12, 1.05, 0.74],
    hollow: [0.76, 0.82, 0.76],
    drain: [0.7, 0.68, 0.62],
    patchA: [1.14, 1.05, 0.72],
    patchB: [0.84, 0.84, 0.8],
    bare: [0.25, 0.22, 0.18],
    worn: [0.32, 0.29, 0.25],
    shore: [0.3, 0.28, 0.24],
    clover: [0.94, 1, 0.9],
    flower: [0.62, 0.58, 0.44],
    saturation: 0.8,
  },
};

export function groundMood(biome: MapBiome | undefined): GroundMood {
  return GROUND_MOODS[biome ?? 'temperate'] ?? TEMPERATE;
}
