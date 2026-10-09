import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { UIStore } from '../../store/ui.store';
import { GameStore } from '../../store/game.store';
import { COOP } from '../../services/coop.token';
import { AUTOSAVE_SLOT, SAVE_GAME, type LoadResult } from '../../services/save-game/save-game.port';
import { shortPlaceName } from '../../services/save-game/slot-name';
import { EngineInitializationService } from '../../services/infrastructure/engine-initialization.service';
import { LocationManagementService } from '../../services/location/location-management.service';
import { LocationChangeCoordinatorService } from '../../services/location/location-change-coordinator.service';
import { TowerDefenseFacadeService } from '../../services/facade/tower-defense-facade.service';
import { readDesktopBridge } from '../../core/desktop-bridge';
import { autosaveElsewhere } from './autosave-place';
import type { MenuLayer, MenuPage } from './menu-page';

/**
 * The start menu stays away for automated runs (docs/MAIN_MENU_UI_PLAN.md,
 * Menü 10): a bot (`?bot=`, except `bot=manual`, where a person plays), the
 * benchmark (`&benchmark`) and `&menu=skip`. The game then starts as soon as
 * its place stands, as before the menu.
 */
export function startMenuSkipped(search: string): boolean {
  const params = new URLSearchParams(search);
  const bot = params.get('bot');
  return (bot !== null && bot !== 'manual') || params.has('benchmark') || params.get('menu') === 'skip';
}

/** The autosave as the list offers it: "Heilbronn · wave 12" */
export interface AutosaveOffer {
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
  private readonly facade = inject(TowerDefenseFacadeService, { optional: true });
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
  /** The place stands: Play starts the game there */
  readonly ready = computed(() => this.hasPlace() && !this.engineInit.loading() && !this.playBlocked());
  /**
   * The last load went wrong (UIStore.loadProblem), or the engine failed.
   * The engine's error waits while another place loads: the plate shows that
   * load, not the failure before it.
   */
  readonly problem = computed(() => {
    const problem = this.ui.loadProblem();
    if (problem) return problem;
    const error = this.engineInit.error();
    return error && !this.engineInit.loading() ? { text: error } : null;
  });
  /**
   * Nothing to play: the engine failed, or the place has no streets. A
   * place that did not load beside it (the dice, a change whose streets
   * did not come) leaves the old one to play on.
   */
  readonly playBlocked = computed(() => this.engineInit.error() !== null || this.ui.loadProblem()?.blocksPlay === true);

  /** Play was pressed while the place loaded: the menu closes when it stands */
  readonly pendingPlay = signal(false);

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
    if (this.inCoop() || this.underWay() || !this.saves.hasAutosave()) return null;
    const autosave = this.saves.slots().find((slot) => slot.id === AUTOSAVE_SLOT);
    if (!autosave) return null;
    return { place: shortPlaceName(autosave.location), wave: autosave.wave, elsewhere: this.autosavePlaceDiffers() };
  });

  /** The place loaded here, as the list names it */
  readonly placeName = computed(() => (this.hasPlace() ? shortPlaceName(this.locationMgmt.displayName()) : null));

  /** The game paused by the menu goes on when it closes */
  private pausedByMenu = false;

  constructor() {
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
   * Continue the autosave: it loads (at its place, which may be another),
   * then the game shows. Asking about another place is the list's (E120).
   */
  async continueAutosave(): Promise<LoadResult> {
    const result = await this.saves.continueAutosave();
    if (result.ok) this.requestPlay();
    return result;
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
