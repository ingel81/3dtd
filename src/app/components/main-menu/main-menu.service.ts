import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { UIStore } from '../../store/ui.store';
import { GameStore } from '../../store/game.store';
import { COOP } from '../../services/coop.token';
import { AUTOSAVE_MAP_SLOT, AUTOSAVE_SLOT, SAVE_GAME, type LoadResult, type SaveSlotInfo } from '../../services/save-game/save-game.port';
import { shortPlaceName } from '../../services/save-game/slot-name';
import { EngineInitializationService } from '../../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { GLOBE_LINK } from '../../services/world/globe-link';
import { LocationChangeCoordinatorService } from '../../services/location/location-change-coordinator.service';
import { TowerDefenseFacadeService } from '../../services/facade/tower-defense-facade.service';
import { readDesktopBridge } from '../../core/desktop-bridge';
import { autosaveElsewhere } from './autosave-place';
import type { MenuLayer, MenuPage } from './menu-page';
import { startMenuSkipped } from './start-menu-skipped';
import { WorldContext } from '../../world/world-context.service';
import { RESUME_URL_PARAM, WorldChoiceService } from '../../world/world-choice.service';
import { CUSTOM_MAPS_OPEN } from '../../world/custom-maps-open';

export { startMenuSkipped } from './start-menu-skipped';

/** What the start list shows: the real places of the 3D tiles, or the custom maps */
export type MenuWorldTab = 'real' | 'custom';

/** The autosave as the list offers it: "Heilbronn | wave 12" */
export interface AutosaveOffer {
  /** The slot: the real places' autosave or the maps' */
  slotId: string;
  place: string;
  wave: number;
  /** It stands at another place than the one loaded: Continue goes there (E120) */
  elsewhere: boolean;
}

/**
 * The main menu's state and its ways (docs/MAIN_MENU_UI_PLAN.md): which
 * page shows in which layer, and the pages walked to get there. Provided by
 * TowerDefenseComponent, so the menu and its pages reach the game's
 * services (CoopService, SAVE_GAME, ReplayService); the open state is
 * mirrored in UIStore.mainMenu for code outside that scope.
 *
 * Pages navigate through here only: `open(page)` goes forward, `back()` one
 * page back, `close()` back to the game. A place chosen in the menu
 * (LocationChangeCoordinatorService.choosePlace) loads behind it, in the
 * start layer; `requestPlay()` closes the start menu once the place stands,
 * a click before that is kept and played when it does.
 *
 * Alone the game pauses while the menu stands, in both layers; it goes on
 * when the menu closes, unless it was paused before. In coop the room's
 * clock is everyone's, so the menu never pauses it.
 */
@Injectable()
export class MainMenuService {
  private readonly ui = inject(UIStore);
  private readonly store = inject(GameStore);
  private readonly coop = inject(COOP, { optional: true });
  private readonly saves = inject(SAVE_GAME);
  private readonly engineInit = inject(EngineInitializationService);
  private readonly locationMgmt = inject(LocationManagementService);
  private readonly location = inject(LocationChangeCoordinatorService);
  private readonly globe = inject(GLOBE_LINK, { optional: true });
  private readonly facade = inject(TowerDefenseFacadeService, { optional: true });
  private readonly worldContext = inject(WorldContext);
  private readonly worlds = inject(WorldChoiceService);
  /** The custom maps are open (CUSTOM_MAPS_OPEN): the start list has its two tabs */
  private readonly mapsOpen = inject(CUSTOM_MAPS_OPEN);
  private readonly bridge = readDesktopBridge();

  readonly isOpen = computed(() => this.ui.mainMenu().open);
  readonly layer = computed(() => this.ui.mainMenu().layer);
  readonly page = computed(() => this.ui.mainMenu().page);

  /** The pages walked to the one showing, oldest first; Back pops it */
  private readonly history = signal<readonly MenuPage[]>([]);

  /** Automated runs play without the start menu (startMenuSkipped) */
  readonly automated = startMenuSkipped(typeof window === 'undefined' ? '' : window.location.search);

  /** The link named the place (?l=): Play comes before Continue */
  readonly linkedPlace = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('l');

  // ---- The place behind the menu ----

