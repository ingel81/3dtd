/**
 * Runtime Terrain Generator for DevWorld
 *
 * Generates terrain heightmaps at runtime using seeded noise functions.
 * No PNG files needed - everything is computed on demand.
 *
 * Features:
 * - 28 unique terrain presets
 * - Multi-layer domain warping for organic shapes
 * - Hydraulic and thermal erosion simulation
 * - Seeded reproducibility (same seed = same terrain)
 * - Street flattening for gameplay
 */

import {
  SeededNoiseCollection,
  createSeededNoise,
  mulberry32,
  fbm,
  ridged,
  billowed,
  warp,
  multiWarp,
  fastCellular,
  hashSeed,
} from '../utils/seeded-random';

// ========================================
// Types
// ========================================

export type TerrainPreset =
  // Basic
  | 'flat'
  | 'gentle'
  | 'default'
  // Slopes
  | 'slope_ns'
  | 'slope_ew'
  | 'slope_diag'
  // Mountains
  | 'mountains'
  | 'peaks'
  // Valleys
  | 'crater'
  | 'bowl'
  | 'dome'
  // Plateaus
  | 'mesa'
  | 'terraces'
  | 'steps'
  // Cellular
  | 'canyon'
  | 'cells'
  | 'cracks'
  // Waves
  | 'waves'
  | 'dunes'
  | 'ripples'
  // Patterns
  | 'spiral'
  | 'rings'
  // Eroded
  | 'eroded'
  | 'weathered'
  // Biomes
  | 'islands'
  | 'highlands'
  | 'badlands'
  // Extreme
  | 'chaos'
  | 'alien'
  | 'fractal';

export const TERRAIN_PRESETS: TerrainPreset[] = [
  'flat',
  'gentle',
  'default',
  'slope_ns',
  'slope_ew',
  'slope_diag',
  'mountains',
  'peaks',
  'crater',
  'bowl',
  'dome',
  'mesa',
  'terraces',
  'steps',
  'canyon',
  'cells',
  'cracks',
  'waves',
  'dunes',
  'ripples',
  'spiral',
  'rings',
  'eroded',
  'weathered',
  'islands',
  'highlands',
  'badlands',
  'chaos',
  'alien',
  'fractal',
];

export interface TerrainGeneratorConfig {
  /** Terrain preset type */
  preset: TerrainPreset;
  /** Master seed for reproducibility */
  seed: number;
  /** Heightmap resolution (default: 1024) */
  size?: number;
  /** World size in meters (default: 1000) */
  worldSize?: number;
  /** Maximum height in meters (default: 150) */
  maxHeight?: number;
}

type GeneratorFn = (
  x: number,
  z: number,
  noise: SeededNoiseCollection,
  worldSize: number
) => number;

interface PresetConfig {
  /** Base seed offset for this preset */
  seedOffset: number;
  /** Description */
  desc: string;
  /** Generator function - returns normalized height [0, 1] */
  gen: GeneratorFn;
  /** Optional post-processing (erosion, etc.) */
  postProcess?: (data: Float32Array, size: number) => Float32Array;
}

// ========================================
// Erosion Simulation
// ========================================

/**
 * Hydraulic Erosion - simulates water droplets carving terrain.
 * Creates realistic river valleys and erosion patterns.
 */
