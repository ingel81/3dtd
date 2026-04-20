import { signal } from '@angular/core';
import { EnemyManager } from './enemy.manager';
import { EnemyTypeId } from '../models/enemy-types';
import { GamePhase, GeoPosition } from '../models/game.types';
import { GameEventBus, IGameManager } from '../game-engine';
import { GAME_BALANCE } from '../configs/game-balance.config';

// Re-export GamePhase for backward compatibility
export type { GamePhase } from '../models/game.types';

export interface SpawnPoint extends GeoPosition {
  id: string;
  name: string;
}

/** A single spawn entry in a mixed-wave schedule */
export interface SpawnEntry {
  enemyType: EnemyTypeId;
  speed: number;
  health?: number;
  /** Per-entry delay override in ms (overrides schedule baseDelay) */
  delay?: number;
  /** Extra pause in ms after this spawn (for wave-in-wave pattern) */
  pauseAfter?: number;
}

/** Pre-built spawn schedule for mixed enemy waves */
export interface SpawnSchedule {
  entries: SpawnEntry[];
  baseDelay: number;
  getDelay?: () => number;
}

export interface WaveConfig {
  enemyCount: number;
  enemyType: EnemyTypeId;
  enemySpeed: number;
  enemyHealth?: number; // Optional custom health (defaults to enemy type's health)
  spawnMode: 'each' | 'random';
  spawnDelay: number; // Delay in ms between spawning each enemy
  getSpawnDelay?: () => number; // Optional: Dynamic getter for live delay updates during wave
  /** Mixed wave schedule - when present, overrides single-type spawning */
  schedule?: SpawnSchedule;
}

/**
 * Manages wave spawning and game phases
 *
 * Framework-agnostic, event-based:
 * - No @Injectable decorator
 * - Constructor injection
 * - Emits events: wave:started, wave:completed
 */
export class WaveManager implements IGameManager {
  readonly phase = signal<GamePhase>('setup');
  readonly waveNumber = signal(0);

  spawnPoints: SpawnPoint[] = [];
  private cachedPaths = new Map<string, GeoPosition[]>();

  // Track active timeouts for cleanup on reset
  private activeTimeouts = new Set<ReturnType<typeof setTimeout>>();

  private timescaleProvider: (() => number) | null = null;

  // Track spawning state to prevent premature wave completion
  private expectedEnemyCount = 0;
  private spawnedEnemyCount = 0;

  // Track Perfect/CloseCall signals per wave
  private damageTakenThisWave = 0;
  private currentHealthProvider: (() => number) | null = null;

  constructor(
    private eventBus: GameEventBus,
    private enemyManager: EnemyManager
  ) {
    this.registerDebugHandlers();
    // Accumulate damage-to-base during active waves (for Perfect-detection)
    this.eventBus.on('enemy:reached-base', (e) => {
      if (this.phase() === 'wave') {
        this.damageTakenThisWave += e.damage;
      }
    });
  }

  /**
   * Set the current-health provider (from GameStateManager).
   * Used for CloseCall-detection at wave end.
   */
  setCurrentHealthProvider(provider: () => number): void {
    this.currentHealthProvider = provider;
  }

  /**
   * Expected number of enemies in the current wave.
   * Used by EnemyManager for swarm-discount in kill-rewards.
   */
  getExpectedEnemyCount(): number {
    return this.expectedEnemyCount;
  }

  private registerDebugHandlers(): void {
    this.eventBus.on('debug:kill-all', () => {
      this.stopSpawning();
      const timescale = this.timescaleProvider ? this.timescaleProvider() : 1.0;
      for (const enemy of this.enemyManager.getAlive()) {
        if (enemy.alive) {
          this.enemyManager.kill(enemy, timescale);
        }
      }
    });

  }

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
    this.damageTakenThisWave = 0;

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
    // Mixed wave: use schedule-based spawning
    if (config.schedule) {
      this.startScheduledWave(config.schedule);
      return;
    }

    // Guard against invalid enemyCount (NaN, Infinity, negative)
    const enemyCount = Number.isFinite(config.enemyCount) && config.enemyCount > 0
      ? config.enemyCount
      : 10; // Safe fallback
    if (enemyCount !== config.enemyCount) {
      console.warn(`[WaveManager] Invalid enemyCount ${config.enemyCount}, using ${enemyCount}`);
    }

    this.waveNumber.update((n) => n + 1);
    this.phase.set('wave');

    // Initialize spawn tracking
    this.expectedEnemyCount = enemyCount;
    this.spawnedEnemyCount = 0;
    this.damageTakenThisWave = 0;

    // Emit wave:started event with actual enemy count
    this.eventBus.emit({
      type: 'wave:started',
      wave: this.waveNumber(),
      enemyCount, // This is the actual count being spawned
    });

    // Use getter if provided (allows live delay changes), otherwise use static value
    const getDelay = config.getSpawnDelay ?? (() => config.spawnDelay);

    let spawnedCount = 0;
    let consecutiveFailures = 0;

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

      if (spawnedCount >= enemyCount) {
        return;
      }

