import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, inject, signal } from '@angular/core';
import { GameStateManager } from '../../managers/game-state.manager';
import type { Enemy } from '../../entities/enemy.entity';
import { BossBarView, bossBarView, sameBossBar } from './boss-bar';

/** Poll interval for the boss HP; 8 Hz reads as live */
const POLL_MS = 125;

/**
 * Boss health at the top centre while a boss lives (EnemyTypeConfig.isBoss),
 * labelled with the type's name. Several bosses: the one with
 * most HP left on the big bar, the others as thin bars below it.
 *
 * Bosses come in through enemy:spawned into a short list; an 8 Hz timer
 * outside Angular reads their HP and drops the ones that died, leaked or
 * were removed (a reset or the debug window send no enemy:died). No scan
 * over all enemies, and the signal only changes when the bar does, so a
 * paused game costs one comparison per tick.
 */
@Component({
  selector: 'app-boss-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './boss-bar.component.html',
  styleUrl: './boss-bar.component.scss',
})
export class BossBarComponent {
  private readonly gameState = inject(GameStateManager);

  readonly view = signal<BossBarView | null>(null);

  /** Bosses since their spawn, until the poll finds them gone */
  private readonly bosses: Enemy[] = [];

  constructor() {
    const sub = this.gameState.getEventBus().on('enemy:spawned', (event) => {
      if (event.enemy.typeConfig.isBoss) this.bosses.push(event.enemy);
    });
    const timer = inject(NgZone).runOutsideAngular(() => setInterval(() => this.poll(), POLL_MS));
    inject(DestroyRef).onDestroy(() => {
      sub.dispose();
      clearInterval(timer);
    });
  }

  private poll(): void {
    let alive = 0;
    for (const boss of this.bosses) {
      if (boss.active && boss.alive) this.bosses[alive++] = boss;
    }
    this.bosses.length = alive;

    const next = alive === 0
      ? null
      : bossBarView(this.bosses.map((boss) => ({
          name: boss.typeConfig.name,
          hp: boss.health.hp,
          maxHp: boss.health.maxHp,
        })));
    if (!sameBossBar(this.view(), next)) this.view.set(next);
  }
}
