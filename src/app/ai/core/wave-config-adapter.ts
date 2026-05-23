/**
 * Wave Config Adapter
 *
 * Single conversion point from AI/curriculum WaveConfig (AIWaveConfig — what
 * the wave-director, training-backend, or static curriculum produces) into
 * the runtime WaveManager WaveConfig consumed by `WaveManager.startWave()`.
 *
 * Architecture invariant (no parallel systems): the WaveManager has exactly
 * one spawn pipeline — schedule-based. This adapter always builds a
 * SpawnSchedule, even for single-group waves. A 1-group AIWaveConfig becomes
 * a schedule with one entry per enemy; functionally identical to the old
 * single-type path that lived inside WaveManager.
 */

import { WaveConfig as AIWaveConfig } from './models/wave-config';
import { WaveConfig as WaveManagerConfig } from '../../managers/wave.manager';
import { EnemyTypeId, ENEMY_TYPES } from '../../configs/enemy-types.config';
import { buildSpawnSchedule, DEFAULT_SPAWN_PATTERN } from './spawn-schedule-builder';

/**
 * Convert an AIWaveConfig into a WaveManagerConfig.
 *
 * Always emits a schedule — even for 1-group inputs. The WaveManager has no
 * single-type fast path, so this is the only entry point for wave spawning.
 */
export function adaptAIWaveConfig(aiConfig: AIWaveConfig): WaveManagerConfig {
  const groups = aiConfig.enemies
    .filter((g) => g.count > 0)
    .map((g) => ({
      ...g,
      type: validateEnemyType(g.type) ?? 'zombie',
    }));

  const pattern = aiConfig.pattern ?? DEFAULT_SPAWN_PATTERN;

  const schedule = buildSpawnSchedule({
    groups,
    pattern,
    baseDelay: aiConfig.spawnDelay,
    delayVariation: aiConfig.spawnDelayVariation,
  });

  if (aiConfig.spawnMode) {
    schedule.spawnMode = aiConfig.spawnMode;
  }

  return { schedule };
}

/**
 * Validate and convert enemy type string to EnemyTypeId.
 * Honors a few historical aliases used by the Python training backend.
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
