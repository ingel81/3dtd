import { Injectable, signal, computed, inject } from '@angular/core';
import { EnemyTypeId, getAllEnemyTypes, ENEMY_TYPES } from '../models/enemy-types';
import { UIStore } from '../store/ui.store';
import { WaveConfig } from '../managers/wave.manager';
import { SpawnPattern, ALL_SPAWN_PATTERNS, buildSpawnSchedule } from '../ai/core/spawn-schedule-builder';

/** Configuration for a single enemy group in a mixed wave */
export interface MixedGroupConfig {
  id: number;
  enemyType: EnemyTypeId;
  count: number;
  healthMultiplier: number;
  speedMultiplier: number;
  /** Per-group spawn delay override in ms (undefined = use global delay) */
  spawnDelay?: number;
}

/** Display data for a single enemy group in the wave sidebar */
export interface WaveGroupDisplay {
  enemyType: EnemyTypeId;
  name: string;
  count: number;
  baseHp: number;
  actualHp: number;
  baseSpeed: number;
  actualSpeed: number;
  healthMultiplier: number;
  speedMultiplier: number;
  spawnDelay: number;
}

/** Default enemy type for debug panel */
const DEFAULT_ENEMY_TYPE: EnemyTypeId = 'zombie';

/**
 * Service for wave debug settings.
 * Centralizes all debug-relevant signals for the wave debugger.
 */
@Injectable({ providedIn: 'root' })
export class WaveDebugService {
  private readonly uiStore = inject(UIStore);

  // Get initial values from enemy config (single source of truth)
  private readonly initialConfig = ENEMY_TYPES[DEFAULT_ENEMY_TYPE];

  // Spawn settings - initialized from enemy config
  readonly enemyCount = signal(10);
  readonly enemySpeed = signal(this.initialConfig.baseSpeed);
  readonly enemyHealth = signal(this.initialConfig.baseHp);
  readonly enemyType = signal<EnemyTypeId>(DEFAULT_ENEMY_TYPE);
  readonly spawnMode = signal<'each' | 'random'>('each');
  readonly spawnDelay = signal(1500);

  // Mixed wave mode
  readonly mixedMode = signal(false);
  readonly mixedGroups = signal<MixedGroupConfig[]>([
    { id: 1, enemyType: 'zombie', count: 8, healthMultiplier: 1, speedMultiplier: 1 },
    { id: 2, enemyType: 'bat', count: 4, healthMultiplier: 1, speedMultiplier: 1 },
  ]);
  readonly spawnPattern = signal<SpawnPattern>('interleaved');
  readonly clusterSize = signal(3);
  readonly subWavePause = signal(3000);
  readonly delayVariation = signal(0);
  readonly allPatterns = ALL_SPAWN_PATTERNS;
  private nextGroupId = 3;

  readonly mixedTotalCount = computed(() =>
    this.mixedGroups().reduce((sum, g) => sum + g.count, 0)
  );

  // Available enemy types
  readonly enemyTypes = computed(() => getAllEnemyTypes());

  // Current enemy config based on selected type
  readonly currentEnemyConfig = computed(() => {
    const types = this.enemyTypes();
    return types.find(t => t.id === this.enemyType()) || types[0];
  });

  // Debug log (from UI state service)
  readonly debugLog = this.uiStore.debugLog;

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

  // All enemy groups in the current wave (for mixed wave display)
  readonly currentWaveGroups = signal<WaveGroupDisplay[]>([]);
  readonly isMixedWave = computed(() => this.currentWaveGroups().length > 1);

  setEnemyCount(value: number): void {
    this.enemyCount.set(Math.max(1, Math.min(20000, value)));
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
    this.spawnDelay.set(Math.max(0.01, Math.min(5000, value)));
  }

  // === Mixed Wave Methods ===

  toggleMixedMode(): void {
    this.mixedMode.update(v => !v);
  }

