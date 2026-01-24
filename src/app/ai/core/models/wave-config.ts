/**
 * Wave Config - AI Output
 *
 * Defines how a wave should be configured.
 * This is what the Wave Director AI produces.
 */

/**
 * Known enemy type IDs in the game
 * Keep in sync with ENEMY_TYPES in models/enemy-types.ts
 */
export type KnownEnemyTypeId = 'zombie' | 'tank' | 'wallsmasher' | 'bat' | 'herbert';

/**
 * Wave archetypes for thematic wave generation
 */
export type WaveArchetype =
  | 'swarm' // Many weak enemies
  | 'elite' // Few strong enemies
  | 'rush' // Fast enemies
  | 'siege' // Slow tanks
  | 'mixed' // Balanced mix
  | 'boss' // Boss + support
  | 'air'; // Flying enemies

/**
 * Single enemy group in a wave
 */
export interface WaveEnemyGroup {
  /** Enemy type to spawn */
  type: string;

  /** Number of this enemy type */
  count: number;

  /** Health multiplier (0.5-5.0, default 1.0) */
  healthMultiplier?: number;

  /** Speed multiplier (0.5-1.5, default 1.0) */
  speedMultiplier?: number;
}

/**
 * Complete wave configuration
 */
export interface WaveConfig {
  // === ENEMY COMPOSITION ===

  /** List of enemy groups to spawn */
  enemies: WaveEnemyGroup[];

  /** Total enemy count (sum of all groups) */
  totalCount: number;

  // === SPAWN BEHAVIOR ===

  /** Base milliseconds between spawns (300-3000) */
  spawnDelay: number;

  /** Spawn delay variation (+/- this percentage, 0-0.5) */
  spawnDelayVariation?: number;

  /** DEPRECATED: Gathering mode removed - always use variable delays */
  useGathering?: boolean;

  /** Which spawn point to use (if multiple exist) */
  spawnPointIndex?: number;

  // === METADATA ===

  /** The archetype this wave follows */
  archetype?: WaveArchetype;

  /** Difficulty modifier applied (-0.3 to +0.3) */
  difficultyModifier?: number;

  /** AI confidence in this configuration (0-1) */
  confidence?: number;

  /** Human-readable explanation of why this wave was chosen */
  explanation?: string;
}

/**
 * Wave configuration with sub-waves for complex patterns
 */
export interface ComplexWaveConfig extends WaveConfig {
  /** Sub-waves that spawn after delays */
  subWaves?: SubWave[];
}

export interface SubWave {
  /** Delay in ms before this sub-wave starts */
  delayMs: number;

  /** Enemies in this sub-wave */
  enemies: WaveEnemyGroup[];
}

/**
 * Create a simple wave config
 */
export function createSimpleWaveConfig(
  enemyType: string,
  count: number,
  spawnDelay = 800
): WaveConfig {
  return {
    enemies: [{ type: enemyType, count }],
    totalCount: count,
    spawnDelay,
    useGathering: false,
  };
}

/**
 * Create a mixed wave config
 */
export function createMixedWaveConfig(
  groups: WaveEnemyGroup[],
  spawnDelay = 800,
  useGathering = false
): WaveConfig {
  return {
    enemies: groups,
    totalCount: groups.reduce((sum, g) => sum + g.count, 0),
    spawnDelay,
    useGathering,
    archetype: 'mixed',
  };
}

/**
 * Get archetype description for UI
 */
export function getArchetypeDescription(archetype: WaveArchetype): string {
  const descriptions: Record<WaveArchetype, string> = {
    swarm: 'Viele schwache Gegner - Splash-Damage empfohlen',
    elite: 'Wenige starke Gegner - hoher Einzelschaden noetig',
    rush: 'Schnelle Gegner - Slow-Tower helfen',
    siege: 'Langsame Tanks - brauchen viel Schaden',
    mixed: 'Ausgewogener Mix - vielseitige Defense noetig',
    boss: 'Boss-Welle - konzentriere Feuer!',
    air: 'Fliegende Gegner - Anti-Air Pflicht!',
  };
  return descriptions[archetype];
}
