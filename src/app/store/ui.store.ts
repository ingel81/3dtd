import { Injectable, computed, signal, effect } from '@angular/core';
import { TowerTypeId } from '../configs/tower-types.config';
import type { AbilityId } from '../configs/abilities.config';

/** LocalStorage key for persisted UI state */
const STORAGE_KEY = 'td-ui-state';

/** Trailing debounce window for localStorage writes (ms) */
const PERSIST_DEBOUNCE_MS = 500;

/** Menus that open above the quick-actions bar. Only one is open at a time. */
export type QuickMenu = 'display' | 'audio' | 'layers' | 'dev';

const QUICK_MENUS: readonly QuickMenu[] = ['display', 'audio', 'layers', 'dev'];

/** Shape of persisted UI state */
interface PersistedUIState {
  infoOverlayVisible: boolean;
  streetsVisible: boolean;
  routesVisible: boolean;
  spatialGridDebugVisible: boolean;
  airSpatialGridDebugVisible?: boolean;
  airRouteVisible?: boolean;
  perTowerLosFilter?: 'both' | 'ground' | 'air';
  openMenu?: QuickMenu | null;
  masterVolume?: number;
  masterMuted?: boolean;
  uiVolume?: number;
  uiMuted?: boolean;
  musicVolume?: number;
  sfxVolume?: number;
  musicMuted?: boolean;
  sfxMuted?: boolean;
  autoStartWaves?: boolean;
}

/** Older states stored one flag per menu, and several could be open. */
interface LegacyMenuFlags {
  devMenuExpanded?: boolean;
  layerMenuExpanded?: boolean;
  displayMenuExpanded?: boolean;
  audioMenuExpanded?: boolean;
}

/**
 * Menu to reopen from a stored state. A legacy state with several open menus
 * reopens one, taken right to left along the bar: dev, layers, audio, display.
 */
function storedOpenMenu(state: PersistedUIState & LegacyMenuFlags): QuickMenu | null {
  if (state.openMenu !== undefined) {
    return QUICK_MENUS.includes(state.openMenu as QuickMenu) ? state.openMenu : null;
  }
  if (state.devMenuExpanded) return 'dev';
  if (state.layerMenuExpanded) return 'layers';
  if (state.audioMenuExpanded) return 'audio';
  if (state.displayMenuExpanded) return 'display';
  return null;
}

@Injectable({ providedIn: 'root' })
export class UIStore {
  /** Debug panel visibility */
  readonly debugMode = signal<boolean>(false);

  /**
   * The open quick-actions menu, null when all are closed. Single source for
   * the four menus: the dev panel spans the whole bar and would cover the
   * others, so opening one closes the rest. Persisted, so a reload reopens
   * the menu that was open last.
   */
  readonly openMenu = signal<QuickMenu | null>(null);

  /** Layer menu expanded */
  readonly layerMenuExpanded = computed(() => this.openMenu() === 'layers');

  /** Developer menu expanded */
  readonly devMenuExpanded = computed(() => this.openMenu() === 'dev');

  /** Display settings menu expanded */
  readonly displayMenuExpanded = computed(() => this.openMenu() === 'display');

  /** Audio settings menu expanded */
  readonly audioMenuExpanded = computed(() => this.openMenu() === 'audio');

  /** Overall volume (0-1), on top of music and sound effects */
  readonly masterVolume = signal<number>(1.0);

  /** Everything muted (M) */
  readonly masterMuted = signal<boolean>(false);

  /** Music volume (0-1), default matches BACKGROUND_MUSIC.masterVolume */
  readonly musicVolume = signal<number>(0.4);

  /** SFX volume (0-1) */
  readonly sfxVolume = signal<number>(1.0);

  /** Music muted */
  readonly musicMuted = signal<boolean>(false);

  /** SFX muted */
  readonly sfxMuted = signal<boolean>(false);

  /** UI cues volume (0-1): build pick, dialogs, refusals */
  readonly uiVolume = signal<number>(0.5);

  /** UI cues muted */
  readonly uiMuted = signal<boolean>(false);

  /** Music volume as it plays: channel times master, 0 when either is muted */
  readonly effectiveMusicVolume = computed(() =>
    this.masterMuted() || this.musicMuted() ? 0 : this.masterVolume() * this.musicVolume());

