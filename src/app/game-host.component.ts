import { ChangeDetectionStrategy, Component, Injector, afterNextRender, effect, inject, signal, untracked } from '@angular/core';
import { TowerDefenseComponent } from './tower-defense.component';
import { WorldSession } from './world/world-session.service';

/**
 * The game: one game per world the page opens (WorldSession). A new
 * world takes the game down, with its engine, worker and canvas, and makes
 * a new one; the page does not reload.
 */
@Component({
  selector: 'app-game-host',
  standalone: true,
  imports: [TowerDefenseComponent],
  template: `@if (shown() !== null) {
    <app-tower-defense />
  }`,
  styles: [`:host { display: contents; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameHostComponent {
  private readonly session = inject(WorldSession);
  /**
   * The world whose game stands; null for one render between two worlds:
   * Angular would make a new game before it takes the old one down, and the
   * old one's teardown (its sim worker, the root's run state) must come first.
   */
  protected readonly shown = signal<number | null>(this.session.world());

  constructor() {
    const injector = inject(Injector);
    effect(() => {
      const world = this.session.world();
      if (untracked(this.shown) === world) return;
      this.shown.set(null);
      // A world opened again meanwhile is the one to show
      afterNextRender(() => {
        if (this.session.world() === world) this.shown.set(world);
      }, { injector });
    });
  }
}
