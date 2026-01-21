/**
 * DevWorld Generation Worker
 *
 * Runs terrain, street, and building generation off the main thread.
 * This keeps the UI responsive during world generation.
 */

/// <reference lib="webworker" />

import { TerrainGenerator } from './generators/terrain-generator';
import { StreetGenerator } from './generators/street-generator';
import { BuildingGenerator } from './generators/building-generator';
import type { DevWorldWorkerMessage, DevWorldWorkerResponse, DevWorldWorkerConfig } from './devworld-worker.types';

// Post typed message back to main thread
function postResponse(response: DevWorldWorkerResponse): void {
  postMessage(response);
}

// Generate the world
function generate(config: DevWorldWorkerConfig): void {
  const startTime = performance.now();
  const timing = { terrain: 0, streets: 0, buildings: 0, total: 0 };

  try {
    // ═══════════════════════════════════════════════════════════════
    // PHASE 1: Generate Terrain Heightmap
    // ═══════════════════════════════════════════════════════════════
    postResponse({ type: 'progress', phase: 'terrain', progress: 0 });

    const terrainStart = performance.now();
    const terrainGenerator = new TerrainGenerator({
      seed: config.seed,
      preset: config.terrainPreset,
      worldSize: config.worldSize,
      size: config.heightmapSize,
      maxHeight: config.maxHeight,
    });

    const heightData = terrainGenerator.generate();
    timing.terrain = performance.now() - terrainStart;

    postResponse({ type: 'progress', phase: 'terrain', progress: 100 });

    // Create height sampler for other generators
    const heightSampler = (x: number, z: number): number => {
      return terrainGenerator.getHeightAt(x, z, heightData);
    };

    // ═══════════════════════════════════════════════════════════════
    // PHASE 2: Generate Streets
    // ═══════════════════════════════════════════════════════════════
    postResponse({ type: 'progress', phase: 'streets', progress: 0 });

    const streetsStart = performance.now();
    const streetGenerator = new StreetGenerator({
      seed: config.seed,
      worldSize: config.worldSize,
      hqPosition: config.hqPosition,
      terrainSampler: heightSampler,
    });

    const { segments: streetSegments, spawns: spawnPoints } = streetGenerator.generate();
    timing.streets = performance.now() - streetsStart;

    postResponse({ type: 'progress', phase: 'streets', progress: 100 });

    // ═══════════════════════════════════════════════════════════════
    // PHASE 3: Generate Buildings
    // ═══════════════════════════════════════════════════════════════
    postResponse({ type: 'progress', phase: 'buildings', progress: 0 });

    const buildingsStart = performance.now();
    const buildingGenerator = new BuildingGenerator({
      seed: config.seed,
      density: config.buildingDensity,
      streetSegments,
      worldSize: config.worldSize,
      hqPosition: config.hqPosition,
      terrainSampler: heightSampler,
    });

    const buildingConfigs = buildingGenerator.generate();
    timing.buildings = performance.now() - buildingsStart;

    postResponse({ type: 'progress', phase: 'buildings', progress: 100 });

    // ═══════════════════════════════════════════════════════════════
    // DONE: Send results back to main thread
    // ═══════════════════════════════════════════════════════════════
    timing.total = performance.now() - startTime;

    postResponse({
      type: 'result',
      heightData,
      streetSegments,
      spawnPoints,
      buildingConfigs,
      timing,
    });

  } catch (error) {
    postResponse({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Listen for messages from main thread
addEventListener('message', (event: MessageEvent<DevWorldWorkerMessage>) => {
  const message = event.data;

  switch (message.type) {
    case 'generate':
      generate(message.config);
      break;
  }
});