  /** Sound-effect volume as it plays: channel times master, 0 when either is muted */
  readonly effectiveSfxVolume = computed(() =>
    this.masterMuted() || this.sfxMuted() ? 0 : this.masterVolume() * this.sfxVolume());

  /** UI cue volume as it plays: channel times master, 0 when either is muted */
  readonly effectiveUiVolume = computed(() =>
    this.masterMuted() || this.uiMuted() ? 0 : this.masterVolume() * this.uiVolume());

  /**
   * Start the next wave by itself after a countdown once a wave is done.
   * Off by default, persisted. Ignored while a bot plays.
   */
  readonly autoStartWaves = signal<boolean>(false);

  /** Street network layer visibility */
  readonly streetsVisible = signal<boolean>(false);

  /** Route paths visibility (the red enemy route). On by default, persisted. */
  readonly routesVisible = signal<boolean>(true);

  /** Height debug markers visibility */
  readonly heightDebugVisible = signal<boolean>(false);

  /** Special points debug visibility */
  readonly specialPointsDebugVisible = signal<boolean>(false);

  /** Info overlay (FPS, tiles, enemies, sounds) */
  readonly infoOverlayVisible = signal<boolean>(false);

  /**
   * Bottom edge of the info overlay in px from the top of the canvas area,
   * collapsed or expanded, measured by InfoOverlayComponent; 0 while it is
   * not shown. The ability bar keeps below it. Not persisted.
   */
  readonly infoOverlayBottom = signal<number>(0);

  /** Spatial grid debug (ground cells) */
  readonly spatialGridDebugVisible = signal<boolean>(false);

  /** Spatial grid debug at air altitude (mirror of spatialGridDebugVisible) */
  readonly airSpatialGridDebugVisible = signal<boolean>(false);

  /** Air-route tube debug overlay (magenta dashed tube at air altitude) */
  readonly airRouteVisible = signal<boolean>(false);

  /**
   * Per-tower LOS layer filter for Build-Preview + Tower-Selection
   * visualisation. 'both' shows the ground + air plates as today;
   * 'ground' hides the airMesh, 'air' hides the groundMesh. Pure-debug
   * helper while the Air-LOS-pipeline is being researched; long-term
   * the Production-Air-Display will collapse the two layers into one.
   */
  readonly perTowerLosFilter = signal<'both' | 'ground' | 'air'>('both');

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

  /** Ability being aimed (targeting mode, AbilityTargetingService), null outside it */
  readonly abilityTargeting = signal<AbilityId | null>(null);

  /** The hero is selected (HeroControlService): a click on the route sends him. Not persisted. */
  readonly heroSelected = signal<boolean>(false);

  /** Photo mode: HUD hidden, camera free, screenshot bar on top. Not persisted. */
  readonly photoMode = signal<boolean>(false);

  /** Replay of the last wave: HUD hidden, camera free, replay bar at the bottom. Not persisted. */
  readonly replayMode = signal<boolean>(false);

  /**
   * Coop (docs/COOP_PLAN.md, R4): the map belongs to the room. In a running
   * coop game nobody changes place, HQ or spawns, in the lobby only the host
   * does; each of those rebuilds the world here only. The replay is off too.
   * Set by CoopService. Not persisted.
   */
  readonly coopMapLocked = signal<boolean>(false);

  /** Coop: the room dock is open (docs/COOP_PLAN.md, D41); the header chip and Tab toggle it. Not persisted. */
  readonly coopDockOpen = signal<boolean>(false);

  /** Photo mode or replay: the camera moves, clicks and hover pick nothing, game keys build nothing. */
  readonly viewOnly = computed(() => this.photoMode() || this.replayMode());