  /** A place is chosen and loads or stands; false while the game waits for the first one */
  readonly hasPlace = computed(() => !this.location.awaitingStartChoice() && this.locationMgmt.hq() !== null);
  /**
   * The place loads (the loading plate shows). A failed engine sets
   * `loading` off itself; an error left from a change that broke shows no
   * longer while the next place loads.
   */
  readonly placeLoading = computed(() => this.hasPlace() && this.engineInit.loading());
  /** The menu globe loads the dive's tiles before it flies: how far in percent, null while it does not */
  readonly descent = computed(() => this.globe?.descent() ?? null);
  /** The place stands, and the dive from the menu globe has landed in it: Play starts the game there */
  readonly ready = computed(
    () => this.hasPlace() && !this.engineInit.loading() && !this.playBlocked() && !this.globe?.holdsPlay(),
  );
  /**
   * The last load went wrong (UIStore.loadProblem), the map's tiles do not
   * come (UIStore.tilesProblem), or the engine failed.
   * The engine's error waits while another place loads: the plate shows that
   * load, not the failure before it.
   */
  readonly problem = computed(() => {
    const problem = this.ui.loadProblem() ?? this.ui.tilesProblem();
    if (problem) return problem;
    const error = this.engineInit.error();
    return error && !this.engineInit.loading() ? { text: error } : null;
  });
  /**
   * Nothing to play: the engine failed, the map's tiles do not come, or the place has no streets. A
   * place that did not load beside it (the dice, a change whose streets
   * did not come) leaves the old one to play on.
   */
  readonly playBlocked = computed(
    () => this.engineInit.error() !== null || this.ui.loadProblem()?.blocksPlay === true || this.ui.tilesProblem() !== null,
  );

  /** Play was pressed while the place loaded: the menu closes when it stands */
  readonly pendingPlay = signal(false);

  // ---- Real places and custom maps ----

  /** The page plays a custom map */
  readonly onMap = computed(() => this.worldContext.ref().kind === 'custom-map');
  /**
   * Which kind of world the start list shows. It follows the world the
   * page plays; the player may look at the other: its Continue and Load
   * then load the page anew on that world.
   */
  readonly tab = signal<MenuWorldTab>('real');
  /** The start list shows the tabs: the maps are open, and the player picks the world (not in coop) */
  readonly tabsShown = computed(() => this.mapsOpen && this.layer() === 'start' && !this.inCoop() && !this.ui.coopMapLocked());
  /** The tab that is the world of this page */
  readonly homeTab = computed<MenuWorldTab>(() => (this.onMap() ? 'custom' : 'real'));
  /** The list shows the world of this page (or there are no tabs) */
  readonly onHomeTab = computed(() => !this.tabsShown() || this.tab() === this.homeTab());

  /** A save the page was opened to load (?resume=), said when it went wrong */
  readonly notice = signal<string | null>(null);

  // ---- The run ----

  readonly inCoop = computed(() => this.coop?.inGame() ?? false);
  /** The run has begun: Restart, Load and Quit end something */
  readonly underWay = computed(() => this.store.gameStarted() || this.store.towerCount() > 0);
  /** Restart needs the game's facade; in coop the host restarts at game over (docs/COOP_PLAN.md, R1) */
  readonly canRestart = computed(() => this.facade !== null && !this.inCoop() && this.hasPlace());
  /** The place is the player's to change: not in a coop game, not for a guest in a lobby (coopMapLocked) */
  readonly canChangePlace = computed(() => !this.inCoop() && !this.ui.coopMapLocked());
  /** Quit exists where the app can end itself: the desktop build from 0.5.1 on */
  readonly canQuit = typeof this.bridge?.quit === 'function';

  /**
   * The autosave, offered while the new run has not begun; once the run is
   * under way the autosave is this run's
   */
  readonly autosaveOffer = computed<AutosaveOffer | null>(() => {
    // The run under way here is this tab's to continue; the other tab offers its own autosave
    if (this.inCoop() || (this.underWay() && this.onHomeTab())) return null;
    const custom = this.tabsShown() && this.tab() === 'custom';
    const autosave = this.saves.slots().find((slot) => slot.id === (custom ? AUTOSAVE_MAP_SLOT : AUTOSAVE_SLOT));
    if (!autosave) return null;
    const place = custom ? (autosave.map?.name ?? shortPlaceName(autosave.location)) : shortPlaceName(autosave.location);
    const elsewhere = this.needsOtherWorld(autosave) || (!custom && this.autosavePlaceDiffers());
    return { slotId: autosave.id, place, wave: autosave.wave, elsewhere };
  });

