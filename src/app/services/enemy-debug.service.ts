import { Injectable, Signal, signal, computed, inject } from '@angular/core';
import { ENEMY_TYPES, EnemyTypeId, getEnemyTypeIds } from '../models/enemy-types';
import { Enemy } from '../entities/enemy.entity';
import { GeoPosition } from '../models/game.types';
import { GameStateManager } from '../managers/game-state.manager';
import { EventSubscription } from '../game-engine';
import { ThreeTilesEngine } from '../three-engine';
import { PathAndRouteService } from './path-route.service';
import { SpawnPoint } from './marker-visualization.service';

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
  private readonly pathRoute = inject(PathAndRouteService);

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

  // --- Placement state (moved from component) ---
  private pendingDebugPlacement: { typeId: EnemyTypeId; lat: number; lon: number } | null = null;
  private gameState: GameStateManager | null = null;
  private engine: ThreeTilesEngine | null = null;
  private spawnPoints!: Signal<SpawnPoint[]>;

  /** Subscription for enemy:spawned listener (cleanup on re-init) */
  private enemySpawnedSub: EventSubscription | null = null;

  /**
   * Initialize with runtime dependencies (called after game state is ready).
   * Also registers the enemy:spawned listener for debug placement.
   */
  initialize(gameState: GameStateManager, engine: ThreeTilesEngine | null, spawnPoints: Signal<SpawnPoint[]>): void {
    this.gameState = gameState;
    this.engine = engine;
    this.spawnPoints = spawnPoints;

    // Cleanup previous listener on re-init
    this.enemySpawnedSub?.dispose();

    // Register debug enemy placement (next spawned enemy after placement click)
    const eventBus = gameState.getEventBus();
    this.enemySpawnedSub = eventBus.on('enemy:spawned', (event) => {
      const pending = this.pendingDebugPlacement;
      if (!pending) return;

      this.pendingDebugPlacement = null;
      this.registerDebugEnemy(event.enemy, pending.typeId, pending.lat, pending.lon);
      this.exitPlacementMode();

      console.log(`[EnemyDebug] Placed ${pending.typeId} at ${pending.lat.toFixed(6)}, ${pending.lon.toFixed(6)}`);
    });
  }

  /**
   * Update engine reference (e.g. after re-initialization).
   */
  setEngine(engine: ThreeTilesEngine | null): void {
    this.engine = engine;
  }

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

  // ─── Placement & Control (moved from TowerDefenseComponent) ───

  /**
   * Handle enemy placement from debug panel.
   * Validates position is on route, creates sub-path, and spawns enemy.
   */
  handleEnemyPlacement(lat: number, lon: number, _height: number): void {
    if (!this.engine || !this.gameState) return;

    // Convert to local coordinates for route grid validation
    const local = this.engine.sync.geoToLocalSimple(lat, lon, 0);

    // Validate: must be on route
    const cell = this.gameState.getGlobalRouteGrid()?.getCellAt(local.x, local.z);
    if (!cell) {
      console.warn('[EnemyDebug] Invalid placement - not on route');
      return;
    }

    // Create path from click position to base
    const path = this.createPathFromPosition(lat, lon);
    if (!path || path.length < 2) {
      console.warn('[EnemyDebug] Could not create path from position');
      return;
    }

    // Get overrides from debug service
    const typeId = this.selectedEnemyId();
    const overrides = this.currentOverrides();

    // Spawn enemy via debug event (paused = idle, classic renderer for live overrides)
    this.pendingDebugPlacement = { typeId, lat, lon };
    this.gameState.getEventBus().emit({
      type: 'debug:spawn-enemy',
      enemyType: typeId,
      count: 1,
      path,
      speed: overrides.baseSpeed,
      paused: true,
      health: overrides.baseHp,
      forceClassic: true,
    });
  }

  /**
   * Create path from a position to the base.
   * Finds nearest point on existing path and creates sub-path.
   */
  private createPathFromPosition(lat: number, lon: number): GeoPosition[] | null {
    const spawns = this.spawnPoints();
    if (spawns.length === 0) return null;

    // Try to find a cached path
    const fullPath = this.pathRoute.getCachedPath(spawns[0].id);
    if (!fullPath || fullPath.length < 2) return null;

    // Find nearest point on path
    let minDist = Infinity;
    let closestIdx = 0;
    for (let i = 0; i < fullPath.length; i++) {
      const dx = fullPath[i].lat - lat;
      const dy = fullPath[i].lon - lon;
      const dist = dx * dx + dy * dy; // Squared distance is fine for comparison
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }

    // Get height at click position (from path if available, else fallback)
    const clickHeight = fullPath[closestIdx].height ?? 0;

    // Create sub-path: click position + rest of path
    return [
      { lat, lon, height: clickHeight },
      ...fullPath.slice(closestIdx + 1)
    ];
  }

  /**
   * Remove a single debug enemy.
   */
  onRemoveDebugEnemy(enemyId: string): void {
    if (!this.gameState) return;
    const de = this.getDebugEnemy(enemyId);
    if (de) {
      this.gameState.enemyManager.remove(de.enemy);
      this.removeDebugEnemy(enemyId);
    }
  }

  /**
   * Clear all debug enemies.
   */
  onClearDebugEnemies(): void {
    if (!this.gameState) return;
    for (const de of this.debugEnemies()) {
      this.gameState.enemyManager.remove(de.enemy);
    }
    this.clearDebugEnemies();
  }

  /**
   * Play idle animation for debug enemy.
   */
  onPlayIdleAnimation(enemyId: string): void {
    this.engine?.enemies.playIdleAnimation(enemyId);
  }

  /**
   * Play walk animation for debug enemy.
   */
  onPlayWalkAnimation(enemyId: string): void {
    this.engine?.enemies.startWalkAnimation(enemyId);
  }

  /**
   * Play run animation for debug enemy.
   */
  onPlayRunAnimation(enemyId: string): void {
    this.engine?.enemies.startRunAnimation(enemyId);
  }

  /**
   * Start movement for debug enemy.
   */
  onStartEnemyMovement(enemyId: string): void {
    const de = this.getDebugEnemy(enemyId);
    if (de?.enemy && de.enemy.alive) {
      de.enemy.startMoving();
      this.engine?.enemies.startWalkAnimation(enemyId);
    }
  }

  /**
   * Stop movement for debug enemy.
   */
  onStopEnemyMovement(enemyId: string): void {
    const de = this.getDebugEnemy(enemyId);
    if (de?.enemy) {
      de.enemy.stopMoving();
      this.engine?.enemies.playIdleAnimation(enemyId);
    }
  }

  /**
   * Dispose all subscriptions and cleanup.
   */
  dispose(): void {
    this.enemySpawnedSub?.dispose();
    this.enemySpawnedSub = null;
    this.gameState = null;
    this.engine = null;
  }
}
