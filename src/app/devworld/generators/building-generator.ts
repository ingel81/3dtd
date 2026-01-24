/**
 * Runtime Building Generator for DevWorld
 *
 * Generates building placements at runtime using seeded randomness.
 * Buildings serve as LOS blockers for gameplay strategy.
 *
 * Features:
 * - 70% buildings along streets (strategic positions)
 * - 30% random clusters (variety)
 * - Density levels: none, sparse, medium, dense
 * - No overlap detection
 * - Respects HQ safe zone
 */

import { mulberry32, hashSeed } from '../utils/seeded-random';
import { StreetSegment } from './street-generator';

// ========================================
// Types
// ========================================

export type BuildingDensity = 'none' | 'sparse' | 'medium' | 'dense' | 'maze';

export interface BuildingConfig {
  id: string;
  position: { x: number; z: number };
  size: { width: number; height: number; depth: number };
  rotation?: number;
}

export interface BuildingGeneratorConfig {
  /** Master seed for reproducibility */
  seed: number;
  /** Building density level */
  density: BuildingDensity;
  /** Street segments for placement along streets */
  streetSegments: StreetSegment[];
  /** World size in meters (default: 1000) */
  worldSize?: number;
  /** HQ position - buildings avoid this area */
  hqPosition?: { x: number; z: number };
  /** Minimum distance from HQ (default: 60) */
  hqSafeRadius?: number;
  /** Function to sample terrain height at position */
  terrainSampler?: (x: number, z: number) => number;
}

interface Vec2 {
  x: number;
  z: number;
}

// ========================================
// Building Presets (sizes and heights)
// ========================================

interface BuildingPreset {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  minDepth: number;
  maxDepth: number;
}

const BUILDING_PRESETS: Record<string, BuildingPreset> = {
  small: {
    minWidth: 6,
    maxWidth: 10,
    minHeight: 6,
    maxHeight: 12,
    minDepth: 6,
    maxDepth: 10,
  },
  medium: {
    minWidth: 10,
    maxWidth: 18,
    minHeight: 10,
    maxHeight: 20,
    minDepth: 10,
    maxDepth: 16,
  },
  large: {
    minWidth: 16,
    maxWidth: 28,
    minHeight: 15,
    maxHeight: 30,
    minDepth: 16,
    maxDepth: 25,
  },
  tower: {
    minWidth: 10,
    maxWidth: 16,
    minHeight: 25,
    maxHeight: 50,
    minDepth: 10,
    maxDepth: 16,
  },
  warehouse: {
    minWidth: 20,
    maxWidth: 35,
    minHeight: 8,
    maxHeight: 14,
    minDepth: 15,
    maxDepth: 25,
  },
};

// Density configurations - DRASTICALLY different for visual distinction!
// All buildings are placed along streets (no clusters without street access)
const DENSITY_CONFIGS: Record<BuildingDensity, {
  totalBuildings: number;
  presetWeights: Record<string, number>;
}> = {
  none: {
    totalBuildings: 0,
    presetWeights: {},
  },
  sparse: {
    totalBuildings: 150,  // Just a few strategic buildings
    presetWeights: { medium: 0.5, large: 0.5 },
  },
  medium: {
    totalBuildings: 400,
    presetWeights: { small: 0.3, medium: 0.4, large: 0.2, warehouse: 0.1 },
  },
  dense: {
    totalBuildings: 1200,  // Packed city feel
    presetWeights: { small: 0.4, medium: 0.35, large: 0.15, tower: 0.1 },
  },
  maze: {
    totalBuildings: 2000,  // Labyrinth of walls and obstacles
    presetWeights: { small: 0.7, medium: 0.3 },  // Mostly small blockers
  },
};

// ========================================
// Vector Utilities
// ========================================

function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.z - a.z) ** 2);
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function _perpendicular(a: Vec2, b: Vec2): Vec2 {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 0.001) return { x: 1, z: 0 };
  return { x: -dz / len, z: dx / len };
}

/**
 * Calculate minimum distance from point to line segment
 */
function distanceToSegment(point: Vec2, segFrom: Vec2, segTo: Vec2): number {
  const dx = segTo.x - segFrom.x;
  const dz = segTo.z - segFrom.z;
  const segLenSq = dx * dx + dz * dz;

  if (segLenSq < 0.001) {
    return distance(point, segFrom);
  }

  // Project point onto line, clamped to segment
  const t = Math.max(0, Math.min(1,
    ((point.x - segFrom.x) * dx + (point.z - segFrom.z) * dz) / segLenSq
  ));

  const projection = {
    x: segFrom.x + t * dx,
    z: segFrom.z + t * dz,
  };

  return distance(point, projection);
}

