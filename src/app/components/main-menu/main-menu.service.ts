import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { UIStore } from '../../store/ui.store';
import { GameStore } from '../../store/game.store';
import { COOP } from '../../services/coop.token';
import type { MenuLayer, MenuPage } from './menu-page';

/**
 * The main menu's state and its ways (docs/MAIN_MENU_UI_PLAN.md): which
 * page shows in which layer, and the pages walked to get there. Provided by
 * TowerDefenseComponent, so the menu and its pages reach the game's
 * services (CoopService, SAVE_GAME, ReplayService); the open state is
 * mirrored in UIStore.mainMenu for code outside that scope.
 *
 * Pages navigate through here only: `open(page)` goes forward, `back()` one
 * page back, `close()` back to the game.
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

  readonly isOpen = computed(() => this.ui.mainMenu().open);
  readonly layer = computed(() => this.ui.mainMenu().layer);
  readonly page = computed(() => this.ui.mainMenu().page);

  /** The pages walked to the one showing, oldest first; Back pops it */
  private readonly history = signal<readonly MenuPage[]>([]);
  readonly canGoBack = computed(() => this.history().length > 0 || this.page() !== 'home');

  /** The menu paused the game and lets it go on when it closes */
  private pausedByMenu = false;

  constructor() {
    effect(() => {
      const hold = this.isOpen() && !(this.coop?.inGame() ?? false);
      untracked(() => this.holdPause(hold));
    });
  }

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

  /** Back to the game */
  close(): void {
    const state = this.ui.mainMenu();
    if (!state.open) return;
    this.history.set([]);
    this.ui.mainMenu.set({ ...state, open: false, page: 'home' });
  }

  /** Pause the solo game while the menu stands; let it go on after, unless it was paused before */
  private holdPause(hold: boolean): void {
    if (hold && !this.pausedByMenu && !this.store.paused()) {
      this.pausedByMenu = true;
      this.store.paused.set(true);
    } else if (!hold && this.pausedByMenu) {
      this.pausedByMenu = false;
      this.store.paused.set(false);
    }
  }
}
