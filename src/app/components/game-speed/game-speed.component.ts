import { Component, inject } from '@angular/core';
import { GameStore } from '../../store/game.store';

@Component({
  selector: 'app-game-speed',
  standalone: true,
  template: `
    <button
      class="speed-btn"
      (click)="cycleSpeed()"
      [title]="'Game Speed: ' + currentSpeed() + 'x'">
      ⏩ {{ currentSpeed() }}x
    </button>
  `,
  styles: [`
    .speed-btn {
      background: rgba(0, 0, 0, 0.7);
      border: 1px solid rgba(201, 164, 76, 0.6);
      color: #c9a44c;
      padding: 4px 10px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      transition: all 0.15s ease;
    }
    .speed-btn:hover {
      background: rgba(201, 164, 76, 0.2);
      border-color: #c9a44c;
    }
  `]
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
