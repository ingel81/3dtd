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

  /**
   * Active spawn controller — driven by tickSpawn() each sub-step in game-time.
   * Sub-stepping guarantees each tick is small (~16ms game-time), so no
   * sub-frame-advance compensation is needed.
   */
  private activeSpawner: {
    waveId: number;
    accumulatedMs: number;      // game-time since last spawn
    nextDelayMs: number;        // game-time until next spawn
    spawnAndAdvance: () => boolean;
    recomputeDelay: () => number;
  } | null = null;

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
      for (const enemy of this.enemyManager.getAlive()) {
        if (enemy.alive) {
          this.enemyManager.kill(enemy);
        }
      }
    });
  }

  initialize(spawnPoints: SpawnPoint[], cachedPaths: Map<string, GeoPosition[]>): void {
    this.spawnPoints = spawnPoints;
    this.cachedPaths = cachedPaths;
  }

  /**
   * Deprecated no-op: timescale handling moved into the engine sub-step loop.
   * Kept temporarily so legacy tests still compile; can be removed once specs
   * are migrated.
   */
  setTimescaleProvider(_provider: () => number): void {
    /* no-op */
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
    this._resetStuckDetector();
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
    const waveId = this.waveNumber();

    // Spawn callback: returns true while wave continues, false when done.
    const spawnOne = (): boolean => {
      if (this.phase() !== 'wave' || this.waveNumber() !== waveId) return false;
      if (spawnedCount >= enemyCount) return false;

      const spawn = this.selectSpawnPoint(config.spawnMode, spawnedCount);
      const path = this.cachedPaths.get(spawn.id);
      if (path && path.length > 1) {
        this.enemyManager.spawn(
          path, config.enemyType, config.enemySpeed, false, config.enemyHealth,
        );
        spawnedCount++;
        this.spawnedEnemyCount++;
        consecutiveFailures = 0;
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= this.spawnPoints.length * 2) {
          console.error(`[WaveManager] No valid paths for spawn points, aborting spawn (${spawnedCount}/${enemyCount})`);
          this.expectedEnemyCount = spawnedCount;
          return false;
        }
      }
      return spawnedCount < enemyCount;
    };

    this.activeSpawner = {
      waveId,
      accumulatedMs: getDelay(),  // spawn first enemy immediately on first tick
      nextDelayMs: getDelay(),
      spawnAndAdvance: spawnOne,
      recomputeDelay: getDelay,
    };
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

    // Compute delay for the *current* entry about to be spawned (used to
    // determine the gap BEFORE spawning this enemy, matching pre-refactor
    // setTimeout semantics where pauseAfter extended the gap to the NEXT spawn).
    const delayForEntry = (idx: number): number => {
      if (idx <= 0) return getDelay();
      const prev = entries[idx - 1];
      const baseWait = prev.delay ?? getDelay();
      const extraPause = prev.pauseAfter ?? 0;
      return baseWait + extraPause;
    };

    const spawnOne = (): boolean => {
      if (this.phase() !== 'wave' || this.waveNumber() !== waveId) return false;
      if (spawnIndex >= entries.length) return false;

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
          return false;
        }
      }
      return spawnIndex < entries.length;
    };

    this.activeSpawner = {
      waveId,
      accumulatedMs: delayForEntry(0),  // spawn first immediately
      nextDelayMs: delayForEntry(0),
      spawnAndAdvance: spawnOne,
      recomputeDelay: () => delayForEntry(spawnIndex),
    };
  }

  /**
   * Drive the active spawner forward by `gameTimeDeltaMs` (game-time of one
   * sub-step, ~16ms). Called per sub-step from GameStateManager. With sub-
   * stepping each tick is small, so a single sub-step usually triggers 0-1
   * spawns — no sub-frame head-start gymnastics needed.
   */
  tickSpawn(gameTimeDeltaMs: number): void {
    const spawner = this.activeSpawner;
    if (!spawner) return;
    if (this.phase() !== 'wave' || this.waveNumber() !== spawner.waveId) {
      this.activeSpawner = null;
      return;
    }

    spawner.accumulatedMs += gameTimeDeltaMs;
    while (spawner.accumulatedMs >= spawner.nextDelayMs) {
      spawner.accumulatedMs -= spawner.nextDelayMs;
      const stillActive = spawner.spawnAndAdvance();
      if (!stillActive) {
        this.activeSpawner = null;
        return;
      }
      spawner.nextDelayMs = spawner.recomputeDelay();
    }
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

    const allEnemiesSpawned = this.expectedEnemyCount === 0 || this.spawnedEnemyCount >= this.expectedEnemyCount;
    const aliveCount = this.enemyManager.getAliveCount();
    const killingCount = this.enemyManager.getKillingCount();
    const totalEntities = this.enemyManager.getAll().length;
    const allEnemiesDead = aliveCount === 0 && killingCount === 0;

    // Stuck-detection: log ONCE per wave when spawning is fully done but
    // counters have been frozen for ≥5s. `_loggedStuckForWave` ensures we
    // don't re-log if counters briefly advance then freeze again mid-wave.
    const stuckCandidate = allEnemiesSpawned && !allEnemiesDead;
    if (stuckCandidate) {
      const progressChanged =
        aliveCount !== this._lastAlive || killingCount !== this._lastKilling;
      if (progressChanged) {
        this._stuckFrames = 0;
      } else {
        this._stuckFrames++;
      }
      this._lastAlive = aliveCount;
      this._lastKilling = killingCount;

      if (
        !this._loggedStuckForWave &&
        this._stuckFrames > 300 // ~5s of no counter change
      ) {
        const enemies = this.enemyManager.getAll();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pending = (this.enemyManager as any).pendingDeaths as
          | { enemy: { id: string }; remainingMs: number }[]
          | undefined;
        console.warn(`[WaveManager] STUCK wave ${this.waveNumber()} (all spawned, counters frozen):`, {
          waveNumber: this.waveNumber(),
          aliveCount, killingCount, totalEntities,
          expectedEnemyCount: this.expectedEnemyCount,
          spawnedEnemyCount: this.spawnedEnemyCount,
          phase: this.phase(),
          activeSpawner: this.activeSpawner !== null,
          pendingDeathsSample: (pending ?? []).slice(0, 3).map(p => ({
            id: p.enemy.id,
            remainingMs: p.remainingMs,
          })),
          entitySnapshot: enemies.slice(0, 5).map(e => ({
            id: e.id,
            type: e.typeConfig.id,
            alive: e.alive,
            hp: e.health.hp,
            maxHp: e.health.maxHp,
            paused: e.movement.paused,
            active: e.active,
            pathIndex: e.movement.currentIndex,
            pathLength: e.movement.path.length,
            progress: e.movement.progress,
          })),
        });
        this._loggedStuckForWave = true;
      }
    } else {
      // Wave not yet fully-spawned (or complete) — reset diagnostic state.
      this._stuckFrames = 0;
      this._lastAlive = aliveCount;
      this._lastKilling = killingCount;
    }

    return allEnemiesSpawned && allEnemiesDead;
  }

  /** Reset stuck-detection flag on wave transitions (called from endWave + reset). */
  private _resetStuckDetector(): void {
    this._loggedStuckForWave = false;
    this._stuckFrames = 0;
    this._lastAlive = 0;
    this._lastKilling = 0;
  }

  private _loggedStuckForWave = false;
  private _stuckFrames = 0;
  private _lastAlive = 0;
  private _lastKilling = 0;

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
   * Stop all pending spawns (for Kill All functionality).
   * Cancels the active spawner and adjusts expectedEnemyCount so wave can complete.
   */
  stopSpawning(): void {
    this.activeSpawner = null;
    this.expectedEnemyCount = this.spawnedEnemyCount;
  }

  /**
   * Reset wave manager
   */
  reset(): void {
    this.activeSpawner = null;
    this.enemyManager.clear();
    this.phase.set('setup');
    this.waveNumber.set(0);

    // Reset spawn tracking counters (prevents stale state after game over mid-wave)
    this.expectedEnemyCount = 0;
    this.spawnedEnemyCount = 0;
    this._resetStuckDetector();
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
