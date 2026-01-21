/**
 * DevWorld Worker Types
 *
 * Type definitions for communication between main thread and DevWorld worker.
 */

import { StreetSegment, SpawnPoint } from './generators/street-generator';
import { BuildingConfig, BuildingDensity } from './generators/building-generator';
import { TerrainPreset } from './generators/terrain-generator';

// ========================================
// Worker Input Messages
// ========================================

export interface DevWorldWorkerConfig {
  seed: number;
  worldSize: number;
  heightmapSize: number;
  maxHeight: number;
  terrainPreset: TerrainPreset;
  buildingDensity: BuildingDensity;
  hqPosition: { x: number; z: number };
}

export interface GenerateMessage {
  type: 'generate';
  config: DevWorldWorkerConfig;
}

export type DevWorldWorkerMessage = GenerateMessage;

// ========================================
// Worker Output Messages
// ========================================

export interface ProgressMessage {
  type: 'progress';
  phase: 'terrain' | 'streets' | 'buildings';
  progress: number; // 0-100
}

export interface ResultMessage {
  type: 'result';
  heightData: Float32Array;
  streetSegments: StreetSegment[];
  spawnPoints: SpawnPoint[];
  buildingConfigs: BuildingConfig[];
  timing: {
    terrain: number;
    streets: number;
    buildings: number;
    total: number;
  };
}

export interface ErrorMessage {
  type: 'error';
  error: string;
}

export type DevWorldWorkerResponse = ProgressMessage | ResultMessage | ErrorMessage;