function hydraulicErosion(
  heightData: Float32Array,
  size: number,
  iterations = 50000
): Float32Array {
  const erosionRadius = 3;
  const inertia = 0.05;
  const sedimentCapacityFactor = 4;
  const minSedimentCapacity = 0.01;
  const erodeSpeed = 0.3;
  const depositSpeed = 0.3;
  const evaporateSpeed = 0.01;
  const gravity = 4;
  const maxDropletLifetime = 30;

  const rng = mulberry32(42);

  for (let iteration = 0; iteration < iterations; iteration++) {
    // Random starting position
    let posX = rng() * (size - 1);
    let posY = rng() * (size - 1);
    let dirX = 0;
    let dirY = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let lifetime = 0; lifetime < maxDropletLifetime; lifetime++) {
      const nodeX = Math.floor(posX);
      const nodeY = Math.floor(posY);
      const cellOffsetX = posX - nodeX;
      const cellOffsetY = posY - nodeY;

      // Calculate droplet's height and direction of flow
      const heightNW = heightData[nodeY * size + nodeX] || 0;
      const heightNE = heightData[nodeY * size + (nodeX + 1)] || 0;
      const heightSW = heightData[(nodeY + 1) * size + nodeX] || 0;
      const heightSE = heightData[(nodeY + 1) * size + (nodeX + 1)] || 0;

      // Calculate gradient
      const gradientX =
        (heightNE - heightNW) * (1 - cellOffsetY) +
        (heightSE - heightSW) * cellOffsetY;
      const gradientY =
        (heightSW - heightNW) * (1 - cellOffsetX) +
        (heightSE - heightNE) * cellOffsetX;

      // Update direction with inertia
      dirX = dirX * inertia - gradientX * (1 - inertia);
      dirY = dirY * inertia - gradientY * (1 - inertia);

      // Normalize direction
      const len = Math.sqrt(dirX * dirX + dirY * dirY);
      if (len !== 0) {
        dirX /= len;
        dirY /= len;
      }

      const newPosX = posX + dirX;
      const newPosY = posY + dirY;

      // Check bounds
      if (
        newPosX < 0 ||
        newPosX >= size - 1 ||
        newPosY < 0 ||
        newPosY >= size - 1
      ) {
        break;
      }

      // Calculate height difference
      const newHeight =
        heightData[Math.floor(newPosY) * size + Math.floor(newPosX)] || 0;
      const oldHeight =
        heightNW * (1 - cellOffsetX) * (1 - cellOffsetY) +
        heightNE * cellOffsetX * (1 - cellOffsetY) +
        heightSW * (1 - cellOffsetX) * cellOffsetY +
        heightSE * cellOffsetX * cellOffsetY;
      const deltaHeight = newHeight - oldHeight;

      // Calculate sediment capacity
      const sedimentCapacity = Math.max(
        -deltaHeight * speed * water * sedimentCapacityFactor,
        minSedimentCapacity
      );

      // Deposit or erode
      if (sediment > sedimentCapacity || deltaHeight > 0) {
        const amountToDeposit =
          deltaHeight > 0
            ? Math.min(deltaHeight, sediment)
            : (sediment - sedimentCapacity) * depositSpeed;
        sediment -= amountToDeposit;

        // Deposit to nearby nodes
        heightData[nodeY * size + nodeX] +=
          amountToDeposit * (1 - cellOffsetX) * (1 - cellOffsetY);
        heightData[nodeY * size + (nodeX + 1)] +=
          amountToDeposit * cellOffsetX * (1 - cellOffsetY);
        heightData[(nodeY + 1) * size + nodeX] +=
          amountToDeposit * (1 - cellOffsetX) * cellOffsetY;
        heightData[(nodeY + 1) * size + (nodeX + 1)] +=
          amountToDeposit * cellOffsetX * cellOffsetY;
      } else {
        const amountToErode = Math.min(
          (sedimentCapacity - sediment) * erodeSpeed,
          -deltaHeight
        );

        // Erode from a radius around current position
        for (let ey = -erosionRadius; ey <= erosionRadius; ey++) {
          for (let ex = -erosionRadius; ex <= erosionRadius; ex++) {
            const erodeX = nodeX + ex;
            const erodeY = nodeY + ey;
            if (
              erodeX >= 0 &&
              erodeX < size &&
              erodeY >= 0 &&
              erodeY < size
            ) {
              const dist = Math.sqrt(ex * ex + ey * ey);
              if (dist <= erosionRadius) {
                const weight = 1 - dist / erosionRadius;
                heightData[erodeY * size + erodeX] -=
                  amountToErode * weight * 0.1;
              }
            }
          }
        }
        sediment += amountToErode;
      }

      // Update droplet
      speed = Math.sqrt(Math.max(0, speed * speed + deltaHeight * gravity));
      water *= 1 - evaporateSpeed;
      posX = newPosX;
      posY = newPosY;
    }
  }

  return heightData;
}

/**
 * Thermal Erosion - simulates material sliding down slopes.
 * Smooths overly steep terrain and creates talus slopes.
 */
