import { Injectable, signal, effect } from '@angular/core';

/** LocalStorage key for persisted UI state */
const STORAGE_KEY = 'td-ui-state';

/** Shape of persisted UI state */
interface PersistedUIState {
  infoOverlayVisible: boolean;
  streetsVisible: boolean;
  routesVisible: boolean;
  spatialGridDebugVisible: boolean;
}

/**
 * GameUIStateService
 *
 * Manages UI state signals for the Tower Defense game.
 * Handles debug flags, layer toggles, menu states, and performance stats.
 * Persists layer and overlay visibility to localStorage.
 */
@Injectable({ providedIn: 'root' })
export class GameUIStateService {
  // ========================================
  // DEBUG & MENUS
  // ========================================

  /** Debug panel visibility */
  readonly debugMode = signal(false);

  /** Layer menu (Streets/Routes) expansion state */
  readonly layerMenuExpanded = signal(false);

  /** Developer menu expansion state */
  readonly devMenuExpanded = signal(false);

  // ========================================
  // LAYER VISIBILITY (persisted)
  // ========================================

  /** Street network layer visibility */
  readonly streetsVisible = signal(false);

  /** Enemy route paths visibility */
  readonly routesVisible = signal(false);

  /** Tower range debug visualization visibility */
  readonly towerDebugVisible = signal(false);

  /** Height debug markers visibility */
  readonly heightDebugVisible = signal(false);

  /** Special points debug visibility (fire position, etc.) */
  readonly specialPointsDebugVisible = signal(false);

  /** Info overlay visibility (FPS, tiles, enemies, sounds) */
  readonly infoOverlayVisible = signal(false);

  /** Enemy spatial grid debug visualization */
  readonly spatialGridDebugVisible = signal(false);

  constructor() {
    this.loadPersistedState();
    this.setupPersistence();
  }

  /**
   * Load persisted state from localStorage
   */
  private loadPersistedState(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const state: PersistedUIState = JSON.parse(stored);
        if (state.infoOverlayVisible !== undefined) this.infoOverlayVisible.set(state.infoOverlayVisible);
        if (state.streetsVisible !== undefined) this.streetsVisible.set(state.streetsVisible);
        if (state.routesVisible !== undefined) this.routesVisible.set(state.routesVisible);
        if (state.spatialGridDebugVisible !== undefined) this.spatialGridDebugVisible.set(state.spatialGridDebugVisible);
      }
    } catch {
      // Ignore parse errors
    }
  }

  /**
   * Setup effect to persist state changes to localStorage
   */
  private setupPersistence(): void {
    effect(() => {
      const state: PersistedUIState = {
        infoOverlayVisible: this.infoOverlayVisible(),
        streetsVisible: this.streetsVisible(),
        routesVisible: this.routesVisible(),
        spatialGridDebugVisible: this.spatialGridDebugVisible(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    });
  }

  // ========================================
  // PERFORMANCE STATS
  // ========================================

  /** Frames per second */
  readonly fps = signal(0);

  /** Tile loading statistics */
  readonly tileStats = signal({
    parsing: 0,
    downloading: 0,
    total: 0,
    visible: 0,
  });

  // ========================================
  // DEBUG LOG
  // ========================================

  /** Debug log output (max 50 lines) */
  readonly debugLog = signal('');

  // ========================================
  // PUBLIC API
  // ========================================

  /**
   * Toggle debug panel visibility
   */
  toggleDebug(): void {
    this.debugMode.update((v: boolean) => !v);
  }

  /**
   * Toggle layer menu expansion
   */
  toggleLayerMenu(): void {
    this.layerMenuExpanded.update((v) => !v);
  }

  /**
   * Toggle developer menu expansion
   */
  toggleDevMenu(): void {
    this.devMenuExpanded.update((v) => !v);
  }

  /**
   * Toggle street network visibility
   */
  toggleStreets(): void {
    this.streetsVisible.update((v) => !v);
  }

  /**
   * Toggle route paths visibility
   */
  toggleRoutes(): void {
    this.routesVisible.update((v) => !v);
  }

  /**
   * Toggle tower range debug visibility
   */
  toggleTowerDebug(): void {
    this.towerDebugVisible.update((v) => !v);
  }

  /**
   * Toggle height debug markers visibility
   */
  toggleHeightDebug(): void {
    this.heightDebugVisible.update((v) => !v);
  }

  /**
   * Toggle special points debug visibility (fire position, etc.)
   */
  toggleSpecialPointsDebug(): void {
    this.specialPointsDebugVisible.update((v) => !v);
  }

  /**
   * Toggle info overlay visibility
   */
  toggleInfoOverlay(): void {
    this.infoOverlayVisible.update((v) => !v);
  }

  /**
   * Toggle enemy spatial grid debug visualization
   */
  toggleSpatialGridDebug(): void {
    this.spatialGridDebugVisible.update((v) => !v);
  }

  /**
   * Update FPS counter
   * @param fps Current frames per second
   */
  updateFps(fps: number): void {
    this.fps.set(fps);
  }

  /**
   * Update tile loading statistics
   * @param stats Tile stats object
   */
  updateTileStats(stats: { parsing: number; downloading: number; total: number; visible: number }): void {
    this.tileStats.set(stats);
  }

  /**
   * Append message to debug log
   * Max 50 lines, oldest lines are removed
   * @param message Log message to append
   */
  appendDebugLog(message: string): void {
    this.debugLog.update((log) => {
      const lines = log.split('\n');
      // Keep max 50 lines
      if (lines.length > 50) {
        lines.shift();
      }
      return [...lines, message].join('\n');
    });
  }

  /**
   * Clear entire debug log
   */
  clearDebugLog(): void {
    this.debugLog.set('');
  }

  /**
   * Reset all UI state to defaults
   */
  reset(): void {
    this.debugMode.set(false);
    this.layerMenuExpanded.set(false);
    this.devMenuExpanded.set(false);
    this.streetsVisible.set(false);
    this.routesVisible.set(false);
    this.towerDebugVisible.set(false);
    this.heightDebugVisible.set(false);
    this.specialPointsDebugVisible.set(false);
    this.infoOverlayVisible.set(false);
    this.spatialGridDebugVisible.set(false);
    this.fps.set(0);
    this.tileStats.set({ parsing: 0, downloading: 0, total: 0, visible: 0 });
    this.debugLog.set('');
  }
}