// ========================================
// Building Generator
// ========================================

export class BuildingGenerator {
  private readonly config: Required<BuildingGeneratorConfig>;
  private rng: () => number;
  private buildings: BuildingConfig[] = [];
  private buildingIdCounter = 0;

  constructor(config: BuildingGeneratorConfig) {
    this.config = {
      seed: config.seed,
      density: config.density,
      streetSegments: config.streetSegments,
      worldSize: config.worldSize ?? 1000,
      hqPosition: config.hqPosition ?? { x: 0, z: 0 },
      hqSafeRadius: config.hqSafeRadius ?? 60,
      terrainSampler: config.terrainSampler ?? (() => 0),
    };

    // Initialize RNG with building-specific seed
    const buildingSeed = hashSeed(this.config.seed, 53271);
    this.rng = mulberry32(buildingSeed);
  }

  /**
   * Generate building placements.
   * All buildings are placed along streets for realistic village layout.
   */
  generate(): BuildingConfig[] {
    const densityConfig = DENSITY_CONFIGS[this.config.density];

    if (densityConfig.totalBuildings === 0) {
      return [];
    }

    this.buildings = [];
    this.buildingIdCounter = 0;

    // All buildings along streets (no isolated clusters)
    this.placeAlongStreets(densityConfig.totalBuildings, densityConfig.presetWeights);

    console.log(
      `[BuildingGen] Generated ${this.buildings.length} buildings along streets`
    );

    return this.buildings;
  }

  /**
   * Place buildings along street segments - simple row-house style.
   * Buildings are aligned parallel to their street.
   */
  private placeAlongStreets(
    count: number,
    presetWeights: Record<string, number>
  ): void {
    const { streetSegments, hqPosition, hqSafeRadius } = this.config;

    if (streetSegments.length === 0) {
      this.placeGrid(count, presetWeights);
      return;
    }

    // Calculate segment lengths and filter viable ones (min 50m)
    const viableSegments: { segment: typeof streetSegments[0]; length: number; angle: number }[] = [];
    for (const segment of streetSegments) {
      const from = { x: segment.from[0], z: segment.from[1] };
      const to = { x: segment.to[0], z: segment.to[1] };
      const len = distance(from, to);
      if (len >= 50) {
        // Pre-calculate street angle
        const angle = Math.atan2(to.z - from.z, to.x - from.x);
        viableSegments.push({ segment, length: len, angle });
      }
    }

    if (viableSegments.length === 0) {
      this.placeGrid(count, presetWeights);
      return;
    }

    // Shuffle for variety
    this.shuffle(viableSegments);

    let placed = 0;
    const ROAD_HALF_WIDTH = 5; // Half width of road + small clearance
    const BUILDING_GAP = 2; // Gap between buildings
    const ROW_GAP = 3; // Gap between rows
    const MAX_ROWS = 4; // Maximum building rows per side

    // Process each segment - build on both sides, multiple rows
    for (const { segment, length, angle } of viableSegments) {
      if (placed >= count) break;

      const from = { x: segment.from[0], z: segment.from[1] };
      const to = { x: segment.to[0], z: segment.to[1] };

      // Perpendicular direction (rotated 90 degrees)
      const perpX = -Math.sin(angle);
      const perpZ = Math.cos(angle);

      // Build on BOTH sides
      for (const side of [1, -1]) {
        if (placed >= count) break;

        // Build MULTIPLE ROWS per side
        let currentRowOffset = ROAD_HALF_WIDTH;

        for (let row = 0; row < MAX_ROWS && placed < count; row++) {
          // Walk along the segment for this row
          let currentDist = 8 + this.rng() * 5; // Staggered start

          while (currentDist < length - 8 && placed < count) {
            const t = currentDist / length;
            const streetPoint = lerp(from, to, t);

            // Select building size - smaller for denser packing
            const preset = this.selectPreset(presetWeights);
            const sizeScale = 0.4 + this.rng() * 0.3; // 40-70% of max size
            const buildingWidth = preset.minWidth + (preset.maxWidth - preset.minWidth) * sizeScale;
            const buildingDepth = preset.minDepth + (preset.maxDepth - preset.minDepth) * sizeScale;
            const buildingHeight = preset.minHeight + this.rng() * (preset.maxHeight - preset.minHeight);

            // Position: offset perpendicular from street
            const offset = currentRowOffset + buildingDepth / 2;
            const position = {
              x: streetPoint.x + perpX * offset * side,
              z: streetPoint.z + perpZ * offset * side,
            };

            // Advance along street for next building
            currentDist += buildingWidth + BUILDING_GAP;

            // Skip if too close to HQ
            if (distance(position, hqPosition) < hqSafeRadius) continue;

            // Skip if out of bounds
            if (!this.isInBounds(position)) continue;

            // Building rotation: use NEGATIVE angle because Three.js rotation.y
            // rotates the local X-axis to direction -θ, not +θ
            const buildingRotation = -angle;

            // Skip if building footprint overlaps any street
            if (this.buildingOverlapsStreet(position, buildingWidth, buildingDepth, buildingRotation)) continue;

            // Create building
            const building: BuildingConfig = {
              id: `building-${this.buildingIdCounter++}`,
              position: { x: position.x, z: position.z },
              size: { width: buildingWidth, height: buildingHeight, depth: buildingDepth },
              rotation: buildingRotation,
            };

            // Check for overlap with existing buildings
            if (this.overlapsExisting(building)) continue;

            this.buildings.push(building);
            placed++;
          }

          // Move to next row (further from street)
          const avgDepth = (BUILDING_PRESETS['small'].minDepth + BUILDING_PRESETS['medium'].minDepth) / 2;
          currentRowOffset += avgDepth + ROW_GAP;
        }
      }
    }

    console.log(`[BuildingGen] Placed ${placed}/${count} buildings along streets (no grid fallback)`);
  }