function thermalErosion(
  heightData: Float32Array,
  size: number,
  iterations = 5
): Float32Array {
  const talus = 0.01; // Max stable slope
  const erosionAmount = 0.5;

  for (let iter = 0; iter < iterations; iter++) {
    const changes = new Float32Array(size * size);

    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = y * size + x;
        const h = heightData[idx];

        // Check 8 neighbors
        const neighbors = [
          [-1, -1],
          [0, -1],
          [1, -1],
          [-1, 0],
          [1, 0],
          [-1, 1],
          [0, 1],
          [1, 1],
        ];

        let maxDiff = 0;
        let maxNeighbor = -1;

        for (const [dx, dy] of neighbors) {
          const nIdx = (y + dy) * size + (x + dx);
          const diff = h - heightData[nIdx];
          if (diff > maxDiff) {
            maxDiff = diff;
            maxNeighbor = nIdx;
          }
        }

        if (maxDiff > talus && maxNeighbor >= 0) {
          const amount = (maxDiff - talus) * erosionAmount * 0.5;
          changes[idx] -= amount;
          changes[maxNeighbor] += amount;
        }
      }
    }

    for (let i = 0; i < heightData.length; i++) {
      heightData[i] += changes[i];
    }
  }

  return heightData;
}

// ========================================
// Terrain Preset Generators
// ========================================