  addGroup(): void {
    const existing = this.mixedGroups();
    const usedTypes = new Set(existing.map(g => g.enemyType));
    const allTypes = getAllEnemyTypes();
    const nextType = allTypes.find(t => !usedTypes.has(t.id as EnemyTypeId));

    this.mixedGroups.update(groups => [
      ...groups,
      {
        id: this.nextGroupId++,
        enemyType: (nextType?.id as EnemyTypeId) ?? 'zombie',
        count: 5,
        healthMultiplier: 1,
        speedMultiplier: 1,
      },
    ]);
  }

  removeGroup(id: number): void {
    this.mixedGroups.update(groups => {
      if (groups.length <= 1) return groups; // keep at least 1
      return groups.filter(g => g.id !== id);
    });
  }

  updateGroup(id: number, changes: Partial<Omit<MixedGroupConfig, 'id'>>): void {
    this.mixedGroups.update(groups =>
      groups.map(g => g.id === id ? { ...g, ...changes } : g)
    );
  }

  setSpawnPattern(pattern: SpawnPattern): void {
    this.spawnPattern.set(pattern);
  }

  setClusterSize(value: number): void {
    this.clusterSize.set(Math.max(1, Math.min(20, value)));
  }

  setSubWavePause(value: number): void {
    this.subWavePause.set(Math.max(500, Math.min(10000, value)));
  }

  setDelayVariation(value: number): void {
    this.delayVariation.set(Math.max(0, Math.min(0.5, value)));
  }

  /**
   * Build a WaveConfig with SpawnSchedule from current mixed-mode settings.
   */
  buildMixedWaveConfig(): WaveConfig {
    const groups = this.mixedGroups().map(g => ({
      type: g.enemyType,
      count: g.count,
      healthMultiplier: g.healthMultiplier !== 1 ? g.healthMultiplier : undefined,
      speedMultiplier: g.speedMultiplier !== 1 ? g.speedMultiplier : undefined,
      spawnDelay: g.spawnDelay,
    }));

    const schedule = buildSpawnSchedule({
      groups,
      pattern: this.spawnPattern(),
      baseDelay: this.spawnDelay(),
      delayVariation: this.delayVariation(),
      clusterSize: this.clusterSize(),
      subWavePause: this.subWavePause(),
    });

    // Legacy fields (ignored when schedule is present, but needed for type compatibility)
    const dominant = this.mixedGroups().reduce((best, curr) =>
      curr.count > best.count ? curr : best
    );

    return {
      enemyCount: this.mixedTotalCount(),
      enemyType: dominant.enemyType,
      enemySpeed: ENEMY_TYPES[dominant.enemyType]?.baseSpeed ?? 5,
      spawnMode: 'random',
      spawnDelay: this.spawnDelay(),
      schedule,
    };
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
   * Set current wave config for a single-type wave.
   * Also sets currentWaveGroups with one entry.
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

    const name = ENEMY_TYPES[enemyType]?.name ?? enemyType;
    this.currentWaveGroups.set([{
      enemyType, name, count, baseHp, actualHp, baseSpeed, actualSpeed,
      healthMultiplier, speedMultiplier, spawnDelay,
    }]);
  }

  /**
   * Set current wave config for a mixed wave with multiple enemy groups.
   * Also sets currentWaveConfig to the dominant group for backwards compat.
   */
  setCurrentWaveGroups(groups: WaveGroupDisplay[]): void {
    this.currentWaveGroups.set(groups);

    // Set currentWaveConfig to dominant group (most enemies)
    if (groups.length > 0) {
      const dominant = groups.reduce((best, g) => g.count > best.count ? g : best);
      this.enemyType.set(dominant.enemyType);
      this.currentWaveConfig.set({
        enemyType: dominant.enemyType,
        count: groups.reduce((sum, g) => sum + g.count, 0),
        baseHp: dominant.baseHp,
        actualHp: dominant.actualHp,
        baseSpeed: dominant.baseSpeed,
        actualSpeed: dominant.actualSpeed,
        spawnDelay: dominant.spawnDelay,
        healthMultiplier: dominant.healthMultiplier,
        speedMultiplier: dominant.speedMultiplier,
      });
    }
  }

  clearLog(): void {
    this.uiStore.debugLog.set('');
  }

  appendLog(message: string): void {
    this.uiStore.debugLog.update(log => {
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
