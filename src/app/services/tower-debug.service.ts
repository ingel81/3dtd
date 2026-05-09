import { Injectable, signal, computed, inject } from '@angular/core';
import { TOWER_TYPES, TowerTypeConfig, TowerTypeId } from '../configs/tower-types.config';
import { DebugStore, TowerOverrides } from '../store/debug.store';

export type { TowerOverrides };

/**
 * TowerDebugService - Live-Tuning von Tower-Konfigurationen
 *
 * Ermöglicht das Anpassen von Tower-Werten (scale, heightOffset, etc.)
 * über Slider im Debug-Panel mit sofortiger Visualisierung im Spiel.
 */
@Injectable({ providedIn: 'root' })
export class TowerDebugService {
  private readonly debugStore = inject(DebugStore);

  /** Aktuell ausgewählter Tower-Typ — State im DebugStore. */
  readonly selectedTowerId = this.debugStore.towerSelectedId;

  /** Shoot-Height Visualisierung anzeigen — UI-only, bleibt lokal. */
  readonly showShootHeight = signal(false);

  /** Overrides für ALLE Tower-Typen — State im DebugStore. */
  readonly allOverrides = this.debugStore.towerOverrides;

  /** Alle verfügbaren Tower-Typen */
  readonly towerTypes = computed(() => Object.keys(TOWER_TYPES) as TowerTypeId[]);

  /** Aktuelle Overrides für den ausgewählten Tower */
  readonly currentOverrides = computed(() => {
    const id = this.selectedTowerId();
    return this.allOverrides()[id];
  });

  // Helper für Reset/Re-Init: produziert dieselbe Overrides-Map wie der Store.
  private initAllOverrides(): Record<TowerTypeId, TowerOverrides> {
    const result = {} as Record<TowerTypeId, TowerOverrides>;
    for (const id of Object.keys(TOWER_TYPES) as TowerTypeId[]) {
      const config = TOWER_TYPES[id];
      result[id] = {
        scale: config.scale,
        previewScale: config.previewScale ?? config.scale * 0.4,
        heightOffset: config.heightOffset,
        shootHeight: config.shootHeight,
        rotationY: config.rotationY ?? 0,
      };
    }
    return result;
  }

  /**
   * Gibt die effektive Konfiguration für einen Tower-Typ zurück.
   */
  getEffectiveConfig(id: TowerTypeId): TowerTypeConfig {
    const original = TOWER_TYPES[id];
    const overrides = this.allOverrides()[id];

    return {
      ...original,
      scale: overrides.scale,
      previewScale: overrides.previewScale,
      heightOffset: overrides.heightOffset,
      shootHeight: overrides.shootHeight,
      rotationY: overrides.rotationY,
    };
  }

  /**
   * Setzt den ausgewählten Tower-Typ.
   */
  selectTower(id: TowerTypeId): void {
    this.selectedTowerId.set(id);
  }

  /**
   * Setzt einen einzelnen Override-Wert für den ausgewählten Tower.
   */
  setOverride<K extends keyof TowerOverrides>(key: K, value: number): void {
    const id = this.selectedTowerId();
    const all = this.allOverrides();
    this.allOverrides.set({
      ...all,
      [id]: {
        ...all[id],
        [key]: value,
      },
    });
  }

  /**
   * Setzt die Overrides für den ausgewählten Tower auf Original zurück.
   */
  resetCurrentTower(): void {
    const id = this.selectedTowerId();
    const config = TOWER_TYPES[id];
    const all = this.allOverrides();
    this.allOverrides.set({
      ...all,
      [id]: {
        scale: config.scale,
        previewScale: config.previewScale ?? config.scale * 0.4,
        heightOffset: config.heightOffset,
        shootHeight: config.shootHeight,
        rotationY: config.rotationY ?? 0,
      },
    });
  }

  /**
   * Setzt alle Overrides auf Original-Werte zurück.
   */
  resetAllOverrides(): void {
    this.allOverrides.set(this.initAllOverrides());
  }

  /**
   * Exportiert alle Tower-Overrides als JSON-String.
   */
  exportAllAsJson(): string {
    const overrides = this.allOverrides();
    const exportData: Record<string, TowerOverrides> = {};

    for (const id of Object.keys(TOWER_TYPES) as TowerTypeId[]) {
      exportData[id] = {
        scale: Math.round(overrides[id].scale * 100) / 100,
        previewScale: Math.round(overrides[id].previewScale * 100) / 100,
        heightOffset: Math.round(overrides[id].heightOffset * 100) / 100,
        shootHeight: Math.round(overrides[id].shootHeight * 100) / 100,
        rotationY: Math.round(overrides[id].rotationY * 10000) / 10000,
      };
    }

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Kopiert das komplette JSON in die Zwischenablage.
   */
  async copyJsonToClipboard(): Promise<void> {
    const json = this.exportAllAsJson();
    try {
      await navigator.clipboard.writeText(json);
      console.log('[TowerDebug] JSON copied to clipboard');
    } catch (err) {
      console.error('[TowerDebug] Failed to copy:', err);
    }
  }

  /**
   * Konvertiert Radiant zu Grad.
   */
  radToDeg(rad: number): number {
    return (rad * 180) / Math.PI;
  }

  /**
   * Konvertiert Grad zu Radiant.
   */
  degToRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }
}
