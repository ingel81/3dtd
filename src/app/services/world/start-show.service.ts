import { Injectable, Injector, afterNextRender, effect, inject, untracked } from '@angular/core';
import { UIStore } from '../../store/ui.store';

/**
 * What the game plays once a place is up (the music's change to the build
 * phase, the route animation, the intro flight) waits while the main menu
 * stands in front of it: the place loads behind the menu, the show starts
 * when the player closes it with Play or Continue (docs/MAIN_MENU_UI_PLAN.md,
 * Menü 3). Without the menu it starts at once.
 *
 * The start menu shows the scene the whole width, without header and
 * sidebar; they come back as it closes. So a waiting show runs after that
 * render, the stage first (`setStage`: the canvas at its new size, the
 * overview framed for it), then the shows: the intro lands in a frame made
 * for the width the game is played at.
 */
export type StartShowKind =
  /** The opening music gives way to the build phase's (the first load) */
  | 'music'
  /** Route animation and intro flight of the place standing; a newer place's replaces an older one's */
  | 'place';

@Injectable({ providedIn: 'root' })
export class StartShowService {
  private readonly ui = inject(UIStore);
  private readonly injector = inject(Injector);
  /** One show of each kind, in the order the kinds first came */
  private pending = new Map<StartShowKind, () => void>();
  private stage: (() => void) | null = null;

  constructor() {
    effect(() => {
      if (this.ui.mainMenuOpen() || this.pending.size === 0) return;
      untracked(() => afterNextRender(() => this.playPending(), { injector: this.injector }));
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

  /** What sets the stage before waiting shows play (VisualizationFacadeService); null to drop it */
  setStage(stage: (() => void) | null): void {
    this.stage = stage;
  }

  private playPending(): void {
    // Opened again before the render came
    if (this.ui.mainMenuOpen()) return;
    const shows = [...this.pending.values()];
    this.pending = new Map();
    if (shows.length === 0) return;
    this.stage?.();
    shows.forEach((show) => show());
  }
}