  /** Message in the banner over the game until closed, null for none. Not persisted. */
  readonly notice = signal<string | null>(null);

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
        const state: PersistedUIState & LegacyMenuFlags = JSON.parse(stored);
        if (state.infoOverlayVisible !== undefined) this.infoOverlayVisible.set(state.infoOverlayVisible);
        if (state.streetsVisible !== undefined) this.streetsVisible.set(state.streetsVisible);
        if (state.routesVisible !== undefined) this.routesVisible.set(state.routesVisible);
        if (state.spatialGridDebugVisible !== undefined) this.spatialGridDebugVisible.set(state.spatialGridDebugVisible);
        if (state.airSpatialGridDebugVisible !== undefined) this.airSpatialGridDebugVisible.set(state.airSpatialGridDebugVisible);
        if (state.airRouteVisible !== undefined) this.airRouteVisible.set(state.airRouteVisible);
        if (state.perTowerLosFilter !== undefined) this.perTowerLosFilter.set(state.perTowerLosFilter);
        this.openMenu.set(storedOpenMenu(state));
        if (state.masterVolume !== undefined) this.masterVolume.set(state.masterVolume);
        if (state.masterMuted !== undefined) this.masterMuted.set(state.masterMuted);
        if (state.uiVolume !== undefined) this.uiVolume.set(state.uiVolume);
        if (state.uiMuted !== undefined) this.uiMuted.set(state.uiMuted);
        if (state.musicVolume !== undefined) this.musicVolume.set(state.musicVolume);
        if (state.sfxVolume !== undefined) this.sfxVolume.set(state.sfxVolume);
        if (state.musicMuted !== undefined) this.musicMuted.set(state.musicMuted);
        if (state.sfxMuted !== undefined) this.sfxMuted.set(state.sfxMuted);
        if (state.autoStartWaves !== undefined) this.autoStartWaves.set(state.autoStartWaves);
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
          airSpatialGridDebugVisible: this.airSpatialGridDebugVisible(),
          airRouteVisible: this.airRouteVisible(),
          perTowerLosFilter: this.perTowerLosFilter(),
          openMenu: this.openMenu(),
          masterVolume: this.masterVolume(),
          masterMuted: this.masterMuted(),
          uiVolume: this.uiVolume(),
          uiMuted: this.uiMuted(),
          musicVolume: this.musicVolume(),
          sfxVolume: this.sfxVolume(),
          musicMuted: this.musicMuted(),
          sfxMuted: this.sfxMuted(),
          autoStartWaves: this.autoStartWaves(),
        };
        if (this.persistTimer !== null) return;
        this.persistTimer = setTimeout(() => {
          this.persistTimer = null;
          if (this.pendingState) {
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(this.pendingState));
            } catch {
              // Storage full or blocked: the settings hold for this session
            }
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

  /** Open a quick-actions menu and close the others, or close it if it is open. */
  toggleMenu(menu: QuickMenu): void { this.openMenu.update(open => (open === menu ? null : menu)); }
  toggleStreets(): void { this.streetsVisible.update(v => !v); }
  toggleRoutes(): void { this.routesVisible.update(v => !v); }
  toggleHeightDebug(): void { this.heightDebugVisible.update(v => !v); }
  toggleSpecialPointsDebug(): void { this.specialPointsDebugVisible.update(v => !v); }
  toggleInfoOverlay(): void { this.infoOverlayVisible.update(v => !v); }
  toggleSpatialGridDebug(): void { this.spatialGridDebugVisible.update(v => !v); }
  toggleAirSpatialGridDebug(): void { this.airSpatialGridDebugVisible.update(v => !v); }
  toggleAirRoute(): void { this.airRouteVisible.update(v => !v); }
  /** Cycle the per-tower LOS filter: both → ground → air → both. */
  cyclePerTowerLosFilter(): void {
    this.perTowerLosFilter.update(v =>
      v === 'both' ? 'ground' : v === 'ground' ? 'air' : 'both'
    );
  }
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
    this.abilityTargeting.set(null);
    this.heroSelected.set(false);
  }

  /** Full reset including UI state. */
  resetAll(): void {
    this.debugMode.set(false);
    this.openMenu.set(null);
    this.streetsVisible.set(false);
    this.routesVisible.set(true);
    this.heightDebugVisible.set(false);
    this.specialPointsDebugVisible.set(false);
    this.infoOverlayVisible.set(false);
    this.spatialGridDebugVisible.set(false);
    this.airSpatialGridDebugVisible.set(false);
    this.airRouteVisible.set(false);
    this.perTowerLosFilter.set('both');
    this.dpsBinsVisible.set(false);
    this.buildingsVisible.set(false);
    this.autoStartWaves.set(false);
    this.debugLog.set('');
    this.resetBuildState();
  }
}
