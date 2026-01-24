/**
 * Wave Config Adapter
 *
 * Converts AI WaveConfig to WaveManager WaveConfig format.
 * This adapter ensures AI doesn't break existing game logic.
 */

import { WaveConfig as AIWaveConfig } from './models/wave-config';
import { WaveConfig as WaveManagerConfig } from '../../managers/wave.manager';
import { EnemyTypeId, ENEMY_TYPES } from '../../models/enemy-types';

/**
 * Convert AI WaveConfig to WaveManager WaveConfig
 *
 * The AI generates complex wave configs with multiple enemy types.
 * The WaveManager currently supports single enemy type per startWave() call.
 *
 * Strategy: Return array of WaveManagerConfigs, one per enemy type.
 * The caller can either:
 * - Call startWave() multiple times (sequentially)
 * - Use the first/dominant type only
 * - Extend WaveManager to support multi-type waves (future)
 */
export function adaptAIWaveConfig(aiConfig: AIWaveConfig): WaveManagerConfig[] {
  const configs: WaveManagerConfig[] = [];

  for (const group of aiConfig.enemies) {
    if (group.count <= 0) continue;

    // Validate enemy type
    const enemyType = validateEnemyType(group.type);
    if (!enemyType) {
      console.warn(`[AI Adapter] Unknown enemy type: ${group.type}, skipping`);
      continue;
    }

    // Get base enemy config
    const enemyConfig = ENEMY_TYPES[enemyType];
    if (!enemyConfig) continue;

    // Calculate adjusted stats
    const baseSpeed = enemyConfig.baseSpeed;
    const baseHealth = enemyConfig.baseHp;

    const adjustedSpeed = baseSpeed * (group.speedMultiplier ?? 1);
    const adjustedHealth = group.healthMultiplier
      ? Math.round(baseHealth * group.healthMultiplier)
      : undefined;

    // Create variable delay function if variation is specified
    const baseDelay = aiConfig.spawnDelay;
    const variation = aiConfig.spawnDelayVariation ?? 0;
    const getSpawnDelay = variation > 0
      ? () => {
          const min = baseDelay * (1 - variation);
          const max = baseDelay * (1 + variation);
          return Math.round(min + Math.random() * (max - min));
        }
      : undefined;

    configs.push({
      enemyCount: group.count,
      enemyType: enemyType,
      enemySpeed: adjustedSpeed,
      enemyHealth: adjustedHealth,
      spawnMode: 'random', // AI doesn't specify, use random for variety
      spawnDelay: baseDelay,
      getSpawnDelay, // Dynamic delay for variety
      useGathering: false, // Deprecated - always use variable delays
    });
  }

  // Ensure at least one config
  if (configs.length === 0) {
    configs.push(createDefaultConfig(aiConfig));
  }

  return configs;
}

/**
 * Get single dominant wave config (for simple integration)
 *
 * Returns config for the enemy type with highest count, but uses totalCount
 * to ensure all enemies are spawned (even if different types were specified).
 */
export function adaptAIWaveConfigSingle(aiConfig: AIWaveConfig): WaveManagerConfig {
  const configs = adaptAIWaveConfig(aiConfig);

  // Get config with most enemies (dominant type)
  const dominant = configs.reduce((best, current) =>
    current.enemyCount > best.enemyCount ? current : best
  );

  // Use totalCount to spawn all enemies (as the dominant type)
  // This ensures we don't lose enemies when AI generates mixed waves
  return {
    ...dominant,
    enemyCount: aiConfig.totalCount,
  };
}

/**
 * Create combined wave config (experimental)
 *
 * Returns a single config that spawns mixed enemies by interleaving.
 * The dominant type is used for the config, but multiple spawn calls
 * can be orchestrated by the caller.
 */
export function createMixedWaveSchedule(aiConfig: AIWaveConfig): WaveSpawnSchedule {
  const schedule: WaveSpawnSchedule = {
    totalEnemies: aiConfig.totalCount,
    spawnDelay: aiConfig.spawnDelay,
    spawnDelayVariation: aiConfig.spawnDelayVariation ?? 0,
    spawnOrder: [],
  };

  // Create spawn order by interleaving enemy types
  const groups = [...aiConfig.enemies].filter((g) => g.count > 0);

  // Sort by count (spawn more common enemies more often)
  groups.sort((a, b) => b.count - a.count);

  // Interleave: go through each group and add enemies one at a time
  let remaining = groups.map((g) => ({ ...g }));
  while (remaining.some((g) => g.count > 0)) {
    for (const group of remaining) {
      if (group.count > 0) {
        const enemyType = validateEnemyType(group.type);
        if (enemyType) {
          const enemyConfig = ENEMY_TYPES[enemyType];
          schedule.spawnOrder.push({
            enemyType,
            speed: enemyConfig.baseSpeed * (group.speedMultiplier ?? 1),
            health: group.healthMultiplier
              ? Math.round(enemyConfig.baseHp * group.healthMultiplier)
              : undefined,
          });
        }
        group.count--;
      }
    }
    remaining = remaining.filter((g) => g.count > 0);
  }

  return schedule;
}

/**
 * Wave spawn schedule for mixed enemy types
 */
export interface WaveSpawnSchedule {
  totalEnemies: number;
  spawnDelay: number;
  spawnDelayVariation: number;
  spawnOrder: {
    enemyType: EnemyTypeId;
    speed: number;
    health?: number;
  }[];
}

/**
 * Validate and convert enemy type string to EnemyTypeId
 */
function validateEnemyType(type: string): EnemyTypeId | null {
  // Direct match
  if (type in ENEMY_TYPES) {
    return type as EnemyTypeId;
  }

  // Common aliases
  const aliases: Record<string, EnemyTypeId> = {
    basic: 'zombie',
    fast: 'bat',
    flying: 'bat',
    heavy: 'wallsmasher',
    boss: 'herbert',
  };

  return aliases[type] ?? null;
}

/**
 * Create default fallback config
 */
function createDefaultConfig(aiConfig: AIWaveConfig): WaveManagerConfig {
  const baseDelay = aiConfig.spawnDelay || 800;
  const variation = aiConfig.spawnDelayVariation ?? 0.2;

  return {
    enemyCount: Math.max(5, aiConfig.totalCount),
    enemyType: 'zombie',
    enemySpeed: 5,
    spawnMode: 'random',
    spawnDelay: baseDelay,
    getSpawnDelay: () => {
      const min = baseDelay * (1 - variation);
      const max = baseDelay * (1 + variation);
      return Math.round(min + Math.random() * (max - min));
    },
    useGathering: false,
  };
}

/**
 * Get recommended spawn strategy for AI config
 */
export type SpawnStrategy = 'single' | 'sequential' | 'interleaved';

export function recommendSpawnStrategy(aiConfig: AIWaveConfig): SpawnStrategy {
  const typeCount = aiConfig.enemies.filter((g) => g.count > 0).length;

  if (typeCount <= 1) {
    return 'single';
  }

  // For boss waves, spawn boss after other enemies
  if (aiConfig.archetype === 'boss') {
    return 'sequential';
  }

  // For variety, interleave
  return 'interleaved';
}