const GENERATORS: Record<TerrainPreset, PresetConfig> = {
  // ============ BASIC ============

  flat: {
    seedOffset: 0,
    desc: 'Zero height - perfectly flat',
    gen: () => 0,
  },

  gentle: {
    seedOffset: 111,
    desc: 'Subtle rolling hills',
    gen: (x, z, n) => {
      const h = fbm(n.n1, x * 0.002, z * 0.002, 4, 2.0, 0.5);
      return (h + 1) * 0.15;
    },
  },

  default: {
    seedOffset: 42,
    desc: 'Balanced varied terrain',
    gen: (x, z, n) => {
      const w = warp(n.n3, n.n4, x, z, 100, 0.0015);
      let h = fbm(n.n1, w.x * 0.003, w.z * 0.003, 5, 2.0, 0.5);
      h = (h + 1) * 0.5;
      const ridge = ridged(n.n2, x * 0.005, z * 0.005, 3) * 0.3;
      return h * 0.7 + ridge;
    },
  },

  // ============ SLOPES ============

  slope_ns: {
    seedOffset: 200,
    desc: 'North-South slope (50m drop)',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const gradient = (z + halfWorld) / worldSize;
      const noise = fbm(n.n1, x * 0.008, z * 0.008, 3) * 0.1;
      return gradient + noise;
    },
  },

  slope_ew: {
    seedOffset: 201,
    desc: 'East-West slope (50m drop)',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const gradient = (x + halfWorld) / worldSize;
      const noise = fbm(n.n1, x * 0.008, z * 0.008, 3) * 0.1;
      return gradient + noise;
    },
  },

  slope_diag: {
    seedOffset: 202,
    desc: 'Diagonal slope (corner to corner)',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const gradient = (x + halfWorld + z + halfWorld) / (worldSize * 2);
      const noise = fbm(n.n1, x * 0.006, z * 0.006, 4) * 0.15;
      return gradient + noise;
    },
  },

  // ============ MOUNTAINS ============

  mountains: {
    seedOffset: 1337,
    desc: 'Sharp mountain ridges',
    gen: (x, z, n) => {
      // Use multi-layer domain warping for more organic shapes
      const w = multiWarp(n, x, z, 3, 250, 0.001);
      let h = ridged(n.n1, w.x * 0.002, w.z * 0.002, 6, 2.0, 0.6);
      const h2 = ridged(n.n2, w.x * 0.003 + 50, w.z * 0.003, 4);
      h = Math.max(h, h2 * 0.7);
      return Math.pow(h, 0.8);
    },
  },

  peaks: {
    seedOffset: 1338,
    desc: 'Isolated sharp peaks',
    gen: (x, z, n) => {
      const w = multiWarp(n, x, z, 2, 150, 0.002);
      let h = billowed(n.n1, w.x * 0.004, w.z * 0.004, 4, 2.5, 0.4);
      h = Math.pow(h, 2.5); // Make peaks sharper
      const base = fbm(n.n2, x * 0.002, z * 0.002, 3) * 0.1;
      return h * 0.9 + base;
    },
  },

  // ============ DEPRESSIONS ============

  crater: {
    seedOffset: 3000,
    desc: 'Central crater/depression',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const dist = Math.sqrt(x * x + z * z) / halfWorld;
      const h = Math.pow(dist, 0.5); // Bowl shape
      const rim = fbm(n.n1, x * 0.01, z * 0.01, 3) * 0.15 * dist;
      return Math.max(0, h + rim);
    },
  },

  bowl: {
    seedOffset: 3001,
    desc: 'Smooth bowl (low center)',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const dist = Math.sqrt(x * x + z * z) / halfWorld;
      const bowl = Math.pow(dist, 1.5);
      const noise = fbm(n.n1, x * 0.005, z * 0.005, 4) * 0.2 * (1 - dist * 0.5);
      return bowl + noise;
    },
  },

  dome: {
    seedOffset: 3002,
    desc: 'Central dome (high center)',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const dist = Math.sqrt(x * x + z * z) / halfWorld;
      const dome = 1 - Math.pow(dist, 0.7);
      const noise = fbm(n.n1, x * 0.008, z * 0.008, 3) * 0.15;
      return Math.max(0, dome + noise);
    },
  },

  // ============ PLATEAUS ============

  mesa: {
    seedOffset: 4000,
    desc: 'Flat-topped mesas with cliffs',
    gen: (x, z, n) => {
      const w = warp(n.n3, n.n4, x, z, 120, 0.002);
      let h = fbm(n.n1, w.x * 0.003, w.z * 0.003, 4);
      h = (h + 1) * 0.5;
      // Quantize to 4 levels
      const quantized = Math.round(h * 4) / 4;
      return h * 0.1 + quantized * 0.9;
    },
  },

  terraces: {
    seedOffset: 4001,
    desc: 'Rice-paddy style terraces',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const dist = Math.sqrt(x * x + z * z) / halfWorld;
      const angle = Math.atan2(z, x);
      const spiral = (dist + angle / (Math.PI * 2)) * 8;
      const terraced = Math.floor(spiral) / 8;
      const noise = fbm(n.n1, x * 0.01, z * 0.01, 2) * 0.05;
      return terraced + noise;
    },
  },

  steps: {
    seedOffset: 4002,
    desc: 'Giant steps/stairs',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const gradient = (z + halfWorld) / worldSize;
      const stepped = Math.floor(gradient * 6) / 6;
      const noise = fbm(n.n1, x * 0.01, z * 0.01, 2) * 0.03;
      return stepped + noise;
    },
  },

  // ============ CELLULAR ============

  canyon: {
    seedOffset: 5000,
    desc: 'Deep carved canyons',
    gen: (x, z, n) => {
      const cell = fastCellular(x, z, 0.003, 5000);
      const edge = cell.f2 - cell.f1;
      const h = 1 - Math.pow(1 - edge * 2.5, 3);
      const terrain = fbm(n.n1, x * 0.004, z * 0.004, 3) * 0.3;
      return Math.max(0, h * 0.7 + terrain);
    },
  },

  cells: {
    seedOffset: 5001,
    desc: 'Voronoi cell bumps',
    gen: (x, z, n) => {
      const cell = fastCellular(x, z, 0.005, 5001);
      const h = 1 - cell.f1 * 2;
      const noise = fbm(n.n1, x * 0.01, z * 0.01, 2) * 0.1;
      return Math.max(0, h + noise);
    },
  },

  cracks: {
    seedOffset: 5002,
    desc: 'Cracked earth pattern',
    gen: (x, z, n) => {
      const cell = fastCellular(x, z, 0.006, 5002);
      const crack = Math.pow(cell.f2 - cell.f1, 0.3);
      const base = fbm(n.n1, x * 0.003, z * 0.003, 3);
      return base * 0.3 + 0.5 + crack * 0.4;
    },
  },

  // ============ WAVES ============

  waves: {
    seedOffset: 6000,
    desc: 'Ocean wave pattern',
    gen: (x, z, n) => {
      const wave1 = Math.sin(x * 0.02 + z * 0.01) * 0.3;
      const wave2 = Math.sin(x * 0.015 - z * 0.025) * 0.2;
      const wave3 = Math.sin(x * 0.03 + z * 0.02) * 0.1;
      const noise = fbm(n.n1, x * 0.01, z * 0.01, 2) * 0.1;
      return (wave1 + wave2 + wave3 + noise + 1) * 0.5;
    },
  },

  dunes: {
    seedOffset: 6001,
    desc: 'Sand dune ridges',
    gen: (x, z, n) => {
      const w = warp(n.n3, n.n4, x, z, 50, 0.003);
      const dune = Math.abs(Math.sin(w.x * 0.015 + w.z * 0.005));
      const height = Math.pow(dune, 0.7);
      const variation = fbm(n.n1, x * 0.02, z * 0.02, 2) * 0.15;
      return height * 0.8 + variation;
    },
  },

  ripples: {
    seedOffset: 6002,
    desc: 'Concentric ripples',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const dist = Math.sqrt(x * x + z * z);
      const ripple = Math.sin(dist * 0.03) * 0.5 + 0.5;
      const decay = 1 - Math.min(1, dist / halfWorld);
      const noise = fbm(n.n1, x * 0.01, z * 0.01, 2) * 0.1;
      return ripple * decay + noise;
    },
  },

  // ============ PATTERNS ============

  spiral: {
    seedOffset: 7000,
    desc: 'Spiral pattern from center',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const dist = Math.sqrt(x * x + z * z) / halfWorld;
      const angle = Math.atan2(z, x);
      const spiral = (angle / Math.PI + dist * 3) % 1;
      const height = Math.sin(spiral * Math.PI * 2) * 0.5 + 0.5;
      const noise = fbm(n.n1, x * 0.008, z * 0.008, 2) * 0.15;
      return height * (1 - dist * 0.3) + noise;
    },
  },

  rings: {
    seedOffset: 7001,
    desc: 'Concentric elevation rings',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const dist = Math.sqrt(x * x + z * z) / halfWorld;
      const rings = Math.floor(dist * 5) / 5;
      const noise = fbm(n.n1, x * 0.01, z * 0.01, 3) * 0.1;
      return rings + noise;
    },
  },

  // ============ ERODED ============

  eroded: {
    seedOffset: 8000,
    desc: 'Hydraulic erosion carved',
    gen: (x, z, n) => {
      const w = multiWarp(n, x, z, 2, 80, 0.002);
      let h = fbm(n.n1, w.x * 0.004, w.z * 0.004, 5, 2.0, 0.55);
      h = (h + 1) * 0.5;
      const ridge = ridged(n.n2, x * 0.003, z * 0.003, 3) * 0.2;
      return h * 0.8 + ridge;
    },
    postProcess: (data, size) => hydraulicErosion(data, size, 30000),
  },

  weathered: {
    seedOffset: 8001,
    desc: 'Thermal erosion smoothed',
    gen: (x, z, n) => {
      const w = multiWarp(n, x, z, 2, 150, 0.0015);
      const h = ridged(n.n1, w.x * 0.003, w.z * 0.003, 5, 2.0, 0.5);
      return Math.pow(h, 0.9);
    },
    postProcess: (data, size) => thermalErosion(data, size, 10),
  },

  // ============ BIOMES ============

  islands: {
    seedOffset: 9000,
    desc: 'Archipelago islands',
    gen: (x, z, n) => {
      const cell = fastCellular(x, z, 0.004, 9000);
      const island = 1 - cell.f1 * 3;
      const terrain = fbm(n.n1, x * 0.008, z * 0.008, 4) * 0.3;
      const h = Math.max(0, island) + terrain * Math.max(0, island);
      return Math.pow(Math.max(0, h), 1.2);
    },
  },

  highlands: {
    seedOffset: 9001,
    desc: 'Scottish highlands style',
    gen: (x, z, n) => {
      const w = multiWarp(n, x, z, 3, 200, 0.001);
      const base = fbm(n.n1, w.x * 0.002, w.z * 0.002, 4, 2.0, 0.6);
      const ridge = ridged(n.n2, w.x * 0.004, w.z * 0.004, 3) * 0.4;
      const detail = fbm(n.n5, x * 0.02, z * 0.02, 2) * 0.1;
      return (base + 1) * 0.35 + ridge + detail;
    },
  },

  badlands: {
    seedOffset: 9002,
    desc: 'Eroded badlands terrain',
    gen: (x, z, n) => {
      const w = multiWarp(n, x, z, 2, 100, 0.003);
      let h = fbm(n.n1, w.x * 0.005, w.z * 0.005, 5, 2.2, 0.45);
      // Add erosion channels
      const channel = Math.abs(Math.sin(w.x * 0.02) * Math.cos(w.z * 0.015));
      h = (h + 1) * 0.4 - channel * 0.3;
      return Math.max(0, h);
    },
  },

  // ============ EXTREME ============

  chaos: {
    seedOffset: 10000,
    desc: 'Total terrain chaos',
    gen: (x, z, n, worldSize) => {
      const halfWorld = worldSize / 2;
      const dist = Math.sqrt(x * x + z * z) / halfWorld;

      // Mix multiple techniques based on position
      const w1 = multiWarp(n, x, z, 3, 300, 0.0008);
      const ridge = ridged(n.n1, w1.x * 0.002, w1.z * 0.002, 5, 2.0, 0.6);

      const cell = fastCellular(x, z, 0.004, 10000);
      const voronoi = Math.pow(cell.f2 - cell.f1, 0.5);

      const w2 = warp(n.n5, n.n6, x, z, 150, 0.002);
      const bill = billowed(n.n2, w2.x * 0.005, w2.z * 0.005, 4);

      // Blend based on distance from center
      let h: number;
      if (dist < 0.33) {
        h = voronoi * 0.7 + ridge * 0.3;
      } else if (dist < 0.66) {
        h = ridge * 0.6 + bill * 0.4;
      } else {
        h = bill * 0.5 + voronoi * 0.3 + ridge * 0.2;
      }

      return Math.pow(Math.min(1, h * 1.3), 0.7);
    },
  },

  alien: {
    seedOffset: 10001,
    desc: 'Alien landscape',
    gen: (x, z, n) => {
      // Weird combination of techniques
      const cell1 = fastCellular(x, z, 0.003, 10001);
      const cell2 = fastCellular(x + 500, z + 500, 0.005, 10002);

      const base = Math.sin(cell1.f1 * 10) * 0.5 + 0.5;
      const overlay = Math.cos(cell2.f2 * 8) * 0.3;

      const w = multiWarp(n, x, z, 2, 200, 0.001);
      const twist = Math.sin(w.x * 0.01) * Math.cos(w.z * 0.01) * 0.3;

      return Math.max(0, Math.min(1, base + overlay + twist));
    },
  },

  fractal: {
    seedOffset: 10002,
    desc: 'Deep fractal patterns',
    gen: (x, z, n) => {
      // Multiple layers of warped FBM
      let totalH = 0;
      let amp = 1;
      let wx = x;
      let wz = z;

      for (let i = 0; i < 4; i++) {
        const warpResult = warp(n.n3, n.n4, wx, wz, 50 * amp, 0.002 / amp);
        wx = warpResult.x;
        wz = warpResult.z;

        const h = fbm(n.n1, wx * 0.003 * (i + 1), wz * 0.003 * (i + 1), 3);
        totalH += ((h + 1) * 0.5) * amp;
        amp *= 0.5;
      }

      return totalH;
    },
  },
};

