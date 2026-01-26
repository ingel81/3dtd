import { Injectable, signal, computed } from '@angular/core';
import { ENEMY_TYPES, EnemyTypeId, getEnemyTypeIds } from '../models/enemy-types';
import { Enemy } from '../entities/enemy.entity';

export interface EnemyOverrides {
  scale: number;
  baseHp: number;
  baseSpeed: number;
  heightOffset: number;
  healthBarOffset: number;
  previewScale: number;
  rotation: number; // Y rotation offset in radians
  animationSpeed: number; // Animation timeScale multiplier
}

export interface DebugEnemy {
  id: string;
  enemy: Enemy;
  typeId: EnemyTypeId;
  placedAt: { lat: number; lon: number };
  /** Per-enemy overrides (copied from type overrides at spawn, then editable) */
  overrides: EnemyOverrides;
}

/**
 * EnemyDebugService - Live-Tuning von Enemy-Konfigurationen
 *
 * Ermöglicht das Anpassen von Enemy-Werten (scale, baseHp, baseSpeed, etc.)
 * über Slider im Debug-Panel mit manueller Platzierung auf der Route.
 */
@Injectable({ providedIn: 'root' })
export class EnemyDebugService {
  /** Aktuell ausgewählter Enemy-Typ für Slider */
  readonly selectedEnemyId = signal<EnemyTypeId>('zombie');

  /** Placement-Mode aktiv */
  readonly placementMode = signal(false);

  /** Overrides für ALLE Enemy-Typen */
  readonly allOverrides = signal<Record<EnemyTypeId, EnemyOverrides>>(this.initAllOverrides());

  /** Liste der platzierten Debug-Enemies */
  readonly debugEnemies = signal<DebugEnemy[]>([]);

  /** Aktuell selektierter Debug-Enemy (für Live-Editing) */
  readonly selectedDebugEnemyId = signal<string | null>(null);

  /** Alle verfügbaren Enemy-Typen */
  readonly enemyTypes = computed(() => getEnemyTypeIds());

  /** Aktuelle Overrides für den ausgewählten Enemy-Typ (für Placement) */
  readonly currentOverrides = computed(() => {
    const id = this.selectedEnemyId();
    return this.allOverrides()[id];
  });

  /** Aktuell selektierter Debug-Enemy (für Live-Editing) */
  readonly selectedDebugEnemy = computed(() => {
    const id = this.selectedDebugEnemyId();
    if (!id) return null;
    return this.debugEnemies().find(de => de.id === id) ?? null;
  });

  /** Initialisiert Overrides mit Original-Werten für alle Enemies */
  private initAllOverrides(): Record<EnemyTypeId, EnemyOverrides> {
    const result = {} as Record<EnemyTypeId, EnemyOverrides>;
    for (const id of getEnemyTypeIds()) {
      const config = ENEMY_TYPES[id];
      result[id as EnemyTypeId] = {
        scale: config.scale,
        baseHp: config.baseHp,
        baseSpeed: config.baseSpeed,
        heightOffset: config.heightOffset,
        healthBarOffset: config.healthBarOffset,
        previewScale: config.previewScale ?? config.scale * 0.4,
        rotation: 0,
        animationSpeed: config.animationSpeed ?? 1.0,
      };
    }
    return result;
  }

  /**
   * Setzt den ausgewählten Enemy-Typ.
   */
  selectEnemy(id: EnemyTypeId): void {
    this.selectedEnemyId.set(id);
  }

