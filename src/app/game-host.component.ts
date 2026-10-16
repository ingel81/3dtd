import { ChangeDetectionStrategy, Component, Injector, afterNextRender, effect, inject, signal, untracked } from '@angular/core';
import { TowerDefenseComponent } from './tower-defense.component';
import { WorldsStageComponent } from './worlds/worlds-stage.component';
import { WorldSession } from './world/world-session.service';

/**
 * The game screen: the globes while no world is open, else one game per
 * world the page opens (WorldSession). A new world takes the game down,
 * with its engine, worker and canvas, and makes a new one; closing it goes
 * back to the globes. The page does not reload.
 */
@Component({
  selector: 'app-game-host',
  standalone: true,
  imports: [TowerDefenseComponent, WorldsStageComponent],
  template: `@if (shown() !== null) {
    <app-tower-defense />
  } @else if (!session.isOpen()) {
    <app-worlds-stage />
  }`,
  styles: [`:host { display: contents; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameHostComponent {
  protected readonly session = inject(WorldSession);
  /**
   * The world whose game stands; null on the globes, and for one render
   * between two worlds: Angular would make a new game before it takes the
   * old one down, and the old one's teardown (its sim worker, the root's run
   * state) must come first.
   */
  protected readonly shown = signal<number | null>(this.session.isOpen() ? this.session.world() : null);

  constructor() {
    const injector = inject(Injector);
    effect(() => {
      const world = this.session.world();
      const open = this.session.isOpen();
      if (untracked(this.shown) === (open ? world : null)) return;
      this.shown.set(null);
      if (!open) return;
      // A world opened again meanwhile is the one to show
      afterNextRender(() => {
        if (this.session.isOpen() && this.session.world() === world) this.shown.set(world);
      }, { injector });
    });
  }
}
