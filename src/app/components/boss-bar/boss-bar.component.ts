import { ChangeDetectionStrategy, Component, DestroyRef, NgZone, inject, signal } from '@angular/core';
import { GameStateManager } from '../../managers/game-state.manager';
import type { Enemy } from '../../entities/enemy.entity';
import type { WormGroup } from '../../managers/worm/worm-group';
import { BossBarView, BossSample, bossBarView, sameBossBar, wormBossSample } from './boss-bar';

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
 *
 * A worm is one boss however many segments and parts it has: it comes in
 * through worm:spawned, its bar sums every part (WormGroup.hp) and it stays
 * until nothing of it is left.
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
  /** Worms since their spawn, until nothing of them is left */
  private readonly worms: WormGroup[] = [];

  constructor() {
    const bus = this.gameState.getEventBus();
    const subs = [
      bus.onLive('enemy:spawned', (event) => {
        // A worm's segments are bosses too; the worm has one bar for all of them
        if (event.enemy.typeConfig.isBoss && event.enemy.worm === null) this.bosses.push(event.enemy);
      }),
      bus.onLive('worm:spawned', (event) => this.worms.push(event.group)),
    ];
    const timer = inject(NgZone).runOutsideAngular(() => setInterval(() => this.poll(), POLL_MS));
    inject(DestroyRef).onDestroy(() => {
      for (const sub of subs) sub.dispose();
      clearInterval(timer);
    });
  }

  private poll(): void {
    let alive = 0;
    for (const boss of this.bosses) {
      if (boss.active && boss.alive) this.bosses[alive++] = boss;
    }
    this.bosses.length = alive;
    let worms = 0;
    for (const worm of this.worms) {
      if (worm.remaining > 0) this.worms[worms++] = worm;
    }
    this.worms.length = worms;

    const samples: BossSample[] = this.bosses.map((boss) => ({
      name: boss.typeConfig.name,
      hp: boss.health.hp,
      maxHp: boss.health.maxHp,
    }));
    for (const worm of this.worms) {
      samples.push(wormBossSample(worm.type.name, worm.chains.length, worm.hp(), worm.maxHp));
    }
    const next = samples.length === 0 ? null : bossBarView(samples);
    if (!sameBossBar(this.view(), next)) this.view.set(next);
  }
}
