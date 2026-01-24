/**
 * Fallback Wave Generator
 *
 * Rule-based wave generation when AI model is not available.
 * Provides playable waves without machine learning.
 *
 * This ensures the game works even without a trained model.
 */

import { GameStateSnapshot } from './models/game-state-snapshot';
import { WaveConfig, WaveEnemyGroup, WaveArchetype } from './models/wave-config';

/** Enemy type definitions for fallback */
const ENEMY_TYPES = {
  basic: 'zombie',
  fast: 'bat',
  tank: 'tank',
  heavy: 'wallsmasher',
  boss: 'herbert',
};

/**
 * Generate a wave config using rule-based logic
 */
export function generateFallbackWave(
  state: GameStateSnapshot,
  recentDamage: number[] = []
): WaveConfig {
  const wave = state.waveNumber;

  // Determine archetype based on wave number and player state
  const archetype = selectArchetype(wave, state, recentDamage);

  // Generate enemies based on archetype
  const enemies = generateEnemiesForArchetype(archetype, wave, state);

  // Calculate spawn delay (faster as game progresses)
  const spawnDelay = calculateSpawnDelay(wave, archetype);

  // Boss waves use gathering
  const useGathering = archetype === 'boss' || wave % 10 === 0;

  return {
    enemies,
    totalCount: enemies.reduce((sum, e) => sum + e.count, 0),
    spawnDelay,
    useGathering,
    archetype,
    explanation: generateExplanation(archetype, state),
  };
}

/**
 * Select wave archetype based on game state
 */
function selectArchetype(
  wave: number,
  state: GameStateSnapshot,
  recentDamage: number[]
): WaveArchetype {
  // Boss wave every 5 waves
  if (wave % 5 === 0 && wave > 0) {
    return 'boss';
  }

  // Check for mercy (player struggling)
  const avgRecentDamage =
    recentDamage.length > 0
      ? recentDamage.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, recentDamage.length)
      : 0;

  if (avgRecentDamage > 0.3) {
    // Player taking lots of damage, ease up
    return 'mixed';
  }

  // Exploit vulnerabilities
  if (state.vulnerabilities.airDefenseGap && wave > 3) {
    return 'air';
  }
  if (state.vulnerabilities.splashGap && wave > 5) {
    return 'swarm';
  }
  if (state.vulnerabilities.slowGap && wave > 4) {
    return 'rush';
  }

  // Cycle through archetypes
  const cycle: WaveArchetype[] = ['mixed', 'swarm', 'elite', 'rush', 'siege'];
  return cycle[wave % cycle.length];
}

/**
 * Generate enemy groups for an archetype
 */
