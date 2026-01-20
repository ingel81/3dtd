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

export type BuildingDensity = 'none' | 'sparse' | 'medium' | 'dense';

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
    minWidth: 15,
    maxWidth: 25,
    minHeight: 12,
    maxHeight: 20,
    minDepth: 15,
    maxDepth: 25,
  },
  medium: {
    minWidth: 25,
    maxWidth: 45,
    minHeight: 18,
    maxHeight: 35,
    minDepth: 25,
    maxDepth: 45,
  },
  large: {
    minWidth: 40,
    maxWidth: 70,
    minHeight: 25,
    maxHeight: 50,
    minDepth: 40,
    maxDepth: 60,
  },
  tower: {
    minWidth: 20,
    maxWidth: 35,
    minHeight: 40,
    maxHeight: 80,
    minDepth: 20,
    maxDepth: 35,
  },
  warehouse: {
    minWidth: 50,
    maxWidth: 80,
    minHeight: 15,
    maxHeight: 25,
    minDepth: 40,
    maxDepth: 70,
  },
};

// Density configurations
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
    totalBuildings: 25,
    presetWeights: { small: 0.4, medium: 0.4, large: 0.2 },
  },
  medium: {
    totalBuildings: 50,
    presetWeights: { small: 0.35, medium: 0.4, large: 0.2, warehouse: 0.05 },
  },
  dense: {
    totalBuildings: 80,
    presetWeights: { small: 0.35, medium: 0.35, large: 0.2, warehouse: 0.1 },
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

function perpendicular(a: Vec2, b: Vec2): Vec2 {
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
    const STREET_OFFSET = 22; // Distance from street center to building center
    const BUILDING_SPACING = 8; // Gap between buildings along street

    // Process each segment
    for (const { segment, length, angle } of viableSegments) {
      if (placed >= count) break;

      const from = { x: segment.from[0], z: segment.from[1] };
      const to = { x: segment.to[0], z: segment.to[1] };

      // Perpendicular direction (rotated 90 degrees)
      const perpX = -Math.sin(angle);
      const perpZ = Math.cos(angle);

      // Decide which side(s) to build on
      const sides: number[] = length > 100 ? [1, -1] : [this.rng() > 0.5 ? 1 : -1];

      for (const side of sides) {
        if (placed >= count) break;

        // Walk along the segment
        let currentDist = 15; // Start 15m from segment start

        while (currentDist < length - 15 && placed < count) {
          const t = currentDist / length;
          const streetPoint = lerp(from, to, t);

          // Select building size
          const preset = this.selectPreset(presetWeights);
          const buildingWidth = preset.minWidth + this.rng() * (preset.maxWidth - preset.minWidth) * 0.5;
          const buildingDepth = preset.minDepth + this.rng() * (preset.maxDepth - preset.minDepth) * 0.5;
          const buildingHeight = preset.minHeight + this.rng() * (preset.maxHeight - preset.minHeight);

          // Position: offset perpendicular from street
          const offset = STREET_OFFSET + buildingDepth / 2;
          const position = {
            x: streetPoint.x + perpX * offset * side,
            z: streetPoint.z + perpZ * offset * side,
          };

          // Advance along street for next building
          currentDist += buildingWidth + BUILDING_SPACING;

          // Skip if too close to HQ
          if (distance(position, hqPosition) < hqSafeRadius) continue;

          // Skip if out of bounds
          if (!this.isInBounds(position)) continue;

          // Skip if overlapping any street
          if (this.overlapsStreet(position, Math.max(buildingWidth, buildingDepth) / 2 + 5)) continue;

          // Create building - rotation is street angle (building width along street)
          const building: BuildingConfig = {
            id: `building-${this.buildingIdCounter++}`,
            position: { x: position.x, z: position.z },
            size: { width: buildingWidth, height: buildingHeight, depth: buildingDepth },
            rotation: angle + (this.rng() - 0.5) * 0.08, // Small variation ±2.3°
          };

          // Check for overlap with existing buildings
          if (this.overlapsExisting(building)) continue;

          this.buildings.push(building);
          placed++;
        }
      }
    }

    console.log(`[BuildingGen] Placed ${placed}/${count} buildings along streets`);
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

    // Generate grid positions
    const gridSize = Math.ceil(Math.sqrt(count * 2));
    const spacing = worldSize / gridSize;
    const positions: Vec2[] = [];

    for (let gx = 0; gx < gridSize; gx++) {
      for (let gz = 0; gz < gridSize; gz++) {
        const x = -halfWorld + spacing * (gx + 0.5) + (this.rng() - 0.5) * spacing * 0.4;
        const z = -halfWorld + spacing * (gz + 0.5) + (this.rng() - 0.5) * spacing * 0.4;

        if (distance({ x, z }, hqPosition) >= hqSafeRadius) {
          positions.push({ x, z });
        }
      }
    }

    // Shuffle and take required count
    this.shuffle(positions);

    for (let i = 0; i < Math.min(count, positions.length); i++) {
      const preset = this.selectPreset(presetWeights);
      const building = this.createBuilding(positions[i], preset);

      if (!this.overlapsExisting(building)) {
        this.buildings.push(building);
      }
    }
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
   * Create a building configuration.
   * Aligns parallel to nearby street if provided.
   */
  private createBuilding(
    position: Vec2,
    preset: BuildingPreset,
    streetFrom?: Vec2,
    streetTo?: Vec2
  ): BuildingConfig {
    // Random size within preset range
    const width =
      preset.minWidth + this.rng() * (preset.maxWidth - preset.minWidth);
    const height =
      preset.minHeight + this.rng() * (preset.maxHeight - preset.minHeight);
    const depth =
      preset.minDepth + this.rng() * (preset.maxDepth - preset.minDepth);

    let rotation: number;
    if (streetFrom && streetTo) {
      // Align parallel to street
      const streetAngle = Math.atan2(
        streetTo.z - streetFrom.z,
        streetTo.x - streetFrom.x
      );
      rotation = streetAngle + (this.rng() - 0.5) * 0.1;
    } else {
      // Find nearest street and align to it
      const nearest = this.findNearestStreet(position);
      if (nearest) {
        const streetAngle = Math.atan2(
          nearest.to.z - nearest.from.z,
          nearest.to.x - nearest.from.x
        );
        rotation = streetAngle + (this.rng() - 0.5) * 0.1;
      } else {
        // Random rotation if no street nearby
        rotation = this.rng() * Math.PI * 2;
      }
    }

    return {
      id: `building-${this.buildingIdCounter++}`,
      position: { x: position.x, z: position.z },
      size: { width, height, depth },
      rotation,
    };
  }

  /**
   * Find the nearest street segment to a position.
   */
  private findNearestStreet(position: Vec2): { from: Vec2; to: Vec2 } | null {
    let nearest: { from: Vec2; to: Vec2 } | null = null;
    let minDist = Infinity;

    for (const segment of this.config.streetSegments) {
      const from = { x: segment.from[0], z: segment.from[1] };
      const to = { x: segment.to[0], z: segment.to[1] };
      const dist = distanceToSegment(position, from, to);

      if (dist < minDist) {
        minDist = dist;
        nearest = { from, to };
      }
    }

    return nearest;
  }

  /**
   * Create a building with pre-calculated dimensions, aligned parallel to street.
   */
  private createBuildingAligned(
    position: Vec2,
    dimensions: { width: number; depth: number },
    preset: BuildingPreset,
    streetFrom: Vec2,
    streetTo: Vec2
  ): BuildingConfig {
    const height =
      preset.minHeight + this.rng() * (preset.maxHeight - preset.minHeight);

    // Align parallel to street direction
    const streetAngle = Math.atan2(
      streetTo.z - streetFrom.z,
      streetTo.x - streetFrom.x
    );

    // Building is parallel to street with small variation (±3 degrees)
    const rotation = streetAngle + (this.rng() - 0.5) * 0.1;

    return {
      id: `building-${this.buildingIdCounter++}`,
      position: { x: position.x, z: position.z },
      size: { width: dimensions.width, height, depth: dimensions.depth },
      rotation,
    };
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
   * Check if position is too close to any street segment.
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
   * Fisher-Yates shuffle.
   */
  private shuffle<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
}
