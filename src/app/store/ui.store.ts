import { Injectable, signal } from '@angular/core';
import { TowerTypeId } from '../configs/tower-types.config';

@Injectable({ providedIn: 'root' })
export class UIStore {
  /** Debug panel visibility */
  readonly debugMode = signal<boolean>(false);

  /** Layer menu expanded */
  readonly layerMenuExpanded = signal<boolean>(false);

  /** Developer menu expanded */
  readonly devMenuExpanded = signal<boolean>(false);

  /** Street network layer visibility */
  readonly streetsVisible = signal<boolean>(false);

  /** Route paths visibility */
  readonly routesVisible = signal<boolean>(false);

  /** Height debug markers visibility */
  readonly heightDebugVisible = signal<boolean>(false);

  /** Special points debug visibility */
  readonly specialPointsDebugVisible = signal<boolean>(false);

  /** Info overlay (FPS, tiles, enemies, sounds) */
  readonly infoOverlayVisible = signal<boolean>(false);

  /** Spatial grid debug */
  readonly spatialGridDebugVisible = signal<boolean>(false);

  /** DPS bins visualization */
  readonly dpsBinsVisible = signal<boolean>(false);

  /** Debug log output */
  readonly debugLog = signal<string>('');

  /** Build mode active */
  readonly buildMode = signal<boolean>(false);

  /** Selected tower type for placement */
  readonly selectedTowerType = signal<TowerTypeId | null>(null);

  /** Build validation reason (why placement is invalid) */
  readonly buildValidationReason = signal<string | null>(null);

  /** Debug: enemy speed override */
  readonly enemySpeed = signal<number>(2.0);

  /** Debug: enemy health override */
  readonly enemyHealth = signal<number>(100);

  /** Debug: enemy count per wave */
  readonly enemyCount = signal<number>(5);

  /** Debug: enemy type */
  readonly enemyType = signal<string>('basic');

  /** Debug: spawn mode (sequential / random / all) */
  readonly spawnMode = signal<string>('sequential');

  /** Debug: spawn delay in ms */
  readonly spawnDelay = signal<number>(1000);

  /** Append to debug log (max 50 lines) */
  appendDebugLog(message: string): void {
    this.debugLog.update(log => {
      const lines = log.split('\n');
      if (lines.length > 50) lines.shift();
      return [...lines, message].join('\n');
    });
  }

  /** Clear debug log */
  clearDebugLog(): void {
    this.debugLog.set('');
  }

  /** Reset build state to initial values. */
  resetBuildState(): void {
    this.buildMode.set(false);
    this.selectedTowerType.set(null);
    this.buildValidationReason.set(null);
  }

  /** Full reset including UI state. */
  resetAll(): void {
    this.debugMode.set(false);
    this.layerMenuExpanded.set(false);
    this.devMenuExpanded.set(false);
    this.streetsVisible.set(false);
    this.routesVisible.set(false);
    this.heightDebugVisible.set(false);
    this.specialPointsDebugVisible.set(false);
    this.infoOverlayVisible.set(false);
    this.spatialGridDebugVisible.set(false);
    this.dpsBinsVisible.set(false);
    this.debugLog.set('');
    this.resetBuildState();
    this.enemySpeed.set(2.0);
    this.enemyHealth.set(100);
    this.enemyCount.set(5);
    this.enemyType.set('basic');
    this.spawnMode.set('sequential');
    this.spawnDelay.set(1000);
  }
}