// ========================================
// Terrain Generator Class
// ========================================

export class TerrainGenerator {
  private readonly config: Required<TerrainGeneratorConfig>;
  private noise: SeededNoiseCollection;

  constructor(config: TerrainGeneratorConfig) {
    this.config = {
      preset: config.preset,
      seed: config.seed,
      size: config.size ?? 1024,
      worldSize: config.worldSize ?? 1000,
      maxHeight: config.maxHeight ?? 150,
    };

    // Derive terrain-specific seed from master seed
    const presetConfig = GENERATORS[this.config.preset];
    const terrainSeed = hashSeed(this.config.seed, presetConfig.seedOffset);
    this.noise = createSeededNoise(terrainSeed);
  }

  /**
   * Generate heightmap as Float32Array.
   * Values are in meters (0 to maxHeight).
   *
   * @returns Float32Array of size*size height values in meters
   */
  generate(): Float32Array {
    const { size, worldSize, maxHeight, preset } = this.config;
    const presetConfig = GENERATORS[preset];
    const halfWorld = worldSize / 2;

    const data = new Float32Array(size * size);
    let minH = Infinity;
    let maxH = -Infinity;

    // Generate raw heights (normalized 0-1)
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const worldX = (px / size) * worldSize - halfWorld;
        const worldZ = (py / size) * worldSize - halfWorld;

        const h = presetConfig.gen(worldX, worldZ, this.noise, worldSize);
        data[py * size + px] = h;

        minH = Math.min(minH, h);
        maxH = Math.max(maxH, h);
      }
    }

    // Apply post-processing (erosion, etc.) if needed
    if (presetConfig.postProcess) {
      presetConfig.postProcess(data, size);

      // Recalculate min/max after post-processing
      minH = Infinity;
      maxH = -Infinity;
      for (const value of data) {
        minH = Math.min(minH, value);
        maxH = Math.max(maxH, value);
      }
    }

    // Normalize and scale to maxHeight
    const range = maxH - minH || 1;
    for (let i = 0; i < data.length; i++) {
      if (preset === 'flat') {
        data[i] = 0;
      } else {
        const normalized = (data[i] - minH) / range;
        data[i] = Math.max(0, Math.min(1, normalized)) * maxHeight;
      }
    }

    return data;
  }

  /**
   * Get height at a specific world position.
   * Uses bilinear interpolation for smooth values between grid points.
   *
   * @param worldX - X position in world coordinates
   * @param worldZ - Z position in world coordinates
   * @param heightData - Pre-generated height data from generate()
   * @returns Height in meters at the given position
   */
  getHeightAt(worldX: number, worldZ: number, heightData: Float32Array): number {
    const { size, worldSize } = this.config;
    const halfWorld = worldSize / 2;

    // Convert world coordinates to heightmap coordinates
    const px = ((worldX + halfWorld) / worldSize) * (size - 1);
    const py = ((worldZ + halfWorld) / worldSize) * (size - 1);

    // Clamp to valid range
    const x0 = Math.max(0, Math.min(size - 2, Math.floor(px)));
    const y0 = Math.max(0, Math.min(size - 2, Math.floor(py)));
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    // Fractional parts for interpolation
    const fx = px - x0;
    const fy = py - y0;

    // Bilinear interpolation
    const h00 = heightData[y0 * size + x0];
    const h10 = heightData[y0 * size + x1];
    const h01 = heightData[y1 * size + x0];
    const h11 = heightData[y1 * size + x1];

    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;

    return h0 * (1 - fy) + h1 * fy;
  }

  /**
   * Get the preset configuration.
   */
  getPresetConfig(): PresetConfig {
    return GENERATORS[this.config.preset];
  }

  /**
   * Get the full configuration.
   */
  getConfig(): Required<TerrainGeneratorConfig> {
    return { ...this.config };
  }
}

/**
 * Get description for a terrain preset.
 */
export function getTerrainPresetDescription(preset: TerrainPreset): string {
  return GENERATORS[preset]?.desc ?? 'Unknown preset';
}

/**
 * Get all terrain presets grouped by category.
 */
export function getTerrainCategories(): { name: string; presets: TerrainPreset[] }[] {
  return [
    { name: 'Basic', presets: ['flat', 'gentle', 'default'] },
    { name: 'Slopes', presets: ['slope_ns', 'slope_ew', 'slope_diag'] },
    { name: 'Mountains', presets: ['mountains', 'peaks'] },
    { name: 'Valleys', presets: ['crater', 'bowl', 'dome'] },
    { name: 'Plateaus', presets: ['mesa', 'terraces', 'steps'] },
    { name: 'Cellular', presets: ['canyon', 'cells', 'cracks'] },
    { name: 'Waves', presets: ['waves', 'dunes', 'ripples'] },
    { name: 'Patterns', presets: ['spiral', 'rings'] },
    { name: 'Eroded', presets: ['eroded', 'weathered'] },
    { name: 'Biomes', presets: ['islands', 'highlands', 'badlands'] },
    { name: 'Extreme', presets: ['chaos', 'alien', 'fractal'] },
  ];
}
