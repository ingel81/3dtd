import type { MapBiome } from '../../map-document';

/**
 * How the ground of a biome reads the land's shape (E214): the terrain
 * shader knows crests, hollows and runnels (ground-occlusion.ts) and large
 * patches (variation-texture.ts); this says what they look like here. A
 * temperate crest dries to straw while its hollow stays deep green; in the
 * marsh the hollows are peat and the runnels bleed iron; in the desert the
 * crests bleach, the hollows carry desert varnish and the runnels salt.
 *
 * Tints multiply the painted ground's colour (1 keeps it); `bare` is the
 * colour of the earth that shows where the turf tears on steep, convex
 * slopes; `saturation` scales the colour of the whole ground.
 */
export interface GroundMood {
  crest: [number, number, number];
  hollow: [number, number, number];
  drain: [number, number, number];
  /** Large patches: one kind (dry, sunlit) and its counterpart (lush, cool) */
  patchA: [number, number, number];
  patchB: [number, number, number];
  bare: [number, number, number];
  saturation: number;
}

const TEMPERATE: GroundMood = {
  crest: [1.13, 1.06, 0.82],
  hollow: [0.8, 0.95, 0.86],
  drain: [0.78, 0.92, 0.84],
  patchA: [1.13, 1.05, 0.76],
  patchB: [0.8, 0.94, 0.9],
  bare: [0.29, 0.22, 0.15],
  saturation: 0.93,
};

export const GROUND_MOODS: Record<MapBiome, GroundMood> = {
  temperate: TEMPERATE,
  city: { ...TEMPERATE, crest: [1.08, 1.04, 0.9], patchA: [1.07, 1.03, 0.88], saturation: 0.9 },
  mountain: {
    crest: [1.06, 1.04, 0.92],
    hollow: [0.82, 0.97, 0.86],
    drain: [0.8, 0.92, 0.9],
    patchA: [1.08, 1.04, 0.84],
    patchB: [0.88, 0.95, 0.98],
    bare: [0.32, 0.29, 0.26],
    saturation: 0.86,
  },
  swamp: {
    crest: [1.08, 1.03, 0.8],
    hollow: [0.6, 0.58, 0.5],
    drain: [1.06, 0.76, 0.52],
    patchA: [1.07, 1.02, 0.74],
    patchB: [0.76, 0.86, 0.74],
    bare: [0.14, 0.11, 0.075],
    saturation: 0.88,
  },
  desert: {
    crest: [1.1, 1.06, 0.97],
    hollow: [0.84, 0.74, 0.66],
    drain: [1.16, 1.13, 1.08],
    patchA: [1.07, 1.0, 0.88],
    patchB: [0.9, 0.86, 0.82],
    bare: [0.48, 0.36, 0.24],
    saturation: 1,
  },
  arctic: {
    crest: [1.04, 1.04, 1.05],
    hollow: [0.85, 0.91, 1.04],
    drain: [0.84, 0.91, 1.06],
    patchA: [1.05, 1.03, 0.97],
    patchB: [0.9, 0.95, 1.05],
    bare: [0.3, 0.28, 0.27],
    saturation: 1,
  },
  hell: {
    crest: [0.96, 0.93, 0.9],
    hollow: [0.8, 0.62, 0.55],
    drain: [0.74, 0.6, 0.55],
    patchA: [1.02, 0.96, 0.92],
    patchB: [0.85, 0.8, 0.8],
    bare: [0.11, 0.09, 0.08],
    saturation: 1,
  },
  moon: {
    crest: [1.07, 1.07, 1.07],
    hollow: [0.8, 0.8, 0.82],
    drain: [0.86, 0.86, 0.88],
    patchA: [1.05, 1.05, 1.04],
    patchB: [0.92, 0.92, 0.93],
    bare: [0.3, 0.3, 0.3],
    saturation: 1,
  },
  mars: {
    crest: [1.1, 1.0, 0.9],
    hollow: [0.78, 0.66, 0.6],
    drain: [0.86, 0.72, 0.66],
    patchA: [1.08, 0.98, 0.88],
    patchB: [0.88, 0.8, 0.78],
    bare: [0.34, 0.19, 0.11],
    saturation: 1,
  },
  apocalypse: {
    crest: [1.1, 1.04, 0.78],
    hollow: [0.8, 0.84, 0.8],
    drain: [0.74, 0.72, 0.66],
    patchA: [1.12, 1.04, 0.74],
    patchB: [0.85, 0.85, 0.82],
    bare: [0.25, 0.22, 0.18],
    saturation: 0.8,
  },
};

export function groundMood(biome: MapBiome | undefined): GroundMood {
  return GROUND_MOODS[biome ?? 'temperate'] ?? TEMPERATE;
}
