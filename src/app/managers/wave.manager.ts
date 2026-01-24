import { signal } from '@angular/core';
import { EnemyManager } from './enemy.manager';
import { EnemyTypeId } from '../models/enemy-types';
import { GeoPosition } from '../models/game.types';
import { GameEventBus } from '../game-engine';

export type GamePhase = 'setup' | 'wave' | 'gameover';

export interface SpawnPoint extends GeoPosition {
  id: string;
  name: string;
}

export interface WaveConfig {
  enemyCount: number;
  enemyType: EnemyTypeId;
  enemySpeed: number;
  enemyHealth?: number; // Optional custom health (defaults to enemy type's health)
  spawnMode: 'each' | 'random';
  spawnDelay: number; // Delay in ms between spawning each enemy
  getSpawnDelay?: () => number; // Optional: Dynamic getter for live delay updates during wave
  useGathering: boolean; // If true, all enemies spawn paused and start together
}

/**
 * Manages wave spawning and game phases
 *
 * Framework-agnostic, event-based:
 * - No @Injectable decorator
 * - Constructor injection
 * - Emits events: wave:started, wave:completed
 */
export class WaveManager {
  readonly phase = signal<GamePhase>('setup');
  readonly waveNumber = signal(0);
  readonly gatheringPhase = signal(false);

  spawnPoints: SpawnPoint[] = [];
  private cachedPaths = new Map<string, GeoPosition[]>();

  // Track active timeouts for cleanup on reset
  private activeTimeouts = new Set<ReturnType<typeof setTimeout>>();

  private timescaleProvider: (() => number) | null = null;

  // Track spawning state to prevent premature wave completion
  private expectedEnemyCount = 0;
  private spawnedEnemyCount = 0;

  constructor(
    private eventBus: GameEventBus,
    private enemyManager: EnemyManager
  ) {}

  initialize(spawnPoints: SpawnPoint[], cachedPaths: Map<string, GeoPosition[]>): void {
    this.spawnPoints = spawnPoints;
    this.cachedPaths = cachedPaths;
  }

  /**
   * Set timescale provider for spawn delay scaling
   */
  setTimescaleProvider(provider: () => number): void {
    this.timescaleProvider = provider;
  }

  /**
   * Begin wave phase (for manual enemy spawning)
   */
  beginWave(): void {
    this.waveNumber.update((n) => n + 1);
    this.phase.set('wave');

    // Reset spawn tracking (manual mode - unlimited spawning)
    this.expectedEnemyCount = 0;
    this.spawnedEnemyCount = 0;

    // Emit wave:started event
    this.eventBus.emit({
      type: 'wave:started',
      wave: this.waveNumber(),
      enemyCount: 0, // Manual mode - count unknown
    });
  }