  /** The slots the Load page lists: under a tab only that world's */
  readonly loadableSlots = computed<readonly SaveSlotInfo[]>(() => {
    const slots = this.saves.slots();
    if (!this.tabsShown()) return slots;
    const custom = this.tab() === 'custom';
    return slots.filter((slot) => (slot.map !== null) === custom);
  });

  /** The place loaded here, as the list names it */
  readonly placeName = computed(() => (this.hasPlace() ? shortPlaceName(this.locationMgmt.displayName()) : null));

  /** The game paused by the menu goes on when it closes */
  private pausedByMenu = false;

  constructor() {
    // The tab follows the world the page plays
    effect(() => {
      const home = this.homeTab();
      untracked(() => this.tab.set(home));
    });
    this.resumeFromLink();
    // Play waiting for the landing makes the dive quicker
    effect(() => this.globe?.playWaits.set(this.pendingPlay()));
    effect(() => {
      const hold = this.isOpen() && !this.inCoop();
      const paused = this.store.paused();
      untracked(() => this.holdPause(hold, paused));
    });
    // Play pressed while loading: played once the place stands
    effect(() => {
      if (!this.pendingPlay() || !this.ready()) return;
      untracked(() => {
        this.pendingPlay.set(false);
        this.close();
      });
    });
    // In a coop room the place is the room's (a guest joining or following the
    // host, the host's dice in the lobby): nobody waits behind Play, the menu
    // goes once the place stands and the dock or the game is in front again
    effect(() => {
      if (this.coop?.room() && this.placeLoading()) untracked(() => this.pendingPlay.set(true));
    });
    // Another place starts to load (header, dice, favourite, a save elsewhere,
    // a coop guest following the host): the start layer shows its plate. A
    // page open stays (the Load page waits for its load to say how it went),
    // a closed menu opens on its list.
    let wasLoading = this.engineInit.loading();
    effect(() => {
      const loading = this.engineInit.loading();
      const began = loading && !wasLoading;
      wasLoading = loading;
      if (began && !this.automated) untracked(() => this.showStartLayer());
    });
  }

  // ---- Pages ----

  /**
   * Open the menu on `page`, or go to it while the menu stands (Back returns
   * to the page before). A closed menu opens in `layer`, by default the
   * pause layer; an open one keeps its layer unless one is given.
   */
  open(page: MenuPage = 'home', layer?: MenuLayer): void {
    const state = this.ui.mainMenu();
    if (!state.open) {
      this.history.set([]);
      this.ui.mainMenu.set({ open: true, layer: layer ?? 'pause', page });
      return;
    }
    if (state.page !== page) this.history.update((pages) => [...pages, state.page]);
    this.ui.mainMenu.set({ open: true, layer: layer ?? state.layer, page });
  }

  /** Back to the list in `layer`, no page history; opens the menu when it is closed */
  home(layer: MenuLayer = this.layer()): void {
    this.history.set([]);
    this.ui.mainMenu.set({ open: true, layer, page: 'home' });
  }

  /** The start layer, on the page open or else on the list */
  private showStartLayer(): void {
    const state = this.ui.mainMenu();
    if (!state.open) this.history.set([]);
    this.ui.mainMenu.set({ open: true, layer: 'start', page: state.open ? state.page : 'home' });
  }

  /** The start menu at app start, after the token step; not for automated runs */
  openStart(): void {
    if (!this.automated) this.open('home', 'start');
  }

  /**
   * One step back: the page before, else the list. On the list the pause
   * layer closes (back to the game); the start layer stays, it has no game
   * behind it to go back to. True when it did something.
   */
  back(): boolean {
    const state = this.ui.mainMenu();
    if (!state.open) return false;
    const pages = this.history();
    if (pages.length > 0) {
      this.history.set(pages.slice(0, -1));
      this.ui.mainMenu.set({ ...state, page: pages[pages.length - 1] });
      return true;
    }
    if (state.page !== 'home') {
      this.ui.mainMenu.set({ ...state, page: 'home' });
      return true;
    }
    if (state.layer === 'pause') {
      this.close();
      return true;
    }
    return false;
  }

