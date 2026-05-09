/**
 * Spawn Schedule Builder
 *
 * Converts enemy groups + pattern into a concrete SpawnSchedule
 * with a flat, ordered list of SpawnEntry items.
 *
 * The WaveManager plays this schedule sequentially — all pattern
 * logic is resolved at build time, not at spawn time.
 */

import { SpawnEntry, SpawnSchedule } from '../../managers/wave.manager';
import { EnemyTypeId, ENEMY_TYPES } from '../../configs/enemy-types.config';
import { WaveEnemyGroup } from './models/wave-config';

export type SpawnPattern =
  | 'interleaved'   // ABABABAB - proportional round-robin
  | 'sequential'    // AAAA...BBBB - all of one group, then next
  | 'clustered'     // AAA BBB AAA BBB - small clusters, then switch
  | 'random'        // Fisher-Yates shuffle
  | 'front-loaded'  // Strongest first (sorted by HP desc)
  | 'back-loaded'   // Weakest first (sorted by HP asc)
  | 'wave-in-wave'; // Sub-waves with pauses between groups

export const ALL_SPAWN_PATTERNS: SpawnPattern[] = [
  'interleaved', 'sequential', 'clustered', 'random',
  'front-loaded', 'back-loaded', 'wave-in-wave',
];

export interface ScheduleBuildConfig {
  groups: WaveEnemyGroup[];
  pattern: SpawnPattern;
  baseDelay: number;
  delayVariation?: number;   // 0-0.5
  clusterSize?: number;      // for 'clustered' (default: 3)
  subWavePause?: number;     // for 'wave-in-wave' in ms (default: 3000)
}

/**
 * Build a SpawnSchedule from enemy groups and a pattern.
 */
export function buildSpawnSchedule(config: ScheduleBuildConfig): SpawnSchedule {
  const validGroups = config.groups.filter(g => g.count > 0);
  if (validGroups.length === 0) {
    return { entries: [], baseDelay: config.baseDelay };
  }

  let entries: SpawnEntry[];

  switch (config.pattern) {
    case 'interleaved':
      entries = buildInterleaved(validGroups);
      break;
    case 'sequential':
      entries = buildSequential(validGroups);
      break;
    case 'clustered':
      entries = buildClustered(validGroups, config.clusterSize ?? 3);
      break;
    case 'random':
      entries = buildRandom(validGroups);
      break;
    case 'front-loaded':
      entries = buildFrontLoaded(validGroups);
      break;
    case 'back-loaded':
      entries = buildBackLoaded(validGroups);
      break;
    case 'wave-in-wave':
      entries = buildWaveInWave(validGroups, config.subWavePause ?? 3000);
      break;
    default:
      entries = buildInterleaved(validGroups);
  }

  // Build dynamic delay getter if variation is specified
  const variation = config.delayVariation ?? 0;
  const getDelay = variation > 0
    ? () => {
        const min = config.baseDelay * (1 - variation);
        const max = config.baseDelay * (1 + variation);
        return Math.round(min + Math.random() * (max - min));
      }
    : undefined;

  return { entries, baseDelay: config.baseDelay, getDelay };
}

/**
 * Default pattern when the backend didn't specify one.
 * Phase 5.10: Templates provide their own spawnPattern; this is only used
 * for legacy paths (debug UI creating ad-hoc waves without template metadata).
 */
export const DEFAULT_SPAWN_PATTERN: SpawnPattern = 'interleaved';

/**
 * Create WaveEnemyGroups from ratio-based definition.
 * Example: fromRatio(20, { zombie: 0.6, bat: 0.3, tank: 0.1 })
 *   → [{ type: 'zombie', count: 12 }, { type: 'bat', count: 6 }, { type: 'tank', count: 2 }]
 */
export function fromRatio(
  totalCount: number,
  ratios: Record<string, number>
): WaveEnemyGroup[] {
  const entries = Object.entries(ratios);
  const totalRatio = entries.reduce((sum, [, r]) => sum + r, 0);

  const groups: WaveEnemyGroup[] = [];
  let assigned = 0;

  for (let i = 0; i < entries.length; i++) {
    const [type, ratio] = entries[i];
    const isLast = i === entries.length - 1;
    const count = isLast
      ? totalCount - assigned // last group gets remainder
      : Math.floor((ratio / totalRatio) * totalCount);
    assigned += count;

    if (count > 0) {
      groups.push({ type, count });
    }
  }

  return groups;
}


