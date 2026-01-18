import { Injectable, inject, signal } from '@angular/core';
import { EnemyManager } from './enemy.manager';
import { EnemyTypeId } from '../models/enemy-types';
import { GeoPosition } from '../models/game.types';

export type GamePhase = 'setup' | 'wave' | 'gameover';

export interface SpawnPoint {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export interface WaveConfig {
  enemyCount: number;
  enemyType: EnemyTypeId;
  enemySpeed: number;
  spawnMode: 'each' | 'random';
  spawnDelay: number; // Delay in ms between spawning each enemy
  useGathering: boolean; // If true, all enemies spawn paused and start together
}

/**
 * Manages wave spawning and game phases
 */
@Injectable()
export class WaveManager {
  private enemyManager = inject(EnemyManager);

  readonly phase = signal<GamePhase>('setup');
  readonly waveNumber = signal(0);
  readonly gatheringPhase = signal(false);

  private spawnPoints: SpawnPoint[] = [];
  private cachedPaths = new Map<string, GeoPosition[]>();

  // Track active timeouts for cleanup on reset
  private activeTimeouts = new Set<ReturnType<typeof setTimeout>>();

  initialize(spawnPoints: SpawnPoint[], cachedPaths: Map<string, GeoPosition[]>): void {
    this.spawnPoints = spawnPoints;
    this.cachedPaths = cachedPaths;
  }

  /**
   * Begin wave phase (for manual enemy spawning)
   */
  beginWave(): void {
    this.waveNumber.update((n) => n + 1);
    this.phase.set('wave');
  }

  /**
   * Start a new wave with auto-spawning
   */
  startWave(config: WaveConfig): void {
    this.waveNumber.update((n) => n + 1);
    this.phase.set('wave');

    const useGathering = config.useGathering;
    const spawnDelay = config.spawnDelay;

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
          const timeoutId = setTimeout(() => {
            this.activeTimeouts.delete(timeoutId);
            if (this.phase() !== 'wave') return; // Stop if reset/game over
            this.gatheringPhase.set(false);
            this.enemyManager.startAll(300);
          }, 500);
          this.activeTimeouts.add(timeoutId);
        }
        return;
      }

      const spawn = this.selectSpawnPoint(config.spawnMode, spawnedCount);
      const path = this.cachedPaths.get(spawn.id);

      if (path && path.length > 1) {
        // In gathering mode: spawn paused, otherwise spawn and start immediately
        this.enemyManager.spawn(path, config.enemyType, config.enemySpeed, useGathering);
        spawnedCount++;
      }

      // Check phase again before scheduling next spawn (could have been reset during spawn)
      if (this.phase() !== 'wave') return;

      const timeoutId = setTimeout(() => {
        this.activeTimeouts.delete(timeoutId);
        if (this.phase() !== 'wave') return; // Stop if reset/game over
        spawnNext();
      }, spawnDelay);
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
   * Check if wave is complete (all enemies dead)
   */
  checkWaveComplete(): boolean {
    return this.enemyManager.getAliveCount() === 0 && this.phase() === 'wave';
  }

  /**
   * End the current wave
   */
  endWave(): void {
    this.enemyManager.clear();
    this.phase.set('setup');
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
