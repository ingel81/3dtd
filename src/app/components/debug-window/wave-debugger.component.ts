import { Component, inject, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { WaveDebugService } from '../../services/wave-debug.service';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';
import { EnemyTypeId } from '../../models/enemy-types';

@Component({
  selector: 'app-wave-debugger',
  standalone: true,
  imports: [CommonModule, MatIconModule, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
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

            <div class="select-row">
              <span class="label">Type</span>
              <select class="enemy-select" (change)="onEnemyTypeChange($event)">
                @for (type of waveDebug.enemyTypes(); track type.id) {
                  <option [value]="type.id" [selected]="type.id === waveDebug.enemyType()">
                    {{ type.name }}
                  </option>
                }
              </select>
            </div>

            <div class="slider-row">
              <span class="label">Count</span>
              <input type="range" min="1" max="500" step="1"
                     [value]="waveDebug.enemyCount()"
                     (input)="onEnemyCountChange($event)" />
              <input type="number" class="number-input" min="1" max="500"
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

            <div class="slider-row">
              <span class="label">Health</span>
              <input type="range" min="1" max="10000" step="1"
                     [value]="waveDebug.enemyHealth()"
                     (input)="onHealthChange($event)" />
              <input type="number" class="number-input" min="1" max="10000"
                     [value]="waveDebug.enemyHealth()"
                     (change)="onHealthChange($event)" />
              <span class="unit">HP</span>
            </div>

            <div class="toggle-row">
              <span class="label">Mode</span>
              <button class="toggle-btn" [class.active]="waveDebug.spawnMode() === 'each'" (click)="waveDebug.toggleSpawnMode()">
                <mat-icon>{{ waveDebug.spawnMode() === 'each' ? 'call_split' : 'shuffle' }}</mat-icon>
                {{ waveDebug.spawnMode() === 'each' ? 'Distributed' : 'Random' }}
              </button>
            </div>

            <div class="slider-row">
              <span class="label">Delay</span>
              <input type="range" min="0.01" max="5000" step="0.1"
                     [value]="waveDebug.spawnDelay()"
                     (input)="onSpawnDelayChange($event)" />
              <span class="value">{{ formatDelay(waveDebug.spawnDelay()) }}</span>
            </div>

            <!-- Custom Wave Start Button -->
            <button class="start-wave-btn"
                    [disabled]="waveDebug.waveActive()"
                    (click)="onStartCustomWave()">
              <mat-icon>play_arrow</mat-icon>
              {{ waveDebug.waveActive() ? 'Wave running...' : 'Start Custom Wave' }}
            </button>
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

    .select-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }

    .select-row .label {
      width: 50px;
      flex-shrink: 0;
    }

    .enemy-select {
      flex: 1;
      padding: 6px 8px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-primary);
      font-family: inherit;
      font-size: 10px;
      cursor: pointer;
      ${TD_SCROLLBAR_STYLES}
    }

    .enemy-select::-webkit-scrollbar {
      ${TD_SCROLLBAR_WEBKIT.scrollbar}
    }

    .enemy-select::-webkit-scrollbar-track {
      ${TD_SCROLLBAR_WEBKIT.track}
    }

    .enemy-select::-webkit-scrollbar-thumb {
      ${TD_SCROLLBAR_WEBKIT.thumb}
    }

    .enemy-select::-webkit-scrollbar-thumb:hover {
      ${TD_SCROLLBAR_WEBKIT.thumbHover}
    }

    .enemy-select:focus {
      outline: none;
      border-color: var(--td-teal);
    }

    .enemy-select option {
      background: var(--td-panel-secondary);
      color: var(--td-text-primary);
      padding: 4px;
    }

    .start-wave-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      margin-top: 12px;
      padding: 8px 12px;
      background: var(--td-teal);
      border: 1px solid var(--td-teal);
      border-top-color: #5de8c2;
      border-bottom-color: #1a9a7a;
      color: var(--td-bg-dark);
      font-family: inherit;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .start-wave-btn mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .start-wave-btn:hover:not(:disabled) {
      background: #5de8c2;
    }

    .start-wave-btn:disabled {
      background: var(--td-frame-mid);
      border-color: var(--td-frame-mid);
      color: var(--td-text-muted);
      cursor: not-allowed;
    }
  `,
})
export class WaveDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly waveDebug = inject(WaveDebugService);

  // Event bus input for emitting custom wave events
  readonly eventBus = input<GameEventBus>();

  onStartCustomWave(): void {
    const bus = this.eventBus();
    if (bus) {
      bus.emit({ type: 'debug:start-custom-wave' });
    }
  }

  onEnemyTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value as EnemyTypeId;
    this.waveDebug.setEnemyType(value);
  }

  onEnemyCountChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setEnemyCount(value);
  }

  onSpeedChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setEnemySpeed(value);
  }

  onHealthChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setEnemyHealth(value);
  }

  onSpawnDelayChange(event: Event): void {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.waveDebug.setSpawnDelay(this.roundTo(value, 2));
  }

  formatDelay(ms: number): string {
    if (ms >= 100) return `${this.formatNumber(ms / 1000, 2)}s`;
    if (ms >= 1) return `${this.formatNumber(ms, 1)}ms`;
    return `${this.formatNumber(ms, 2)}ms`;
  }

  private formatNumber(value: number, decimals: number): string {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: decimals }).format(value);
  }

  private roundTo(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }
}
