import { Component, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GameStore } from '../../store/game.store';
import { GAME_SPEEDS } from '../../configs/game-speed.config';
import { TdIconComponent } from '../icon/icon.component';
import { COOP } from '../../services/coop.token';
import { I18n } from '../../i18n/i18n.service';

@Component({
  selector: 'app-game-speed',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="speed-group" role="group" [attr.aria-label]="t().hud.speed.group">
      <button
        class="td-icon-btn pause-btn"
        [attr.aria-disabled]="!mayPause()"
        (click)="togglePause()"
        [matTooltip]="!mayPause() ? t().hud.speed.noPause : paused() ? 'Resume (P)' : 'Pause (P)'"
        [attr.aria-label]="paused() ? t().hud.speed.resume : t().hud.speed.pause"
        [attr.aria-pressed]="paused()"
        aria-keyshortcuts="P"
        matTooltipPosition="below">
        <td-icon [name]="paused() ? 'play' : 'pause'" [size]="16"></td-icon>
      </button>
      <button
        class="td-btn-secondary td-btn-sm speed-btn"
        [class.is-on]="currentSpeed() > 1"
        (click)="cycleSpeed()"
        [attr.aria-disabled]="guest()"
        [matTooltip]="guest() ? t().hud.speed.guest : t().hud.speed.tip(currentSpeed())"
        [attr.aria-label]="t().hud.speed.label(currentSpeed())"
        matTooltipPosition="below">
        <td-icon [name]="currentSpeed() === 1 ? 'play' : 'fastForward'" [size]="16"></td-icon>
        {{ currentSpeed() }}x
      </button>
    </div>
    @if (paused()) {
      <div class="paused-chip td-overlay td-caps" role="status">{{ t().hud.speed.paused }}</div>
    }
  `,
  styles: `
    /* Placed by .td-hud-top in the game component, with the boss bar under it */
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .speed-group {
      display: flex;
      gap: 4px;
    }
    .pause-btn {
      width: var(--td-h-button-sm);
      height: var(--td-h-button-sm);
    }
    .paused-chip {
      padding: 4px 10px;
      color: var(--td-brass-light);
      pointer-events: none;
    }
  `
})
export class GameSpeedComponent {
  protected readonly t = inject(I18n).t;
  private gameStore = inject(GameStore);

  /** Coop: the speed belongs to the host (D15), the pause to whom the room lets (D38) */
  private readonly coop = inject(COOP, { optional: true });
  readonly guest = computed(() => !!this.coop?.inGame() && !this.coop.isHost());
  readonly mayPause = computed(() => !this.coop?.inGame() || this.coop.mayPause());

  readonly currentSpeed = this.gameStore.gameSpeed;
  readonly paused = this.gameStore.paused;

  cycleSpeed(): void {
    if (this.guest()) return;
    const current = this.currentSpeed();
    const idx = GAME_SPEEDS.indexOf(current);
    const next = GAME_SPEEDS[(idx + 1) % GAME_SPEEDS.length];
    this.gameStore.gameSpeed.set(next);
  }

  togglePause(): void {
    if (!this.mayPause()) return;
    this.gameStore.paused.update(p => !p);
  }
}
