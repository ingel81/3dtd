/**
 * Wave Config Adapter
 *
 * Converts AI WaveConfig to WaveManager WaveConfig format.
 * This adapter ensures AI doesn't break existing game logic.
 */

import { WaveConfig as AIWaveConfig } from './models/wave-config';
import { WaveConfig as WaveManagerConfig } from '../../managers/wave.manager';
import { EnemyTypeId, ENEMY_TYPES } from '../../models/enemy-types';
import { buildSpawnSchedule, getRecommendedPattern } from './spawn-schedule-builder';

/**
 * Convert AI WaveConfig to WaveManager WaveConfig (with mixed wave support)
 *
 * Single enemy group → uses classic single-type spawning.
 * Multiple groups → builds a SpawnSchedule for mixed spawning.
 */
export function adaptAIWaveConfigMixed(aiConfig: AIWaveConfig): WaveManagerConfig {
  const validGroups = aiConfig.enemies.filter(g => g.count > 0);

  // Single group or empty: use classic single-type path
  if (validGroups.length <= 1) {
    return adaptAIWaveConfigSingle(aiConfig);
  }

  // Multiple groups: build a mixed wave schedule
  const pattern = aiConfig.pattern ?? getRecommendedPattern(aiConfig.archetype ?? 'mixed');

  const schedule = buildSpawnSchedule({
    groups: validGroups,
    pattern,
    baseDelay: aiConfig.spawnDelay,
    delayVariation: aiConfig.spawnDelayVariation,
  });

  // Get dominant type for legacy fields
  const dominant = validGroups.reduce((best, current) =>
    current.count > best.count ? current : best
  );
  const dominantType = validateEnemyType(dominant.type) ?? 'zombie';
  const dominantConfig = ENEMY_TYPES[dominantType];

  return {
    enemyCount: aiConfig.totalCount,
    enemyType: dominantType,
    enemySpeed: dominantConfig?.baseSpeed ?? 5,
    spawnMode: 'random',
    spawnDelay: aiConfig.spawnDelay,
    schedule,
  };
}

/**
 * Convert AI WaveConfig to array of WaveManager configs (one per group)
 */
export function adaptAIWaveConfig(aiConfig: AIWaveConfig): WaveManagerConfig[] {
  const configs: WaveManagerConfig[] = [];

  for (const group of aiConfig.enemies) {
    if (group.count <= 0) continue;

    const enemyType = validateEnemyType(group.type);
    if (!enemyType) {
      console.warn(`[AI Adapter] Unknown enemy type: ${group.type}, skipping`);
      continue;
    }

    const enemyConfig = ENEMY_TYPES[enemyType];
    if (!enemyConfig) continue;

    const adjustedSpeed = enemyConfig.baseSpeed * (group.speedMultiplier ?? 1);
    const adjustedHealth = group.healthMultiplier
      ? Math.round(enemyConfig.baseHp * group.healthMultiplier)
      : undefined;

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
      enemyType,
      enemySpeed: adjustedSpeed,
      enemyHealth: adjustedHealth,
      spawnMode: 'random',
      spawnDelay: baseDelay,
      getSpawnDelay,
    });
  }

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

  const dominant = configs.reduce((best, current) =>
    current.enemyCount > best.enemyCount ? current : best
  );

  return {
    ...dominant,
    enemyCount: aiConfig.totalCount,
  };
}

/**
 * Validate and convert enemy type string to EnemyTypeId
 */
function validateEnemyType(type: string): EnemyTypeId | null {
  if (type in ENEMY_TYPES) {
    return type as EnemyTypeId;
  }

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
  };
}
