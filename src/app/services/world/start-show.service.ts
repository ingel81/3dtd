import { Injectable, effect, inject, untracked } from '@angular/core';
import { UIStore } from '../../store/ui.store';

/**
 * What the game plays once a place is up (the music's change to the build
 * phase, the route animation, the intro flight) waits while the main menu
 * stands in front of it: the place loads behind the menu, the show starts
 * when the player closes it with Play or Continue (docs/MAIN_MENU_UI_PLAN.md,
 * Menü 3). Without the menu it starts at once.
 */
@Injectable({ providedIn: 'root' })
export class StartShowService {
  private readonly ui = inject(UIStore);
  private pending: (() => void)[] = [];

  constructor() {
    effect(() => {
      if (this.ui.mainMenuOpen()) return;
      const shows = this.pending;
      this.pending = [];
      untracked(() => shows.forEach((show) => show()));
    });
  }

  /** Play `show` now, or when the menu closes, in the order they came */
  whenPlayed(show: () => void): void {
    if (this.ui.mainMenuOpen()) this.pending.push(show);
    else show();
  }
}