  /**
   * Fallback grid placement when no streets are available.
   */
  private placeGrid(
    count: number,
    presetWeights: Record<string, number>
  ): void {
    const { worldSize, hqPosition, hqSafeRadius } = this.config;
    const halfWorld = worldSize / 2;
    const margin = 30; // Stay away from world edges

    // Generate MORE grid positions than needed to account for overlaps
    const gridSize = Math.ceil(Math.sqrt(count * 4)); // 4x oversampling
    const spacing = (worldSize - margin * 2) / gridSize;
    const positions: Vec2[] = [];

    for (let gx = 0; gx < gridSize; gx++) {
      for (let gz = 0; gz < gridSize; gz++) {
        const x = -halfWorld + margin + spacing * (gx + 0.5) + (this.rng() - 0.5) * spacing * 0.3;
        const z = -halfWorld + margin + spacing * (gz + 0.5) + (this.rng() - 0.5) * spacing * 0.3;

        // Skip if too close to HQ
        if (distance({ x, z }, hqPosition) < hqSafeRadius) continue;

        // Skip if too close to streets (don't block them)
        if (this.overlapsStreet({ x, z }, 15)) continue;

        positions.push({ x, z });
      }
    }

    // Shuffle for variety
    this.shuffle(positions);

    let placed = 0;
    for (let i = 0; i < positions.length && placed < count; i++) {
      const pos = positions[i];
      const preset = this.selectPreset(presetWeights);

      // Random size within preset range
      const width = preset.minWidth + this.rng() * (preset.maxWidth - preset.minWidth) * 0.6;
      const height = preset.minHeight + this.rng() * (preset.maxHeight - preset.minHeight);
      const depth = preset.minDepth + this.rng() * (preset.maxDepth - preset.minDepth) * 0.6;

      // Find nearest street and align to it (max 60m away)
      const nearest = this.findNearestStreet(pos, 60);
      let rotation: number;
      if (nearest) {
        // Use NEGATIVE angle because Three.js rotation.y rotates X-axis to -θ
        rotation = -nearest.angle;
      } else {
        // No nearby street - use cardinal direction (0, 90, 180, 270 degrees)
        rotation = Math.floor(this.rng() * 4) * (Math.PI / 2);
      }

      // Check if building footprint overlaps any street
      if (this.buildingOverlapsStreet(pos, width, depth, rotation)) continue;

      const building: BuildingConfig = {
        id: `building-${this.buildingIdCounter++}`,
        position: { x: pos.x, z: pos.z },
        size: { width, height, depth },
        rotation,
      };

      if (!this.overlapsExisting(building)) {
        this.buildings.push(building);
        placed++;
      }
    }

    console.log(`[BuildingGen] Grid placed ${placed}/${count} buildings`);
  }

