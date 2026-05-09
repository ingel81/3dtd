import { Injectable, signal } from '@angular/core';
import { ENEMY_TYPES, EnemyTypeId, getEnemyTypeIds } from '../configs/enemy-types.config';
import { TOWER_TYPES, TowerTypeId } from '../configs/tower-types.config';

/** Default enemy type used as initial selection in WaveDebug. Must exist in ENEMY_TYPES. */
const DEFAULT_ENEMY_TYPE: EnemyTypeId = 'zombie';

export interface TowerOverrides {
  scale: number;
  previewScale: number;
  heightOffset: number;
  shootHeight: number;
  rotationY: number;
}

export interface EnemyOverrides {
  scale: number;
  baseHp: number;
  baseSpeed: number;
  heightOffset: number;
  healthBarOffset: number;
  previewScale: number;
  previewCameraDistance: number;
  previewCameraAngle: number;
  previewOffsetY: number;
  rotation: number;
  animationSpeed: number;
}

/**
 * DebugStore — kanonische State-Signals für die Debug-Panels.
 *
 * Vorher lagen diese Signals direkt auf WaveDebugService / TowerDebugService /
 * EnemyDebugService. Laut SIGNAL-STORE-ARCHITECTURE.md gehört State in
 * Stores; Services bleiben für Computed/Methods. Die Services lesen jetzt
 * von hier — ihre öffentliche Schnittstelle bleibt unverändert.
 *
 * Migrierte Signals:
 * - WaveDebug: enemyCount/Speed/Health/Type/spawnMode/spawnDelay
 * - TowerDebug: selectedTowerId, allOverrides
 * - EnemyDebug: placementMode, allOverrides
 */
@Injectable({ providedIn: 'root' })
export class DebugStore {
  // ── Wave-Debug ─────────────────────────────────────────────────
  readonly waveEnemyCount = signal<number>(10);
  readonly waveEnemySpeed = signal<number>(ENEMY_TYPES[DEFAULT_ENEMY_TYPE].baseSpeed);
  readonly waveEnemyHealth = signal<number>(ENEMY_TYPES[DEFAULT_ENEMY_TYPE].baseHp);
  readonly waveEnemyType = signal<EnemyTypeId>(DEFAULT_ENEMY_TYPE);
  readonly waveSpawnMode = signal<'each' | 'random'>('each');
  readonly waveSpawnDelay = signal<number>(1500);

  // ── Tower-Debug ────────────────────────────────────────────────
  readonly towerSelectedId = signal<TowerTypeId>('archer');
  readonly towerOverrides = signal<Record<TowerTypeId, TowerOverrides>>(this.initTowerOverrides());

  // ── Enemy-Debug ────────────────────────────────────────────────
  readonly enemyPlacementMode = signal<boolean>(false);
  readonly enemyOverrides = signal<Record<EnemyTypeId, EnemyOverrides>>(this.initEnemyOverrides());

  private initTowerOverrides(): Record<TowerTypeId, TowerOverrides> {
    const result = {} as Record<TowerTypeId, TowerOverrides>;
    for (const id of Object.keys(TOWER_TYPES) as TowerTypeId[]) {
      const cfg = TOWER_TYPES[id];
      result[id] = {
        scale: cfg.scale,
        previewScale: cfg.previewScale ?? cfg.scale * 0.4,
        heightOffset: cfg.heightOffset,
        shootHeight: cfg.shootHeight,
        rotationY: cfg.rotationY ?? 0,
      };
    }
    return result;
  }

  private initEnemyOverrides(): Record<EnemyTypeId, EnemyOverrides> {
    const result = {} as Record<EnemyTypeId, EnemyOverrides>;
    for (const id of getEnemyTypeIds()) {
      const cfg = ENEMY_TYPES[id];
      result[id] = {
        scale: cfg.scale,
        baseHp: cfg.baseHp,
        baseSpeed: cfg.baseSpeed,
        heightOffset: cfg.heightOffset,
        healthBarOffset: cfg.healthBarOffset,
        previewScale: cfg.previewScale ?? cfg.scale * 0.4,
        previewCameraDistance: cfg.previewCameraDistance ?? 7,
        previewCameraAngle: cfg.previewCameraAngle ?? Math.PI / 12,
        previewOffsetY: cfg.previewOffsetY ?? 0,
        rotation: 0,
        animationSpeed: cfg.animationSpeed ?? 1.0,
      };
    }
    return result;
  }
}
