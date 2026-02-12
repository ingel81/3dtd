import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GameStore } from '../../store/game.store';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-game-speed',
  standalone: true,
  imports: [MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      class="speed-btn"
      [class.fast]="currentSpeed() > 1"
      (click)="cycleSpeed()"
      [matTooltip]="'Game Speed: ' + currentSpeed() + 'x'"
      matTooltipPosition="below">
      <mat-icon>{{ currentSpeed() === 1 ? 'play_arrow' : 'fast_forward' }}</mat-icon>
      {{ currentSpeed() }}x
    </button>
  `,
  styles: `
    :host {
      position: absolute;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 20;
      ${TD_CSS_VARS}
    }
    .speed-btn {
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
    .speed-btn mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .speed-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }
    .speed-btn.fast {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }
  `
})
export class GameSpeedComponent {
  private gameStore = inject(GameStore);

  readonly currentSpeed = this.gameStore.trainingTimescale;

  private speeds = [1, 2, 4];

  cycleSpeed(): void {
    const current = this.currentSpeed();
    const idx = this.speeds.indexOf(current);
    const next = this.speeds[(idx + 1) % this.speeds.length];
    this.gameStore.trainingTimescale.set(next);
  }
}
