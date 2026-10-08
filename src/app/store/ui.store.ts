import { Injectable, computed, signal, effect } from '@angular/core';
import { TowerTypeId } from '../configs/tower-types.config';
import type { AbilityId } from '../configs/abilities.config';
import { readJson, writeJson } from '../utils/storage';
import type { MainMenuState } from '../components/main-menu/menu-page';

/** LocalStorage key for persisted UI state */
const STORAGE_KEY = 'td-ui-state';

/** Trailing debounce window for localStorage writes (ms) */
const PERSIST_DEBOUNCE_MS = 500;

/**
 * Menus that open above the quick-actions bar. Only one is open at a time.
 * Display and audio settings live on the menu's Settings page.
 */
export type QuickMenu = 'layers' | 'dev';

const QUICK_MENUS: readonly QuickMenu[] = ['layers', 'dev'];

/** Shape of persisted UI state */
interface PersistedUIState {
  infoOverlayVisible: boolean;
  infoOverlayWide?: boolean;
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
}

/**
 * Menu to reopen from a stored state. A legacy state with several open menus
 * reopens one, taken right to left along the bar: dev, then layers. A
 * stored display or audio menu (now on the menu's Settings page) reopens none.
 */
function storedOpenMenu(state: PersistedUIState & LegacyMenuFlags): QuickMenu | null {
  if (state.openMenu !== undefined) {
    return QUICK_MENUS.includes(state.openMenu as QuickMenu) ? state.openMenu : null;
  }
  if (state.devMenuExpanded) return 'dev';
  if (state.layerMenuExpanded) return 'layers';
  return null;
}

/** A message in the banner over the game (UIStore.notice) */
export interface UiNotice {
  text: string;
  /** Offer a reload of the page: what the message says goes away with one */
  reload?: boolean;
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

  /** Info overlay (FPS, tiles, enemies, sounds) expanded; collapsed it shows the FPS only */
  readonly infoOverlayVisible = signal<boolean>(false);

  /**
   * The expanded info overlay's third stage: a column to the right with the
   * simulation's numbers and charts (TODO E75)
   */
  readonly infoOverlayWide = signal<boolean>(false);

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

  /**
   * The main menu (docs/MAIN_MENU_UI_PLAN.md): open, its layer and page.
   * Written by MainMenuService only; here so the HUD, the hotkeys and the
   * hints can wait while it stands. Not persisted.
   */
  readonly mainMenu = signal<MainMenuState>({ open: false, layer: 'start', page: 'home' });

  /** The main menu stands in front of the game */
  readonly mainMenuOpen = computed(() => this.mainMenu().open);

  /** Photo mode or replay: the camera moves, clicks and hover pick nothing, game keys build nothing. */
  readonly viewOnly = computed(() => this.photoMode() || this.replayMode());

  /**
   * The one message banner over the game until closed, null for none. Not
   * persisted; a newer message replaces the one showing.
   */
  readonly notice = signal<UiNotice | null>(null);

  constructor() {
    this.loadPersistedState();
    this.setupPersistence();
  }

  // ════════════════════════════════════════════════════════════
  // PERSISTENCE (localStorage)
  // ════════════════════════════════════════════════════════════

  /**
   * Load persisted state from localStorage. Every field is checked: a value of
   * the wrong type (an old or hand-edited state) keeps the default, a volume
   * is clamped to 0..1, so no NaN or gain above 1 reaches the audio.
   */
  private loadPersistedState(): void {
    const state = readJson(STORAGE_KEY) as (PersistedUIState & LegacyMenuFlags) | null;
    if (!state || typeof state !== 'object') return;
    const flag = (value: unknown, target: { set(v: boolean): void }) => {
      if (typeof value === 'boolean') target.set(value);
    };
    const volume = (value: unknown, target: { set(v: number): void }) => {
      if (typeof value === 'number' && Number.isFinite(value)) target.set(Math.min(1, Math.max(0, value)));
    };
    flag(state.infoOverlayVisible, this.infoOverlayVisible);
    flag(state.infoOverlayWide, this.infoOverlayWide);
    flag(state.streetsVisible, this.streetsVisible);
    flag(state.routesVisible, this.routesVisible);
    flag(state.spatialGridDebugVisible, this.spatialGridDebugVisible);
    flag(state.airSpatialGridDebugVisible, this.airSpatialGridDebugVisible);
    flag(state.airRouteVisible, this.airRouteVisible);
    if (state.perTowerLosFilter === 'both' || state.perTowerLosFilter === 'ground' || state.perTowerLosFilter === 'air') {
      this.perTowerLosFilter.set(state.perTowerLosFilter);
    }
    this.openMenu.set(storedOpenMenu(state));
    volume(state.masterVolume, this.masterVolume);
    flag(state.masterMuted, this.masterMuted);
    volume(state.uiVolume, this.uiVolume);
    flag(state.uiMuted, this.uiMuted);
    volume(state.musicVolume, this.musicVolume);
    volume(state.sfxVolume, this.sfxVolume);
    flag(state.musicMuted, this.musicMuted);
    flag(state.sfxMuted, this.sfxMuted);
    flag(state.autoStartWaves, this.autoStartWaves);
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingState: PersistedUIState | null = null;

  /** Persist state changes to localStorage via effect with trailing debounce */
  private setupPersistence(): void {
    try {
      effect(() => {
        this.pendingState = {
          infoOverlayVisible: this.infoOverlayVisible(),
          infoOverlayWide: this.infoOverlayWide(),
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
        this.persistTimer = setTimeout(() => this.flushPersisted(), PERSIST_DEBOUNCE_MS);
      });
      // A change in the last half second before the tab closes is written at once
      if (typeof window !== 'undefined') window.addEventListener('pagehide', () => this.flushPersisted());
    } catch {
      // Outside injection context (e.g. unit tests) — persistence disabled
    }
  }

  /** Write the pending state now (the debounce's end, or the page going away) */
  private flushPersisted(): void {
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = null;
    // Storage full or blocked: the settings hold for this session
    if (this.pendingState) writeJson(STORAGE_KEY, this.pendingState);
    this.pendingState = null;
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
  /** The info overlay's stages in turn: FPS only, expanded, wide, and back */
  toggleInfoOverlay(): void {
    if (!this.infoOverlayVisible()) {
      this.infoOverlayVisible.set(true);
      this.infoOverlayWide.set(false);
    } else if (!this.infoOverlayWide()) {
      this.infoOverlayWide.set(true);
    } else {
      this.infoOverlayVisible.set(false);
      this.infoOverlayWide.set(false);
    }
  }
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
    this.infoOverlayWide.set(false);
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
