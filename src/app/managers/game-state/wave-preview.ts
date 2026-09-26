import { ENEMY_TYPES, leakDamageOf, lineageLeakDamage, type EnemyTypeId } from '../../configs/enemy-types.config';
import { enemyBaseDamageForWave } from '../../configs/campaign.config';
import type { WaveConfig } from '../wave.manager';
import type { WaveGroupDisplay } from '../../services/debug/wave-debug.service';

/**
 * The sidebar's wave preview: the schedule's entries aggregated by enemy
 * type, so the sidebar shows the composition the player is about to face.
 * Actual values against the type's base values, NOT timescaled. A group
 * takes HP and speed from its first entry. Empty for an empty schedule.
 * `lanes`: coop lanes that each get this wave (laneSchedule), the counts are
 * one lane's. `wave`: the wave number, for what a leak costs at it.
 */
export function summarizeWaveGroups(config: WaveConfig, lanes = 1, wave = 1): WaveGroupDisplay[] {
  const scale = enemyBaseDamageForWave(wave);
  const entries = config.schedule.entries;
  if (entries.length === 0) return [];

  const groupMap = new Map<string, { count: number; health: number; speed: number }>();
  for (const e of entries) {
    const existing = groupMap.get(e.enemyType);
    if (existing) {
      existing.count++;
    } else {
      groupMap.set(e.enemyType, { count: 1, health: e.health ?? 0, speed: e.speed });
    }
  }

  return Array.from(groupMap.entries()).map(([typeId, data]) => {
    const enemyConfig = ENEMY_TYPES[typeId as keyof typeof ENEMY_TYPES];
    const baseHp = enemyConfig.baseHp;
    const baseSpeed = enemyConfig.baseSpeed;
    const actualHp = data.health || baseHp;
    const actualSpeed = data.speed;
    return {
      enemyType: typeId as keyof typeof ENEMY_TYPES,
      name: enemyConfig.name,
      count: data.count,
      baseHp,
      actualHp,
      baseSpeed,
      actualSpeed,
      healthMultiplier: actualHp / baseHp,
      speedMultiplier: actualSpeed / baseSpeed,
      spawnDelay: config.schedule.baseDelay,
      lanes,
      leak: leakDamageOf(typeId as EnemyTypeId) * scale,
      leakMost: lineageLeakDamage(typeId as EnemyTypeId) * scale,
    };
  });
}
