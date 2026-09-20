/**
 * Wave Config Adapter
 *
 * Single conversion point from the director's WaveConfig (DirectorWave) into
 * the runtime WaveManager WaveConfig consumed by `WaveManager.startWave()`.
 *
 * Architecture invariant (no parallel systems): the WaveManager has exactly
 * one spawn pipeline — schedule-based. This adapter always builds a
 * SpawnSchedule, even for single-group waves. A 1-group DirectorWave becomes
 * a schedule with one entry per enemy; functionally identical to the old
 * single-type path that lived inside WaveManager.
 */

import { WaveConfig as DirectorWave } from './models/wave-config';
import { WaveConfig as WaveManagerConfig } from '../managers/wave.manager';
import { EnemyTypeId, ENEMY_TYPES } from '../configs/enemy-types.config';
import { buildSpawnSchedule, DEFAULT_SPAWN_PATTERN } from './spawn-schedule-builder';

/**
 * Convert a DirectorWave into a WaveManagerConfig.
 *
 * Always emits a schedule — even for 1-group inputs. The WaveManager has no
 * single-type fast path, so this is the only entry point for wave spawning.
 *
 * `random` is the run's spawn stream (GameRng); the jitter of the spawn delay
 * and the shuffle of the 'random' pattern draw from it. Without it both fall
 * back to `Math.random`, which specs and ad-hoc debug waves are fine with.
 */
export function adaptDirectorWave(
  aiConfig: DirectorWave,
  random?: () => number,
): WaveManagerConfig {
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
    random,
  });

  if (aiConfig.spawnMode) {
    schedule.spawnMode = aiConfig.spawnMode;
  }

  return { schedule };
}

/** Validate and convert enemy type string to EnemyTypeId. */
function validateEnemyType(type: string): EnemyTypeId | null {
  return type in ENEMY_TYPES ? (type as EnemyTypeId) : null;
}
