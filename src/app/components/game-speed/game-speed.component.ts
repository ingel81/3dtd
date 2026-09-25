import { Component, computed, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GameStore } from '../../store/game.store';
import { GAME_SPEEDS } from '../../configs/game-speed.config';
import { TD_CSS_VARS } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';
import { COOP } from '../../services/coop.token';

@Component({
  selector: 'app-game-speed',
  standalone: true,
  imports: [MatTooltipModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="speed-group" role="group" aria-label="Game speed">
      <button
        class="hud-btn pause-btn"
        [class.paused]="paused()"
        [class.is-locked]="!mayPause()"
        [attr.aria-disabled]="!mayPause()"
        (click)="togglePause()"
        [matTooltip]="!mayPause() ? PAUSE_TIP : paused() ? 'Resume (P)' : 'Pause (P)'"
        [attr.aria-label]="paused() ? 'Resume game' : 'Pause game'"
        [attr.aria-pressed]="paused()"
        aria-keyshortcuts="P"
        matTooltipPosition="below">
        <td-icon [name]="paused() ? 'play' : 'pause'" [size]="16"></td-icon>
      </button>
      <button
        class="hud-btn speed-btn"
        [class.fast]="currentSpeed() > 1"
        (click)="cycleSpeed()"
        [class.is-locked]="guest()"
        [attr.aria-disabled]="guest()"
        [matTooltip]="guest() ? GUEST_TIP : 'Game Speed: ' + currentSpeed() + 'x (+/-)'"
        [attr.aria-label]="'Game speed ' + currentSpeed() + 'x'"
        matTooltipPosition="below">
        <td-icon [name]="currentSpeed() === 1 ? 'play' : 'fastForward'" [size]="18"></td-icon>
        {{ currentSpeed() }}x
      </button>
    </div>
    @if (paused()) {
      <div class="paused-chip" role="status">Paused</div>
    }
  `,
  styles: `
    /* Placed by .td-hud-top in the game component, with the boss bar under it */
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      ${TD_CSS_VARS}
    }
    .speed-group {
      display: flex;
      gap: 2px;
    }
    .hud-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      background: var(--td-panel-main);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      padding: 4px 10px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      transition: all 0.15s;
    }
    .hud-btn.is-locked {
      cursor: default;
      opacity: 0.6;
    }
    .hud-btn:hover:not(.is-locked) {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }
    .pause-btn {
      padding: 4px 7px;
    }
    /* Paused: the button now resumes, held in like a pressed key */
    .pause-btn.paused {
      background: var(--td-panel-shadow);
      border-color: var(--td-gold-dark);
      color: var(--td-gold-light);
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
    }
    .speed-btn.fast {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }
    .paused-chip {
      padding: 3px 10px;
      font: 700 10px/1 var(--td-font-mono);
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--td-gold-light);
      background: var(--td-glass-tint);
      backdrop-filter: blur(8px) saturate(1.1);
      border: 1px solid var(--td-frame-dark);
      box-shadow: inset 0 1px 0 rgba(122, 133, 128, 0.33), var(--td-shadow-soft);
      pointer-events: none;
    }
  `
})
export class GameSpeedComponent {
  private gameStore = inject(GameStore);

  /** Coop: the speed belongs to the host (D15), the pause to whom the room lets (D38) */
  private readonly coop = inject(COOP, { optional: true });
  readonly guest = computed(() => !!this.coop?.inGame() && !this.coop.isHost());
  readonly mayPause = computed(() => !this.coop?.inGame() || this.coop.mayPause());
  readonly GUEST_TIP = 'The host sets the speed';
  readonly PAUSE_TIP = 'The room does not let you pause';

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
