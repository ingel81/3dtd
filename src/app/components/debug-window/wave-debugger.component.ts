import { Component, inject, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { WaveDebugService } from '../../services/wave-debug.service';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-wave-debugger',
  standalone: true,
  imports: [CommonModule, MatIconModule, DraggableDebugPanelComponent],
  template: `
    @if (windowService.waveWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="wave"
        title="Wave Debug"
        icon="pest_control"
        [position]="windowService.waveWindow().position"
        [zIndex]="windowService.waveWindow().zIndex"
        (closed)="windowService.close('wave')"
        (positionChange)="windowService.updatePosition('wave', $event)"
        (focused)="windowService.bringToFront('wave')"
      >
        <div class="wave-debug-content">
          <!-- Spawn Settings -->
          <div class="section">
            <div class="section-title">Spawn</div>

            <div class="toggle-row">
              <span class="label">Typ</span>
              <div class="type-buttons">
                @for (type of waveDebug.enemyTypes(); track type.id) {
                  <button
                    class="type-btn"
                    [class.active]="waveDebug.enemyType() === type.id"
                    (click)="waveDebug.setEnemyType(type.id)"
                    [title]="type.name"
                  >
                    {{ type.name }}
                  </button>
                }
              </div>
            </div>

            <div class="slider-row">
              <span class="label">Anzahl</span>
              <input type="range" min="1" max="5000" step="1"
                     [value]="waveDebug.enemyCount()"
                     (input)="onEnemyCountChange($event)" />
              <input type="number" class="number-input" min="1" max="5000"
                     [value]="waveDebug.enemyCount()"
                     (change)="onEnemyCountChange($event)" />
            </div>

            <div class="slider-row">
              <span class="label">Speed</span>
              <input type="range" min="1" max="100" step="1"
                     [value]="waveDebug.enemySpeed()"
                     (input)="onSpeedChange($event)" />
              <input type="number" class="number-input" min="1" max="100"
                     [value]="waveDebug.enemySpeed()"
                     (change)="onSpeedChange($event)" />
              <span class="unit">m/s</span>
            </div>

            <div class="toggle-row">
              <span class="label">Modus</span>
              <button class="toggle-btn" [class.active]="waveDebug.spawnMode() === 'each'" (click)="waveDebug.toggleSpawnMode()">
                <mat-icon>{{ waveDebug.spawnMode() === 'each' ? 'call_split' : 'shuffle' }}</mat-icon>
                {{ waveDebug.spawnMode() === 'each' ? 'Verteilt' : 'Zufaellig' }}
              </button>
            </div>

            <div class="slider-row">
              <span class="label">Delay</span>
              <input type="range" min="100" max="5000" step="100"
                     [value]="waveDebug.spawnDelay()"
                     (input)="onSpawnDelayChange($event)" />
              <span class="value">{{ waveDebug.spawnDelay() / 1000 }}s</span>
            </div>

            <div class="toggle-row">
              <span class="label">Sammeln</span>
              <button class="toggle-btn" [class.active]="waveDebug.useGathering()" (click)="waveDebug.toggleGathering()">
                <mat-icon>{{ waveDebug.useGathering() ? 'groups' : 'directions_run' }}</mat-icon>
                {{ waveDebug.useGathering() ? 'Alle zusammen' : 'Sofort los' }}
              </button>
            </div>
          </div>

          <!-- Actions -->
          <div class="section">
            <div class="section-title">Aktionen</div>
            <div class="btn-row">
              <button class="icon-btn heal" [disabled]="waveDebug.baseHealth() >= 100" (click)="healHq.emit()" title="HQ heilen">
                <mat-icon>healing</mat-icon>
              </button>
              <button class="icon-btn danger" [disabled]="!waveDebug.waveActive()" (click)="killAll.emit()" title="Alle toeten">
                <mat-icon>delete_forever</mat-icon>
              </button>
              <button class="icon-btn credits" (click)="addCredits.emit()" title="+1000 Credits">
                <mat-icon>attach_money</mat-icon>
              </button>
              <button class="icon-btn health" (click)="addHealth.emit()" title="+1000 HP">
                <mat-icon>favorite</mat-icon>
              </button>
            </div>
          </div>
        </div>
      </app-draggable-debug-panel>
    }
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .wave-debug-content {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      min-width: 340px;
    }

    .section {
      padding: 8px 0;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .section:first-child {
      padding-top: 0;
    }

    .section:last-child {
      border-bottom: none;
      padding-bottom: 0;
    }

    .section-title {
      font-size: 9px;
      font-weight: 600;
      color: var(--td-gold);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .label {
      color: var(--td-text-muted);
    }

    .value {
      color: var(--td-teal);
      font-weight: 600;
      min-width: 36px;
      text-align: right;
    }

    .slider-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 10px;
    }

    .slider-row:last-of-type {
      margin-bottom: 0;
    }

    .slider-row .label {
      width: 50px;
      flex-shrink: 0;
    }

    .slider-row input[type="range"] {
      flex: 1;
      height: 4px;
      accent-color: var(--td-teal);
      cursor: pointer;
    }

    .slider-row .number-input {
      width: 50px;
      padding: 2px 4px;
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-teal);
      font-family: inherit;
      font-size: 10px;
      font-weight: 600;
      text-align: right;
      -moz-appearance: textfield;
    }

    .slider-row .number-input::-webkit-outer-spin-button,
    .slider-row .number-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .slider-row .number-input:focus {
      outline: none;
      border-color: var(--td-teal);
    }

    .slider-row .unit {
      color: var(--td-text-muted);
      font-size: 9px;
      min-width: 20px;
    }

    .toggle-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }

    .toggle-row:last-of-type {
      margin-bottom: 0;
    }

    .toggle-row .label {
      width: 50px;
      flex-shrink: 0;
    }

    .toggle-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 9px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .toggle-btn mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    .toggle-btn:hover {
      background: var(--td-frame-mid);
    }

    .toggle-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
    }

    .type-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      flex: 1;
    }

    .type-btn {
      flex: 1 1 auto;
      min-width: 60px;
      padding: 4px 6px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 9px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .type-btn:hover {
      background: var(--td-frame-mid);
    }

    .type-btn.active {
      background: var(--td-gold-dark);
      border-color: var(--td-gold);
      color: var(--td-text-primary);
    }

    .btn-row {
      display: flex;
      gap: 4px;
    }

    .icon-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      border-top-color: var(--td-frame-light);
      border-bottom-color: var(--td-frame-dark);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .icon-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .icon-btn:hover:not(:disabled) {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .icon-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .icon-btn.danger {
      border-color: var(--td-health-red);
      color: var(--td-health-red);
    }

    .icon-btn.danger:hover:not(:disabled) {
      background: var(--td-health-red);
      color: var(--td-text-primary);
    }

    .icon-btn.heal {
      border-color: var(--td-green);
      color: var(--td-green);
    }

    .icon-btn.heal:hover:not(:disabled) {
      background: var(--td-green);
      color: var(--td-bg-dark);
    }

    .icon-btn.credits {
      border-color: var(--td-gold);
      color: var(--td-gold);
    }

    .icon-btn.credits:hover:not(:disabled) {
      background: var(--td-gold);
      color: var(--td-bg-dark);
    }

    .icon-btn.health {
      border-color: var(--td-health-red);
      color: var(--td-health-red);
    }

    .icon-btn.health:hover:not(:disabled) {
      background: var(--td-health-red);
      color: var(--td-text-primary);
    }
  `,
})
export class WaveDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly waveDebug = inject(WaveDebugService);

  // Actions that need to be handled by the parent
  readonly killAll = output<void>();
  readonly healHq = output<void>();
  readonly addCredits = output<void>();
  readonly addHealth = output<void>();

  onEnemyCountChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setEnemyCount(value);
  }

  onSpeedChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setEnemySpeed(value);
  }

  onSpawnDelayChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setSpawnDelay(value);
  }
}