  /**
   * Start a new wave with auto-spawning
   */
  startWave(config: WaveConfig): void {
    this.waveNumber.update((n) => n + 1);
    this.phase.set('wave');

    // Initialize spawn tracking
    this.expectedEnemyCount = config.enemyCount;
    this.spawnedEnemyCount = 0;

    // Emit wave:started event with actual enemy count
    this.eventBus.emit({
      type: 'wave:started',
      wave: this.waveNumber(),
      enemyCount: config.enemyCount, // This is the actual count being spawned
    });

    const useGathering = config.useGathering;
    // Use getter if provided (allows live delay changes), otherwise use static value
    const getDelay = config.getSpawnDelay ?? (() => config.spawnDelay);

    if (useGathering) {
      this.gatheringPhase.set(true);
    }

    let spawnedCount = 0;

    // Capture wave number at start to detect reset
    const waveId = this.waveNumber();

    const spawnNext = () => {
      const currentPhase = this.phase();
      const currentWave = this.waveNumber();

      // Stop spawning if not in wave phase (reset or game over)
      if (currentPhase !== 'wave') {
        return;
      }

      // Stop if wave was reset (new wave started or game reset)
      if (currentWave !== waveId) {
        return;
      }

      if (spawnedCount >= config.enemyCount) {
        if (useGathering) {
          // Gathering mode: Start all enemies together after short delay
          const timescale = this.timescaleProvider ? this.timescaleProvider() : 1.0;
          const realTimeDelay = 500 / timescale; // Scale gathering delay
          const timeoutId = setTimeout(() => {
            this.activeTimeouts.delete(timeoutId);
            if (this.phase() !== 'wave') return; // Stop if reset/game over
            this.gatheringPhase.set(false);
            const currentTimescale = this.timescaleProvider ? this.timescaleProvider() : 1.0;
            this.enemyManager.startAll(300, currentTimescale);
          }, realTimeDelay);
          this.activeTimeouts.add(timeoutId);
        }
        return;
      }

      const spawn = this.selectSpawnPoint(config.spawnMode, spawnedCount);
      const path = this.cachedPaths.get(spawn.id);

      if (path && path.length > 1) {
        // In gathering mode: spawn paused, otherwise spawn and start immediately
        this.enemyManager.spawn(path, config.enemyType, config.enemySpeed, useGathering, config.enemyHealth);
        spawnedCount++;
        this.spawnedEnemyCount++; // Track globally for wave completion check
      }

      // Check phase again before scheduling next spawn (could have been reset during spawn)
      if (this.phase() !== 'wave') return;

      const timescale = this.timescaleProvider ? this.timescaleProvider() : 1.0;
      const gameTimeDelay = getDelay();
      const realTimeDelay = gameTimeDelay / timescale; // Scale spawn delay
      const timeoutId = setTimeout(() => {
        this.activeTimeouts.delete(timeoutId);
        if (this.phase() !== 'wave') return; // Stop if reset/game over
        spawnNext();
      }, realTimeDelay);
      this.activeTimeouts.add(timeoutId);
    };

    spawnNext();
  }

  /**
   * Select a spawn point based on mode
   */
  private selectSpawnPoint(mode: 'each' | 'random', index: number): SpawnPoint {
    if (mode === 'each') {
      return this.spawnPoints[index % this.spawnPoints.length];
    } else {
      return this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    }
  }

  /**
   * Check if wave is complete (all enemies spawned AND all enemies dead)
   */
  checkWaveComplete(): boolean {
    if (this.phase() !== 'wave') return false;

    // Wave is complete when:
    // 1. All enemies have been spawned (or manual mode with expectedCount = 0)
    // 2. AND all spawned enemies are dead
    const allEnemiesSpawned = this.expectedEnemyCount === 0 || this.spawnedEnemyCount >= this.expectedEnemyCount;
    const allEnemiesDead = this.enemyManager.getAliveCount() === 0;

    return allEnemiesSpawned && allEnemiesDead;
  }

  /**
   * End the current wave
   */
  endWave(): void {
    const waveNum = this.waveNumber();
    this.enemyManager.clear();
    this.phase.set('setup');

    // Emit wave:completed event (credits are added by GameStateManager)
    this.eventBus.emitDeferred({
      type: 'wave:completed',
      wave: waveNum,
      credits: 0, // Credits are handled separately via GAME_BALANCE
    });
  }

  /**
   * Stop all pending spawns (for Kill All functionality)
   * Clears timeouts but doesn't reset the wave - let checkWaveComplete() handle that
   */
  stopSpawning(): void {
    // Clear all pending timeouts to prevent spawning after abort
    for (const timeoutId of this.activeTimeouts) {
      clearTimeout(timeoutId);
    }
    this.activeTimeouts.clear();
    this.gatheringPhase.set(false);
  }

  /**
   * Reset wave manager
   */
  reset(): void {
    // Clear all pending timeouts to prevent spawning after reset
    for (const timeoutId of this.activeTimeouts) {
      clearTimeout(timeoutId);
    }
    this.activeTimeouts.clear();

    this.enemyManager.clear();
    this.phase.set('setup');
    this.waveNumber.set(0);
    this.gatheringPhase.set(false);
  }
}