  /** Back to the game; the show of a place that stood up meanwhile starts now (StartShowService) */
  close(): void {
    const state = this.ui.mainMenu();
    if (!state.open) return;
    this.history.set([]);
    this.pendingPlay.set(false);
    // Said and gone: the place played on is the old one
    if (!this.playBlocked()) this.ui.loadProblem.set(null);
    this.ui.mainMenu.set({ ...state, open: false, page: 'home' });
  }

  // ---- Playing ----

  /** Play, or Continue of a run already loaded: now when the place stands, else as soon as it does */
  requestPlay(): void {
    if (this.ready()) this.close();
    else if (this.hasPlace() && !this.playBlocked()) this.pendingPlay.set(true);
  }

  /**
   * Continue an autosave (by default the real places'): it loads (at its
   * place, which may be another), then the game shows. Asking about another
   * place is the list's (E120).
   */
  async continueAutosave(slotId: string = AUTOSAVE_SLOT): Promise<LoadResult> {
    const slot = this.saves.slots().find((s) => s.id === slotId);
    const result = slotId === AUTOSAVE_SLOT && !(slot && this.needsOtherWorld(slot))
      ? await this.saves.continueAutosave()
      : await this.loadSlot(slotId);
    if (result.ok) this.requestPlay();
    return result;
  }

  /**
   * Load a slot. One of another world (a map's save on the real places, a
   * real place's on a map, another map) loads the page anew there and
   * loads it then (WorldChoiceService.openSave); else here.
   */
  async loadSlot(slotId: string): Promise<LoadResult> {
    const slot = this.saves.slots().find((s) => s.id === slotId);
    if (slot && this.needsOtherWorld(slot)) {
      this.worlds.openSave(slot);
      return { ok: true, note: null };
    }
    return this.saves.load(slotId);
  }

  /** The save plays on another world than this page's */
  needsOtherWorld(slot: Pick<SaveSlotInfo, 'map'>): boolean {
    const here = this.worldContext.ref();
    if (slot.map) return here.kind !== 'custom-map' || here.mapId !== slot.map.id;
    return !this.worldContext.capabilities().realPlace;
  }

  /** The page was opened to load a save (?resume=): it loads now; the link loses the word, so a reload does not load it again */
  private resumeFromLink(): void {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const slotId = url.searchParams.get(RESUME_URL_PARAM);
    if (!slotId) return;
    url.searchParams.delete(RESUME_URL_PARAM);
    window.history.replaceState(window.history.state, '', url.toString());
    void this.saves.load(slotId).then((result) => {
      if (!result.ok) this.notice.set(result.reason);
      else if (result.note) this.notice.set(`Loaded. ${result.note}`);
      else this.requestPlay();
    });
  }

  /** The autosave stands at another place than the one loaded (E120) */
  autosavePlaceDiffers(): boolean {
    const autosave = this.saves.slots().find((slot) => slot.id === AUTOSAVE_SLOT);
    if (!autosave || !this.hasPlace()) return false;
    return autosaveElsewhere(autosave, { hq: this.locationMgmt.hq(), name: this.locationMgmt.displayName() });
  }

  /** Restart at the same place (the list asks first while a run is under way) */
  restart(): void {
    if (!this.canRestart()) return;
    this.facade?.restartGame();
    this.close();
  }

  /** End the desktop app */
  quit(): void {
    this.bridge?.quit?.();
  }

  // ---- Pause ----

  /**
   * Pause the solo game while the menu stands; let it go on after, unless
   * it was paused before. A new run behind the menu (a place, a restart)
   * sets it going: paused again.
   */
  private holdPause(hold: boolean, paused: boolean): void {
    if (hold && !paused) {
      this.pausedByMenu = true;
      this.store.paused.set(true);
    } else if (!hold && this.pausedByMenu) {
      this.pausedByMenu = false;
      this.store.paused.set(false);
    }
  }
}
