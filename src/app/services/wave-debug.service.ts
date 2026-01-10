import { Injectable, signal, computed, inject } from '@angular/core';
import { EnemyTypeId, getAllEnemyTypes, EnemyTypeConfig } from '../models/enemy-types';
import { GameUIStateService } from './game-ui-state.service';

/**
 * Service für Wave-Debug-Einstellungen.
 * Zentralisiert alle Debug-relevanten Signale für den Wave-Debugger.
 */
@Injectable({ providedIn: 'root' })
export class WaveDebugService {
  private readonly uiState = inject(GameUIStateService);

  // Spawn settings
  readonly enemyCount = signal(10);
  readonly enemySpeed = signal(5);
  readonly enemyType = signal<EnemyTypeId>('zombie');
  readonly spawnMode = signal<'each' | 'random'>('each');
  readonly spawnDelay = signal(1500);
  readonly useGathering = signal(false);

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

  setEnemyCount(value: number): void {
    this.enemyCount.set(Math.max(1, Math.min(5000, value)));
  }

  setEnemySpeed(value: number): void {
    this.enemySpeed.set(Math.max(1, Math.min(100, value)));
  }

  setEnemyType(typeId: EnemyTypeId): void {
    this.enemyType.set(typeId);
  }

  toggleSpawnMode(): void {
    this.spawnMode.update(mode => mode === 'each' ? 'random' : 'each');
  }

  setSpawnDelay(value: number): void {
    this.spawnDelay.set(Math.max(100, Math.min(5000, value)));
  }

  toggleGathering(): void {
    this.useGathering.update(v => !v);
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
