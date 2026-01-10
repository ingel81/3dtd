/**
 * Geographic position with optional height
 */
export interface GeoPosition {
  lat: number;
  lon: number;
  height?: number;
}

/**
 * Tower configuration
 */
export interface TowerConfig {
  range: number;
  fireRate: number;
  damage: number;
  projectileSpeed: number;
}

/**
 * Enemy configuration
 */
export interface EnemyConfig {
  maxHp: number;
  speed: number;
  reward: number;
}

/**
 * Game phases
 */
export type GamePhase = 'setup' | 'wave' | 'paused' | 'gameover' | 'victory';

/**
 * Wave configuration
 */
export interface WaveConfig {
  enemyCount: number;
  enemyHp: number;
  enemySpeed: number;
  spawnDelay: number;
}

/**
 * Distance calculator function type
 */
export type DistanceCalculator = (p1: GeoPosition, p2: GeoPosition) => number;