function generateEnemiesForArchetype(
  archetype: WaveArchetype,
  wave: number,
  _state: GameStateSnapshot
): WaveEnemyGroup[] {
  const baseCount = 5 + Math.floor(wave * 1.5);
  const groups: WaveEnemyGroup[] = [];

  switch (archetype) {
    case 'swarm':
      // Many weak enemies
      groups.push({
        type: ENEMY_TYPES.basic,
        count: Math.floor(baseCount * 1.5),
      });
      if (wave > 5) {
        groups.push({
          type: ENEMY_TYPES.fast,
          count: Math.floor(baseCount * 0.3),
        });
      }
      break;

    case 'elite':
      // Few strong enemies
      groups.push({
        type: ENEMY_TYPES.tank,
        count: Math.max(2, Math.floor(baseCount * 0.3)),
        healthMultiplier: 1.2,
      });
      groups.push({
        type: ENEMY_TYPES.basic,
        count: Math.floor(baseCount * 0.3),
      });
      break;

    case 'rush':
      // Fast enemies
      groups.push({
        type: ENEMY_TYPES.fast,
        count: Math.floor(baseCount * 0.8),
      });
      groups.push({
        type: ENEMY_TYPES.basic,
        count: Math.floor(baseCount * 0.4),
        speedMultiplier: 1.2,
      });
      break;

    case 'siege':
      // Slow but tanky
      groups.push({
        type: ENEMY_TYPES.heavy,
        count: Math.max(2, Math.floor(baseCount * 0.25)),
        healthMultiplier: 1.3,
      });
      groups.push({
        type: ENEMY_TYPES.tank,
        count: Math.floor(baseCount * 0.3),
      });
      break;

    case 'air':
      // Flying enemies (if player has no anti-air)
      groups.push({
        type: ENEMY_TYPES.fast, // Bat is air unit
        count: Math.floor(baseCount * 0.7),
      });
      groups.push({
        type: ENEMY_TYPES.basic,
        count: Math.floor(baseCount * 0.3),
      });
      break;

    case 'boss':
      // Boss + support
      groups.push({
        type: ENEMY_TYPES.boss,
        count: 1,
        healthMultiplier: 1 + wave * 0.1, // Bosses get stronger each time
      });
      groups.push({
        type: ENEMY_TYPES.tank,
        count: Math.floor(wave / 2),
      });
      groups.push({
        type: ENEMY_TYPES.basic,
        count: Math.floor(baseCount * 0.5),
      });
      break;

    case 'mixed':
    default:
      // Balanced mix
      groups.push({
        type: ENEMY_TYPES.basic,
        count: Math.floor(baseCount * 0.5),
      });
      if (wave > 2) {
        groups.push({
          type: ENEMY_TYPES.fast,
          count: Math.floor(baseCount * 0.2),
        });
      }
      if (wave > 4) {
        groups.push({
          type: ENEMY_TYPES.tank,
          count: Math.floor(baseCount * 0.15),
        });
      }
      break;
  }

  return groups.filter((g) => g.count > 0);
}

/**
 * Calculate spawn delay based on wave and archetype
 */
function calculateSpawnDelay(wave: number, archetype: WaveArchetype): number {
  // Base delay decreases with wave number
  const baseDelay = Math.max(500, 1500 - wave * 30);

  // Adjust for archetype
  switch (archetype) {
    case 'swarm':
      return baseDelay * 0.6; // Faster spawns
    case 'rush':
      return baseDelay * 0.7;
    case 'siege':
      return baseDelay * 1.5; // Slower spawns
    case 'boss':
      return baseDelay * 1.2;
    default:
      return baseDelay;
  }
}

/**
 * Generate human-readable explanation for the wave
 */
function generateExplanation(archetype: WaveArchetype, state: GameStateSnapshot): string {
  const explanations: Record<WaveArchetype, string> = {
    swarm: 'Viele schwache Gegner - teste deine Splash-Faehigkeiten',
    elite: 'Wenige starke Gegner - konzentriere dein Feuer',
    rush: 'Schnelle Angreifer - Slow-Tower sind hilfreich',
    siege: 'Schwere Einheiten im Anmarsch - hoher Schaden noetig',
    air: 'Luftangriff! Anti-Air-Tower aufstellen!',
    boss: 'BOSS-WELLE! Bereite dich vor!',
    mixed: 'Gemischte Welle - vielseitige Verteidigung noetig',
  };

  let explanation = explanations[archetype];

  // Add vulnerability warning
  if (state.vulnerabilities.overallVulnerability > 0.5) {
    explanation += ' (Warnung: Defense hat Luecken!)';
  }

  return explanation;
}

/**
 * Get difficulty rating for a wave (0-1)
 */
export function getWaveDifficulty(config: WaveConfig, wave: number): number {
  let difficulty = 0;

  // Base difficulty from wave number
  difficulty += Math.min(0.5, wave / 50);

  // Enemy composition
  for (const group of config.enemies) {
    if (group.type === ENEMY_TYPES.boss) difficulty += 0.3;
    if (group.type === ENEMY_TYPES.heavy) difficulty += 0.1 * group.count;
    if (group.type === ENEMY_TYPES.tank) difficulty += 0.05 * group.count;
    if (group.healthMultiplier && group.healthMultiplier > 1) {
      difficulty += 0.1 * (group.healthMultiplier - 1);
    }
  }

  // Spawn rate
  if (config.spawnDelay < 600) difficulty += 0.1;

  // Gathering (synchronized attack)
  if (config.useGathering) difficulty += 0.1;

  return Math.min(1, difficulty);
}
