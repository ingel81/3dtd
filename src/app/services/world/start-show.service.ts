import { Injectable, effect, inject, untracked } from '@angular/core';
import { UIStore } from '../../store/ui.store';

/**
 * What the game plays once a place is up (the music's change to the build
 * phase, the route animation, the intro flight) waits while the main menu
 * stands in front of it: the place loads behind the menu, the show starts
 * when the player closes it with Play or Continue (docs/MAIN_MENU_UI_PLAN.md,
 * Menü 3). Without the menu it starts at once.
 */
export type StartShowKind =
  /** The opening music gives way to the build phase's (the first load) */
  | 'music'
  /** Route animation and intro flight of the place standing; a newer place's replaces an older one's */
  | 'place';

@Injectable({ providedIn: 'root' })
export class StartShowService {
  private readonly ui = inject(UIStore);
  /** One show of each kind, in the order the kinds first came */
  private pending = new Map<StartShowKind, () => void>();

  constructor() {
    effect(() => {
      if (this.ui.mainMenuOpen()) return;
      const shows = [...this.pending.values()];
      this.pending = new Map();
      untracked(() => shows.forEach((show) => show()));
    });
  }

  /**
   * Play `show` now, or when the menu closes. A show of the same kind still
   * waiting is replaced: two places loaded behind the menu fly once, over
   * the one that stands.
   */
  whenPlayed(kind: StartShowKind, show: () => void): void {
    if (this.ui.mainMenuOpen()) this.pending.set(kind, show);
    else show();
  }
}