// === Pattern Implementations ===

function groupToEntry(group: WaveEnemyGroup): SpawnEntry {
  const typeConfig = ENEMY_TYPES[group.type as EnemyTypeId];
  return {
    enemyType: group.type as EnemyTypeId,
    speed: (typeConfig?.baseSpeed ?? 5) * (group.speedMultiplier ?? 1),
    health: group.healthMultiplier
      ? Math.round((typeConfig?.baseHp ?? 80) * group.healthMultiplier)
      : undefined,
    delay: group.spawnDelay,
  };
}

/** Proportional round-robin: ABABABAB */
function buildInterleaved(groups: WaveEnemyGroup[]): SpawnEntry[] {
  const entries: SpawnEntry[] = [];
  const remaining = groups.map(g => ({ ...g }));

  while (remaining.some(g => g.count > 0)) {
    for (const group of remaining) {
      if (group.count > 0) {
        entries.push(groupToEntry(group));
        group.count--;
      }
    }
  }
  return entries;
}

/** All of one group, then next: AAAA...BBBB */
function buildSequential(groups: WaveEnemyGroup[]): SpawnEntry[] {
  const entries: SpawnEntry[] = [];
  for (const group of groups) {
    for (let i = 0; i < group.count; i++) {
      entries.push(groupToEntry(group));
    }
  }
  return entries;
}

/** Small clusters, then switch: AAA BBB AAA BBB */
function buildClustered(groups: WaveEnemyGroup[], clusterSize: number): SpawnEntry[] {
  const entries: SpawnEntry[] = [];
  const remaining = groups.filter(g => g.count > 0).map(g => ({ ...g }));

  while (remaining.some(g => g.count > 0)) {
    for (const group of remaining) {
      const batchSize = Math.min(clusterSize, group.count);
      for (let i = 0; i < batchSize; i++) {
        entries.push(groupToEntry(group));
        group.count--;
      }
    }
  }
  return entries;
}

/** Fisher-Yates shuffle */
function buildRandom(groups: WaveEnemyGroup[]): SpawnEntry[] {
  const entries = buildSequential(groups);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [entries[i], entries[j]] = [entries[j], entries[i]];
  }
  return entries;
}

/** Strongest first (sorted by effective HP descending) */
function buildFrontLoaded(groups: WaveEnemyGroup[]): SpawnEntry[] {
  const sorted = [...groups].sort((a, b) => {
    const aHp = (ENEMY_TYPES[a.type as EnemyTypeId]?.baseHp ?? 80) * (a.healthMultiplier ?? 1);
    const bHp = (ENEMY_TYPES[b.type as EnemyTypeId]?.baseHp ?? 80) * (b.healthMultiplier ?? 1);
    return bHp - aHp;
  });
  return buildSequential(sorted);
}

/** Weakest first (sorted by effective HP ascending) */
function buildBackLoaded(groups: WaveEnemyGroup[]): SpawnEntry[] {
  const sorted = [...groups].sort((a, b) => {
    const aHp = (ENEMY_TYPES[a.type as EnemyTypeId]?.baseHp ?? 80) * (a.healthMultiplier ?? 1);
    const bHp = (ENEMY_TYPES[b.type as EnemyTypeId]?.baseHp ?? 80) * (b.healthMultiplier ?? 1);
    return aHp - bHp;
  });
  return buildSequential(sorted);
}

/** Sub-waves with pauses: [Group A] --pause-- [Group B] --pause-- [Group C] */
function buildWaveInWave(groups: WaveEnemyGroup[], pauseMs: number): SpawnEntry[] {
  const entries: SpawnEntry[] = [];

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    for (let i = 0; i < group.count; i++) {
      const entry = groupToEntry(group);
      // Last entry of each group (except the very last group) gets a pause
      if (i === group.count - 1 && gi < groups.length - 1) {
        entry.pauseAfter = pauseMs;
      }
      entries.push(entry);
    }
  }
  return entries;
}