  /**
   * Setzt einen einzelnen Override-Wert für den ausgewählten Enemy.
   */
  setOverride<K extends keyof EnemyOverrides>(key: K, value: number): void {
    const id = this.selectedEnemyId();
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
   * Setzt die Overrides für den ausgewählten Enemy auf Original zurück.
   */
  resetCurrentEnemy(): void {
    const id = this.selectedEnemyId();
    const config = ENEMY_TYPES[id];
    const all = this.allOverrides();
    this.allOverrides.set({
      ...all,
      [id]: {
        scale: config.scale,
        baseHp: config.baseHp,
        baseSpeed: config.baseSpeed,
        heightOffset: config.heightOffset,
        healthBarOffset: config.healthBarOffset,
        previewScale: config.previewScale ?? config.scale * 0.4,
        rotation: 0,
        animationSpeed: config.animationSpeed ?? 1.0,
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
   * Toggled den Placement-Mode.
   */
  togglePlacementMode(): void {
    this.placementMode.update(v => !v);
  }

  /**
   * Aktiviert den Placement-Mode.
   */
  enterPlacementMode(): void {
    this.placementMode.set(true);
  }

  /**
   * Deaktiviert den Placement-Mode.
   */
  exitPlacementMode(): void {
    this.placementMode.set(false);
  }

  /**
   * Registriert einen platzierten Debug-Enemy.
   * Kopiert die aktuellen Type-Overrides als Startwerte.
   */
  registerDebugEnemy(enemy: Enemy, typeId: EnemyTypeId, lat: number, lon: number): void {
    const typeOverrides = this.allOverrides()[typeId];
    this.debugEnemies.update(list => [
      ...list,
      {
        id: enemy.id,
        enemy,
        typeId,
        placedAt: { lat, lon },
        overrides: { ...typeOverrides },
      },
    ]);
  }

  /**
   * Selektiert einen Debug-Enemy für Live-Editing.
   */
  selectDebugEnemy(enemyId: string | null): void {
    this.selectedDebugEnemyId.set(enemyId);
  }

  /**
   * Toggled die Selektion eines Debug-Enemy.
   */
  toggleDebugEnemySelection(enemyId: string): void {
    if (this.selectedDebugEnemyId() === enemyId) {
      this.selectedDebugEnemyId.set(null);
    } else {
      this.selectedDebugEnemyId.set(enemyId);
    }
  }

  /**
   * Aktualisiert einen Override-Wert für den selektierten Debug-Enemy.
   */
  updateSelectedOverride<K extends keyof EnemyOverrides>(key: K, value: number): void {
    const id = this.selectedDebugEnemyId();
    if (!id) return;

    this.debugEnemies.update(list =>
      list.map(de => de.id === id
        ? { ...de, overrides: { ...de.overrides, [key]: value } }
        : de
      )
    );
  }

  /**
   * Entfernt einen Debug-Enemy aus der Liste.
   * Löscht auch die Selektion falls dieser Enemy selektiert war.
   */
  removeDebugEnemy(enemyId: string): void {
    if (this.selectedDebugEnemyId() === enemyId) {
      this.selectedDebugEnemyId.set(null);
    }
    this.debugEnemies.update(list => list.filter(de => de.id !== enemyId));
  }

  /**
   * Setzt die Overrides des selektierten Debug-Enemy auf Original zurück.
   */
  resetSelectedEnemy(): void {
    const selected = this.selectedDebugEnemy();
    if (!selected) return;

    const config = ENEMY_TYPES[selected.typeId];
    this.debugEnemies.update(list =>
      list.map(de => de.id === selected.id
        ? {
            ...de,
            overrides: {
              scale: config.scale,
              baseHp: config.baseHp,
              baseSpeed: config.baseSpeed,
              heightOffset: config.heightOffset,
              healthBarOffset: config.healthBarOffset,
              previewScale: config.previewScale ?? config.scale * 0.4,
              rotation: 0,
              animationSpeed: config.animationSpeed ?? 1.0,
            }
          }
        : de
      )
    );
  }

  /**
   * Holt einen Debug-Enemy anhand der ID.
   */
  getDebugEnemy(enemyId: string): DebugEnemy | undefined {
    return this.debugEnemies().find(de => de.id === enemyId);
  }

  /**
   * Prüft ob ein Enemy ein Debug-Enemy ist.
   */
  isDebugEnemy(enemyId: string): boolean {
    return this.debugEnemies().some(de => de.id === enemyId);
  }

  /**
   * Leert die Debug-Enemy Liste (ohne Entities zu entfernen).
   */
  clearDebugEnemies(): void {
    this.selectedDebugEnemyId.set(null);
    this.debugEnemies.set([]);
  }

  /**
   * Exportiert alle Enemy-Overrides als JSON-String.
   */
  exportAllAsJson(): string {
    const overrides = this.allOverrides();
    const exportData: Record<string, EnemyOverrides> = {};

    for (const id of getEnemyTypeIds()) {
      exportData[id] = {
        scale: Math.round(overrides[id as EnemyTypeId].scale * 1000) / 1000,
        baseHp: Math.round(overrides[id as EnemyTypeId].baseHp),
        baseSpeed: Math.round(overrides[id as EnemyTypeId].baseSpeed * 10) / 10,
        heightOffset: Math.round(overrides[id as EnemyTypeId].heightOffset * 10) / 10,
        healthBarOffset: Math.round(overrides[id as EnemyTypeId].healthBarOffset * 10) / 10,
        previewScale: Math.round(overrides[id as EnemyTypeId].previewScale * 1000) / 1000,
        rotation: Math.round(overrides[id as EnemyTypeId].rotation * 1000) / 1000,
        animationSpeed: Math.round(overrides[id as EnemyTypeId].animationSpeed * 100) / 100,
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
      console.log('[EnemyDebug] JSON copied to clipboard');
    } catch (err) {
      console.error('[EnemyDebug] Failed to copy:', err);
    }
  }
}
