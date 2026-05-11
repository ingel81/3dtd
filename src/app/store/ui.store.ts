import { Injectable, signal, effect } from '@angular/core';
import { TowerTypeId } from '../configs/tower-types.config';

/** LocalStorage key for persisted UI state */
const STORAGE_KEY = 'td-ui-state';

/** Trailing debounce window for localStorage writes (ms) */
const PERSIST_DEBOUNCE_MS = 500;

/** Shape of persisted UI state */
interface PersistedUIState {
  infoOverlayVisible: boolean;
  streetsVisible: boolean;
  routesVisible: boolean;
  spatialGridDebugVisible: boolean;
  devMenuExpanded: boolean;
  layerMenuExpanded: boolean;
  displayMenuExpanded: boolean;
  audioMenuExpanded?: boolean;
  musicVolume?: number;
  sfxVolume?: number;
  musicMuted?: boolean;
  sfxMuted?: boolean;
}

@Injectable({ providedIn: 'root' })
export class UIStore {
  /** Debug panel visibility */
  readonly debugMode = signal<boolean>(false);

  /** Layer menu expanded */
  readonly layerMenuExpanded = signal<boolean>(false);

  /** Developer menu expanded */
  readonly devMenuExpanded = signal<boolean>(false);

  /** Display settings menu expanded */
  readonly displayMenuExpanded = signal<boolean>(false);

  /** Audio settings menu expanded */
  readonly audioMenuExpanded = signal<boolean>(false);

  /** Music volume (0-1), default matches BACKGROUND_MUSIC.masterVolume */
  readonly musicVolume = signal<number>(0.4);

  /** SFX volume (0-1) */
  readonly sfxVolume = signal<number>(1.0);

  /** Music muted */
  readonly musicMuted = signal<boolean>(false);

  /** SFX muted */
  readonly sfxMuted = signal<boolean>(false);

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

  /** Building footprints visibility */
  readonly buildingsVisible = signal<boolean>(false);

  /** Debug log output */
  readonly debugLog = signal<string>('');

  /** Build mode active */
  readonly buildMode = signal<boolean>(false);

  /** Selected tower type for placement */
  readonly selectedTowerType = signal<TowerTypeId | null>(null);

  /** Build validation reason (why placement is invalid) */
  readonly buildValidationReason = signal<string | null>(null);

  /** Map placement mode: 'hq' to place HQ, 'spawn' to place spawn, null when inactive */
  readonly mapPlacementMode = signal<'hq' | 'spawn' | null>(null);

  constructor() {
    this.loadPersistedState();
    this.setupPersistence();
  }

  // ════════════════════════════════════════════════════════════
  // PERSISTENCE (localStorage)
  // ════════════════════════════════════════════════════════════

  /** Load persisted state from localStorage */
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
        if (state.displayMenuExpanded !== undefined) this.displayMenuExpanded.set(state.displayMenuExpanded);
        if (state.audioMenuExpanded !== undefined) this.audioMenuExpanded.set(state.audioMenuExpanded);
        if (state.musicVolume !== undefined) this.musicVolume.set(state.musicVolume);
        if (state.sfxVolume !== undefined) this.sfxVolume.set(state.sfxVolume);
        if (state.musicMuted !== undefined) this.musicMuted.set(state.musicMuted);
        if (state.sfxMuted !== undefined) this.sfxMuted.set(state.sfxMuted);
      }
    } catch {
      // Ignore parse errors
    }
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingState: PersistedUIState | null = null;

  /** Persist state changes to localStorage via effect with trailing debounce */
  private setupPersistence(): void {
    try {
      effect(() => {
        this.pendingState = {
          infoOverlayVisible: this.infoOverlayVisible(),
          streetsVisible: this.streetsVisible(),
          routesVisible: this.routesVisible(),
          spatialGridDebugVisible: this.spatialGridDebugVisible(),
          devMenuExpanded: this.devMenuExpanded(),
          layerMenuExpanded: this.layerMenuExpanded(),
          displayMenuExpanded: this.displayMenuExpanded(),
          audioMenuExpanded: this.audioMenuExpanded(),
          musicVolume: this.musicVolume(),
          sfxVolume: this.sfxVolume(),
          musicMuted: this.musicMuted(),
          sfxMuted: this.sfxMuted(),
        };
        if (this.persistTimer !== null) return;
        this.persistTimer = setTimeout(() => {
          this.persistTimer = null;
          if (this.pendingState) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.pendingState));
          }
        }, PERSIST_DEBOUNCE_MS);
      });
    } catch {
      // Outside injection context (e.g. unit tests) — persistence disabled
    }
  }

  // ════════════════════════════════════════════════════════════
  // TOGGLE METHODS
  // ════════════════════════════════════════════════════════════

  toggleDebug(): void { this.debugMode.update(v => !v); }
  toggleLayerMenu(): void { this.layerMenuExpanded.update(v => !v); }
  toggleDevMenu(): void { this.devMenuExpanded.update(v => !v); }
  toggleDisplayMenu(): void { this.displayMenuExpanded.update(v => !v); }
  toggleAudioMenu(): void { this.audioMenuExpanded.update(v => !v); }
  toggleStreets(): void { this.streetsVisible.update(v => !v); }
  toggleRoutes(): void { this.routesVisible.update(v => !v); }
  toggleHeightDebug(): void { this.heightDebugVisible.update(v => !v); }
  toggleSpecialPointsDebug(): void { this.specialPointsDebugVisible.update(v => !v); }
  toggleInfoOverlay(): void { this.infoOverlayVisible.update(v => !v); }
  toggleSpatialGridDebug(): void { this.spatialGridDebugVisible.update(v => !v); }
  toggleBuildings(): void { this.buildingsVisible.update(v => !v); }

  // ════════════════════════════════════════════════════════════
  // DEBUG LOG
  // ════════════════════════════════════════════════════════════

  /** Append to debug log (max 50 lines) */
  appendDebugLog(message: string): void {
    this.debugLog.update(log => {
      const lines = log.split('\n');
      while (lines.length >= 50) lines.shift();
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
    this.mapPlacementMode.set(null);
  }

  /** Full reset including UI state. */
  resetAll(): void {
    this.debugMode.set(false);
    this.layerMenuExpanded.set(false);
    this.devMenuExpanded.set(false);
    this.displayMenuExpanded.set(false);
    this.streetsVisible.set(false);
    this.routesVisible.set(false);
    this.heightDebugVisible.set(false);
    this.specialPointsDebugVisible.set(false);
    this.infoOverlayVisible.set(false);
    this.spatialGridDebugVisible.set(false);
    this.dpsBinsVisible.set(false);
    this.buildingsVisible.set(false);
    this.debugLog.set('');
    this.resetBuildState();
  }
}
