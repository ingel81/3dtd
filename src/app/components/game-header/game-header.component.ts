import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-game-header',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  template: `
    <header class="header">
      <div class="header-left">
        <mat-icon class="title-icon">cell_tower</mat-icon>
        <h2 class="title">3DTD</h2>
        <button class="location-btn" (click)="locationClick.emit()" matTooltip="Spielort ändern">
          <span class="location-name">{{ locationName() }}</span>
          <mat-icon class="location-edit">edit</mat-icon>
        </button>
        <button class="share-btn" (click)="shareClick.emit()" matTooltip="Link kopieren">
          <mat-icon>link</mat-icon>
        </button>
      </div>
      <div class="header-stats">
        <div class="stat hp">
          <mat-icon>favorite</mat-icon>
          <span>{{ baseHealth() }}</span>
        </div>
        <div class="stat credits">
          <mat-icon>paid</mat-icon>
          <span>{{ credits() }}</span>
        </div>
        <div class="stat wave">
          <mat-icon>waves</mat-icon>
          <span>{{ waveNumber() }}</span>
        </div>
        @if (waveActive()) {
          <div class="stat enemies">
            <mat-icon>pest_control</mat-icon>
            <span>{{ enemiesAlive() }}</span>
          </div>
        }
      </div>
      @if (isDialog()) {
        <button class="close-btn" (click)="closeClick.emit()" matTooltip="Schliessen">
          <mat-icon>close</mat-icon>
        </button>
      }
    </header>
  `,
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 12px;
      background:
        linear-gradient(rgba(15, 19, 15, 0.8), rgba(15, 19, 15, 0.8)),
        url('/assets/images/425.jpg') repeat;
      background-size: auto, 64px 64px;
      border-bottom: 3px solid var(--td-panel-shadow);
      border-top: 1px solid var(--td-frame-light);
      box-shadow:
        0 4px 8px rgba(0, 0, 0, 0.5),
        0 2px 4px rgba(0, 0, 0, 0.3),
        inset 0 -2px 4px rgba(0, 0, 0, 0.3);
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      background: var(--td-panel-shadow);
      padding: 4px 10px;
      border: 1px solid var(--td-frame-dark);
      border-top-color: var(--td-frame-mid);
    }

    .title-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--td-gold);
    }

    .title {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--td-gold);
      text-transform: uppercase;
    }

    .location-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      margin-left: 8px;
      background: transparent;
      border: 1px solid transparent;
      border-left: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
      border-radius: 0 3px 3px 0;
      font-family: inherit;
      font-size: 10px;
    }

    .location-btn:hover {
      border-color: var(--td-gold-dark);
      background: rgba(255, 215, 0, 0.1);
      color: var(--td-gold);
    }

    .location-name {
      font-weight: 500;
    }

    .location-edit {
      font-size: 12px;
      width: 12px;
      height: 12px;
      opacity: 0.5;
    }

    .location-btn:hover .location-edit {
      opacity: 1;
    }

    .share-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      margin-left: 4px;
      background: transparent;
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-muted);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .share-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .share-btn:hover {
      border-color: var(--td-teal);
      background: rgba(74, 158, 147, 0.15);
      color: var(--td-teal);
    }

    .header-stats {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-left: auto;
      margin-right: 8px;
    }

    .stat {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      font-size: 11px;
      font-weight: 600;
      background: var(--td-panel-shadow);
      padding: 4px 10px;
      min-width: 50px;
      border: 1px solid var(--td-frame-dark);
      border-top-color: var(--td-frame-mid);
    }

    .stat mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .stat.hp { color: var(--td-health-red); }
    .stat.credits { color: var(--td-gold); }
    .stat.wave { color: var(--td-teal); }
    .stat.enemies { color: var(--td-warn-orange); }

    .close-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s;
    }

    .close-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .close-btn:hover {
      background: var(--td-health-red);
      color: var(--td-text-primary);
    }
  `,
})
export class GameHeaderComponent {
  // Inputs
  readonly locationName = input.required<string>();
  readonly baseHealth = input.required<number>();
  readonly credits = input.required<number>();
  readonly waveNumber = input.required<number>();
  readonly enemiesAlive = input.required<number>();
  readonly waveActive = input.required<boolean>();
  readonly isDialog = input<boolean>(false);

  // Outputs
  readonly locationClick = output<void>();
  readonly shareClick = output<void>();
  readonly closeClick = output<void>();
}
