import { Injectable, signal, computed, inject } from '@angular/core';
import { EnemyTypeId, getAllEnemyTypes, ENEMY_TYPES } from '../models/enemy-types';
import { GameUIStateService } from './game-ui-state.service';

/** Default enemy type for debug panel */
const DEFAULT_ENEMY_TYPE: EnemyTypeId = 'zombie';

/**
 * Service for wave debug settings.
 * Centralizes all debug-relevant signals for the wave debugger.
 */
@Injectable({ providedIn: 'root' })
export class WaveDebugService {
  private readonly uiState = inject(GameUIStateService);

  // Get initial values from enemy config (single source of truth)
  private readonly initialConfig = ENEMY_TYPES[DEFAULT_ENEMY_TYPE];

  // Spawn settings - initialized from enemy config
  readonly enemyCount = signal(10);
  readonly enemySpeed = signal(this.initialConfig.baseSpeed);
  readonly enemyHealth = signal(this.initialConfig.baseHp);
  readonly enemyType = signal<EnemyTypeId>(DEFAULT_ENEMY_TYPE);
  readonly spawnMode = signal<'each' | 'random'>('each');
  readonly spawnDelay = signal(1500);

  // Available enemy types
  readonly enemyTypes = computed(() => getAllEnemyTypes());

  // Current enemy config based on selected type
  readonly currentEnemyConfig = computed(() => {
    const types = this.enemyTypes();
    return types.find(t => t.id === this.enemyType()) || types[0];
  });

  // Debug log (from UI state service)
  readonly debugLog = this.uiState.debugLog;

  // Street count (set externally after loading)
  readonly streetCount = signal(0);

  // Wave state signals (will be connected from GameStateManager)
  readonly waveActive = signal(false);
  readonly baseHealth = signal(100);
  readonly enemiesAlive = signal(0);

  // Current wave config (from AI backend or manual wave start)
  readonly currentWaveConfig = signal<{
    enemyType: EnemyTypeId;
    count: number;
    baseHp: number;
    actualHp: number;
    baseSpeed: number;
    actualSpeed: number;
    spawnDelay: number;
    healthMultiplier: number;
    speedMultiplier: number;
  } | null>(null);

  setEnemyCount(value: number): void {
    this.enemyCount.set(Math.max(1, Math.min(500, value)));
  }

  setEnemySpeed(value: number): void {
    this.enemySpeed.set(Math.max(1, Math.min(100, value)));
  }

  setEnemyHealth(value: number): void {
    this.enemyHealth.set(Math.max(1, Math.min(10000, value)));
  }

  setEnemyType(typeId: EnemyTypeId): void {
    this.enemyType.set(typeId);

    // Set speed and health from enemy config
    const config = this.currentEnemyConfig();
    this.setEnemySpeed(config.baseSpeed);
    this.setEnemyHealth(config.baseHp);
  }

  toggleSpawnMode(): void {
    this.spawnMode.update(mode => mode === 'each' ? 'random' : 'each');
  }

  setSpawnDelay(value: number): void {
    this.spawnDelay.set(Math.max(100, Math.min(5000, value)));
  }

  setStreetCount(count: number): void {
    this.streetCount.set(count);
  }

  // Sync methods to update from GameStateManager
  syncWaveState(active: boolean, health: number, enemies: number): void {
    this.waveActive.set(active);
    this.baseHealth.set(health);
    this.enemiesAlive.set(enemies);
  }

  /**
   * Set current wave config (called when wave starts)
   * Shows the actual multiplied values and base values
   */
  setCurrentWaveConfig(
    enemyType: EnemyTypeId,
    count: number,
    baseHp: number,
    actualHp: number,
    baseSpeed: number,
    actualSpeed: number,
    spawnDelay: number,
    healthMultiplier = 1,
    speedMultiplier = 1
  ): void {
    // Update enemy type so the preview shows the correct model
    this.enemyType.set(enemyType);

    this.currentWaveConfig.set({
      enemyType,
      count,
      baseHp,
      actualHp,
      baseSpeed,
      actualSpeed,
      spawnDelay,
      healthMultiplier,
      speedMultiplier,
    });
  }

  clearLog(): void {
    this.uiState.debugLog.set('');
  }

  appendLog(message: string): void {
    this.uiState.debugLog.update(log => {
      const timestamp = new Date().toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const newEntry = `[${timestamp}] ${message}`;
      return log ? `${log}\n${newEntry}` : newEntry;
    });
  }
}
