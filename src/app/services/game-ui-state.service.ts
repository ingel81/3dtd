import { Injectable, signal, effect } from '@angular/core';

/** LocalStorage key for persisted UI state */
const STORAGE_KEY = 'td-ui-state';

/** Shape of persisted UI state */
interface PersistedUIState {
  infoOverlayVisible: boolean;
  streetsVisible: boolean;
  routesVisible: boolean;
  spatialGridDebugVisible: boolean;
  devMenuExpanded: boolean;
  layerMenuExpanded: boolean;
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
        if (state.devMenuExpanded !== undefined) this.devMenuExpanded.set(state.devMenuExpanded);
        if (state.layerMenuExpanded !== undefined) this.layerMenuExpanded.set(state.layerMenuExpanded);
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
        devMenuExpanded: this.devMenuExpanded(),
        layerMenuExpanded: this.layerMenuExpanded(),
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

  /** Active spatial audio sound count */
  readonly activeSounds = signal(0);

  /** Map attribution text from tile engine */
  readonly mapAttribution = signal('Map data ©2024 Google');

  /** Compass heading: 0=N, 90=E, 180=S, 270=W */
  readonly cameraHeading = signal(0);

  /** Accumulated rotation for smooth compass animation (avoids 0°/360° flip) */
  readonly compassRotation = signal(0);

  /** Camera debug overlay enabled */
  readonly cameraDebugEnabled = signal(false);

  /** Camera debug info (position, rotation, etc.) */
  readonly cameraDebugInfo = signal<{
    posX: number; posY: number; posZ: number;
    rotX: number; rotY: number; rotZ: number;
    heading: number; pitch: number; altitude: number;
    distanceToCenter: number; fov: number; terrainHeight: number;
  } | null>(null);

  // UI update throttling state (avoids updating signals every frame)
  private lastUIUpdateTime = 0;
  private readonly UI_UPDATE_INTERVAL = 100; // ms - update UI stats ~10x/sec instead of 60x
  private lastFps = 0;
  private lastActiveSounds = 0;

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
   * Throttled UI stats update (~10Hz instead of 60Hz).
   * Called every frame from game loop; internally skips if interval not elapsed.
   * @returns true if stats were updated, false if throttled/skipped
   */
  updateThrottledStats(snapshot: EngineStatsSnapshot): boolean {
    const now = performance.now();
    if (now - this.lastUIUpdateTime < this.UI_UPDATE_INTERVAL) {
      return false; // Skip — too soon
    }
    this.lastUIUpdateTime = now;

    // FPS - only update if changed
    if (snapshot.fps !== this.lastFps) {
      this.lastFps = snapshot.fps;
      this.fps.set(snapshot.fps);
    }

    // Tile stats
    this.tileStats.set(snapshot.tileStats);

    // Active sounds - only update if changed
    if (snapshot.activeSoundCount !== this.lastActiveSounds) {
      this.lastActiveSounds = snapshot.activeSoundCount;
      this.activeSounds.set(snapshot.activeSoundCount);
    }

    // Map attribution - only update if changed
    if (snapshot.attribution && snapshot.attribution !== this.mapAttribution()) {
      this.mapAttribution.set(snapshot.attribution);
    }

    // Compass heading - only update if changed
    const heading = Math.round(snapshot.cameraHeading);
    if (heading !== this.cameraHeading()) {
      const oldHeading = this.cameraHeading();
      this.cameraHeading.set(heading);

      // Calculate shortest rotation delta (handles 0°/360° wrap-around)
      let delta = heading - oldHeading;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;

      // Accumulate rotation for smooth compass animation
      this.compassRotation.update(rot => rot + delta);
    }

    // Camera debug info - only when enabled
    if (this.cameraDebugEnabled() && snapshot.cameraDebugInfo) {
      this.cameraDebugInfo.set(snapshot.cameraDebugInfo);
    }

    // Sound debug stats - passthrough (caller provides if panel is open)
    if (snapshot.soundPoolStats && snapshot.onSoundDebugUpdate) {
      snapshot.onSoundDebugUpdate(snapshot.soundPoolStats);
    }

    return true;
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
    this.heightDebugVisible.set(false);
    this.specialPointsDebugVisible.set(false);
    this.infoOverlayVisible.set(false);
    this.spatialGridDebugVisible.set(false);
    this.fps.set(0);
    this.tileStats.set({ parsing: 0, downloading: 0, total: 0, visible: 0 });
    this.activeSounds.set(0);
    this.mapAttribution.set('Map data ©2024 Google');
    this.cameraHeading.set(0);
    this.compassRotation.set(0);
    this.cameraDebugEnabled.set(false);
    this.cameraDebugInfo.set(null);
    this.debugLog.set('');
    this.lastUIUpdateTime = 0;
    this.lastFps = 0;
    this.lastActiveSounds = 0;
  }
}

/**
 * Snapshot of engine stats passed to updateThrottledStats().
 * The component gathers these values and hands them off for throttled signal updates.
 */
export interface EngineStatsSnapshot {
  fps: number;
  tileStats: { parsing: number; downloading: number; total: number; visible: number };
  activeSoundCount: number;
  attribution?: string;
  cameraHeading: number;
  cameraDebugInfo?: {
    posX: number; posY: number; posZ: number;
    rotX: number; rotY: number; rotZ: number;
    heading: number; pitch: number; altitude: number;
    distanceToCenter: number; fov: number; terrainHeight: number;
  } | null;
  /** Sound pool stats (only when sound debug panel is open) */
  soundPoolStats?: unknown;
  /** Callback to update sound debug service (avoids coupling GameUIStateService to SoundDebugService) */
  onSoundDebugUpdate?: (stats: unknown) => void;
}