  /**
   * Select a building preset based on weights.
   */
  private selectPreset(weights: Record<string, number>): BuildingPreset {
    const entries = Object.entries(weights);
    const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
    let r = this.rng() * totalWeight;

    for (const [name, weight] of entries) {
      r -= weight;
      if (r <= 0) {
        return BUILDING_PRESETS[name];
      }
    }

    return BUILDING_PRESETS['medium'];
  }

  /**
   * Find the nearest street segment and return its direction angle.
   * Simple and robust: just use the angle of the nearest segment directly.
   */
  private findNearestStreet(position: Vec2, maxDistance = 100): { from: Vec2; to: Vec2; dist: number; angle: number } | null {
    let nearestFrom: Vec2 | null = null;
    let nearestTo: Vec2 | null = null;
    let minDist = maxDistance;

    // Find the nearest segment
    for (const segment of this.config.streetSegments) {
      const from = { x: segment.from[0], z: segment.from[1] };
      const to = { x: segment.to[0], z: segment.to[1] };
      const dist = distanceToSegment(position, from, to);

      if (dist < minDist) {
        minDist = dist;
        nearestFrom = from;
        nearestTo = to;
      }
    }

    if (!nearestFrom || !nearestTo) return null;

    // Calculate angle of the nearest segment directly
    const angle = Math.atan2(nearestTo.z - nearestFrom.z, nearestTo.x - nearestFrom.x);

    return { from: nearestFrom, to: nearestTo, dist: minDist, angle };
  }

  /**
   * Check if position is within world bounds.
   */
  private isInBounds(position: Vec2): boolean {
    const { worldSize } = this.config;
    const halfWorld = worldSize / 2;
    const margin = 50; // Keep away from edges

    return (
      position.x > -halfWorld + margin &&
      position.x < halfWorld - margin &&
      position.z > -halfWorld + margin &&
      position.z < halfWorld - margin
    );
  }

  /**
   * Check if building overlaps with existing buildings.
   */
  private overlapsExisting(building: BuildingConfig): boolean {
    const margin = 5; // Minimum gap between buildings

    for (const existing of this.buildings) {
      // Simple AABB check (ignoring rotation for simplicity)
      const dx = Math.abs(building.position.x - existing.position.x);
      const dz = Math.abs(building.position.z - existing.position.z);

      const minDistX =
        (building.size.width + existing.size.width) / 2 + margin;
      const minDistZ =
        (building.size.depth + existing.size.depth) / 2 + margin;

      if (dx < minDistX && dz < minDistZ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a building overlaps any street segment.
   * Takes building size into account, not just center point.
   */
  private overlapsStreet(position: Vec2, minDistance: number): boolean {
    for (const segment of this.config.streetSegments) {
      const from = { x: segment.from[0], z: segment.from[1] };
      const to = { x: segment.to[0], z: segment.to[1] };

      const dist = distanceToSegment(position, from, to);
      if (dist < minDistance) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a building (with its full footprint) overlaps any street.
   * Checks corners, edge midpoints, and center - 9 points total.
   */
  private buildingOverlapsStreet(position: Vec2, width: number, depth: number, rotation: number): boolean {
    const ROAD_CLEARANCE = 6; // Minimum clearance from road edge

    const halfW = width / 2;
    const halfD = depth / 2;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    // Helper to rotate a local offset to world position
    const toWorld = (dx: number, dz: number): Vec2 => ({
      x: position.x + (dx * cos - dz * sin),
      z: position.z + (dx * sin + dz * cos),
    });

    // Check 9 points: center, 4 corners, 4 edge midpoints
    const points: Vec2[] = [
      toWorld(0, 0),           // Center
      toWorld(halfW, halfD),   // Corner: +X +Z
      toWorld(-halfW, halfD),  // Corner: -X +Z
      toWorld(halfW, -halfD),  // Corner: +X -Z
      toWorld(-halfW, -halfD), // Corner: -X -Z
      toWorld(halfW, 0),       // Edge mid: +X
      toWorld(-halfW, 0),      // Edge mid: -X
      toWorld(0, halfD),       // Edge mid: +Z
      toWorld(0, -halfD),      // Edge mid: -Z
    ];

    for (const point of points) {
      if (this.overlapsStreet(point, ROAD_CLEARANCE)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Fisher-Yates shuffle.
   */
  private shuffle<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}