      const spawn = this.selectSpawnPoint(config.spawnMode, spawnedCount);
      const path = this.cachedPaths.get(spawn.id);

      if (path && path.length > 1) {
        // Spawn enemy and start immediately
        this.enemyManager.spawn(path, config.enemyType, config.enemySpeed, false, config.enemyHealth);
        spawnedCount++;
        this.spawnedEnemyCount++; // Track globally for wave completion check
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        // Abort if no spawn point has a valid path (prevents infinite loop)
        if (consecutiveFailures >= this.spawnPoints.length * 2) {
          console.error(`[WaveManager] No valid paths for spawn points, aborting spawn (${spawnedCount}/${enemyCount})`);
          this.expectedEnemyCount = spawnedCount; // Adjust so wave can complete
          return;
        }
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
   * Start wave from pre-built spawn schedule (mixed enemy types)
   */
  private startScheduledWave(schedule: SpawnSchedule): void {
    const entries = schedule.entries;
    if (entries.length === 0) return;

    this.waveNumber.update((n) => n + 1);
    this.phase.set('wave');

    this.expectedEnemyCount = entries.length;
    this.spawnedEnemyCount = 0;
    this.damageTakenThisWave = 0;

    this.eventBus.emit({
      type: 'wave:started',
      wave: this.waveNumber(),
      enemyCount: entries.length,
    });

    const getDelay = schedule.getDelay ?? (() => schedule.baseDelay);
    let spawnIndex = 0;
    let consecutiveFailures = 0;
    const waveId = this.waveNumber();

    const spawnNext = () => {
      if (this.phase() !== 'wave') return;
      if (this.waveNumber() !== waveId) return;
      if (spawnIndex >= entries.length) return;

      const entry = entries[spawnIndex];
      const spawn = this.selectSpawnPoint('random', spawnIndex);
      const path = this.cachedPaths.get(spawn.id);

      if (path && path.length > 1) {
        this.enemyManager.spawn(path, entry.enemyType, entry.speed, false, entry.health);
        spawnIndex++;
        this.spawnedEnemyCount++;
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= this.spawnPoints.length * 2) {
          console.error(`[WaveManager] No valid paths, aborting scheduled wave (${spawnIndex}/${entries.length})`);
          this.expectedEnemyCount = spawnIndex;
          return;
        }
      }

      if (this.phase() !== 'wave') return;
      if (spawnIndex >= entries.length) return;

      const timescale = this.timescaleProvider ? this.timescaleProvider() : 1.0;
      const baseWait = entry.delay ?? getDelay();
      const extraPause = entry.pauseAfter ?? 0;
      const realTimeDelay = (baseWait + extraPause) / timescale;

      const timeoutId = setTimeout(() => {
        this.activeTimeouts.delete(timeoutId);
        if (this.phase() !== 'wave') return;
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
    // Check both alive AND killing (in death animation) — prevents premature wave completion
    const allEnemiesDead = this.enemyManager.getAliveCount() === 0
      && this.enemyManager.getKillingCount() === 0;

    return allEnemiesSpawned && allEnemiesDead;
  }

  /**
   * End the current wave
   */
  endWave(): { wave: number; perfect: boolean; closeCall: boolean; hpLost: number } {
    const waveNum = this.waveNumber();
    this.enemyManager.clear();
    this.phase.set('setup');

    // Compute Perfect/CloseCall quality signals
    const hpLost = this.damageTakenThisWave;
    const perfect = hpLost === 0;
    const hpAtEnd = this.currentHealthProvider ? this.currentHealthProvider() : 100;
    const closeCall = !perfect && hpAtEnd <= GAME_BALANCE.economy.closeCallHpThreshold;

    // Emit wave:completed event (credits are added by GameStateManager)
    this.eventBus.emitDeferred({
      type: 'wave:completed',
      wave: waveNum,
      credits: 0, // Credits are handled separately via GAME_BALANCE
      perfect,
      closeCall,
      hpLost,
    });

    return { wave: waveNum, perfect, closeCall, hpLost };
  }

  /**
   * Stop all pending spawns (for Kill All functionality)
   * Clears timeouts and adjusts expectedEnemyCount so wave can complete
   */
  stopSpawning(): void {
    // Clear all pending timeouts to prevent spawning after abort
    for (const timeoutId of this.activeTimeouts) {
      clearTimeout(timeoutId);
    }
    this.activeTimeouts.clear();

    // Adjust expected count to match actually spawned enemies
    // This allows checkWaveComplete() to succeed once all spawned enemies die
    this.expectedEnemyCount = this.spawnedEnemyCount;
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

    // Reset spawn tracking counters (prevents stale state after game over mid-wave)
    this.expectedEnemyCount = 0;
    this.spawnedEnemyCount = 0;
  }

  /**
   * Per-frame update (wave logic is event/timeout-driven, no per-frame work needed)
   */
  update(_dt: number): void {
    // Wave spawning is driven by timeouts, not per-frame updates
  }

  /**
   * Destroy the wave manager - cleanup all resources
   */
  destroy(): void {
    this.reset();
    this.cachedPaths.clear();
    this.spawnPoints = [];
  }
}
