import { Component, inject, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { WaveDebugService } from '../../services/wave-debug.service';
import { GameEventBus } from '../../game-engine/game-event-bus';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';
import { EnemyTypeId } from '../../models/enemy-types';
import { SpawnPattern } from '../../ai/core/spawn-schedule-builder';
import { TdIconComponent } from '../icon/icon.component';

const PATTERN_LABELS: Record<SpawnPattern, string> = {
  'interleaved': 'Interleaved',
  'sequential': 'Sequential',
  'clustered': 'Clustered',
  'random': 'Random',
  'front-loaded': 'Front-loaded',
  'back-loaded': 'Back-loaded',
  'wave-in-wave': 'Wave-in-Wave',
};

const PATTERN_ICONS: Record<SpawnPattern, string> = {
  'interleaved': 'shuffle',
  'sequential': 'sliders',
  'clustered': 'grid',
  'random': 'random',
  'front-loaded': 'arrowUp',
  'back-loaded': 'caret',
  'wave-in-wave': 'wave',
};

@Component({
  selector: 'app-wave-debugger',
  standalone: true,
  imports: [CommonModule, DraggableDebugPanelComponent, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowService.waveWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="wave"
        title="Wave Debug"
        icon="bug"
        [position]="windowService.waveWindow().position"
        [zIndex]="windowService.waveWindow().zIndex"
        (closed)="windowService.close('wave')"
        (positionChange)="windowService.updatePosition('wave', $event)"
        (focused)="windowService.bringToFront('wave')"
      >
        <div class="wave-debug-content">
          <!-- Mode Toggle -->
          <div class="mode-toggle">
            <button class="mode-btn" [class.active]="!waveDebug.mixedMode()" (click)="waveDebug.mixedMode() && waveDebug.toggleMixedMode()">
              Single
            </button>
            <button class="mode-btn" [class.active]="waveDebug.mixedMode()" (click)="!waveDebug.mixedMode() && waveDebug.toggleMixedMode()">
              Mixed
            </button>
          </div>

          @if (!waveDebug.mixedMode()) {
            <!-- Single Type Mode (existing UI) -->
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
                <input type="range" min="1" max="20000" step="1"
                       [value]="waveDebug.enemyCount()"
                       (input)="onEnemyCountChange($event)" />
                <input type="number" class="number-input" min="1" max="20000"
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
                  <td-icon [name]="waveDebug.spawnMode() === 'each' ? 'share' : 'shuffle'" [size]="14"></td-icon>
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

              <button class="start-wave-btn"
                      [disabled]="waveDebug.waveActive()"
                      (click)="onStartCustomWave()">
                <td-icon name="play" [size]="14"></td-icon>
                {{ waveDebug.waveActive() ? 'Wave running...' : 'Start Custom Wave' }}
              </button>
            </div>
          } @else {
            <!-- Mixed Wave Designer -->
            <div class="section">
              <div class="section-title">Groups</div>

              @for (group of waveDebug.mixedGroups(); track group.id) {
                <div class="group-card">
                  <div class="group-header">
                    <span class="group-label">Group {{ $index + 1 }}</span>
                    <button class="remove-btn" (click)="waveDebug.removeGroup(group.id)"
                            [disabled]="waveDebug.mixedGroups().length <= 1">
                      <td-icon name="cross" [size]="14"></td-icon>
                    </button>
                  </div>

                  <div class="group-row">
                    <select class="enemy-select compact" (change)="onGroupTypeChange(group.id, $event)">
                      @for (type of waveDebug.enemyTypes(); track type.id) {
                        <option [value]="type.id" [selected]="type.id === group.enemyType">
                          {{ type.name }}
                        </option>
                      }
                    </select>
                    <input type="number" class="number-input count-input" min="1" max="500"
                           [value]="group.count"
                           (change)="onGroupCountChange(group.id, $event)" />
                  </div>

                  <div class="group-row multipliers">
                    <span class="mult-label">HP</span>
                    <input type="number" class="number-input mult-input" min="0.1" max="10" step="0.1"
                           [value]="group.healthMultiplier"
                           (change)="onGroupHealthMultChange(group.id, $event)" />
                    <span class="mult-label">Spd</span>
                    <input type="number" class="number-input mult-input" min="0.1" max="5" step="0.1"
                           [value]="group.speedMultiplier"
                           (change)="onGroupSpeedMultChange(group.id, $event)" />
                    <span class="mult-label">Delay</span>
                    <input type="number" class="number-input delay-input" min="1" max="5000" step="1"
                           [value]="group.spawnDelay ?? ''"
                           [placeholder]="'global'"
                           (change)="onGroupDelayChange(group.id, $event)" />
                  </div>
                </div>
              }

              <button class="add-group-btn" (click)="waveDebug.addGroup()">
                <td-icon name="plus" [size]="14"></td-icon> Add Group
              </button>
            </div>

            <!-- Pattern Section -->
            <div class="section">
              <div class="section-title">Pattern</div>

              <div class="pattern-grid">
                @for (pattern of waveDebug.allPatterns; track pattern) {
                  <button class="pattern-btn" [class.active]="waveDebug.spawnPattern() === pattern"
                          (click)="waveDebug.setSpawnPattern(pattern)"
                          [title]="patternLabels[pattern]">
                    <td-icon [name]="$any(patternIcons[pattern])" [size]="14"></td-icon>
                    <span>{{ patternLabels[pattern] }}</span>
                  </button>
                }
              </div>

              @if (waveDebug.spawnPattern() === 'clustered') {
                <div class="slider-row">
                  <span class="label">Cluster</span>
                  <input type="range" min="1" max="20" step="1"
                         [value]="waveDebug.clusterSize()"
                         (input)="onClusterSizeChange($event)" />
                  <input type="number" class="number-input" min="1" max="20"
                         [value]="waveDebug.clusterSize()"
                         (change)="onClusterSizeChange($event)" />
                </div>
              }

              @if (waveDebug.spawnPattern() === 'wave-in-wave') {
                <div class="slider-row">
                  <span class="label">Pause</span>
                  <input type="range" min="500" max="10000" step="100"
                         [value]="waveDebug.subWavePause()"
                         (input)="onSubWavePauseChange($event)" />
                  <span class="value">{{ formatDelay(waveDebug.subWavePause()) }}</span>
                </div>
              }
            </div>

            <!-- Spawn Settings Section -->
            <div class="section">
              <div class="section-title">Spawn</div>

              <div class="slider-row">
                <span class="label">Delay</span>
                <input type="range" min="0.01" max="5000" step="0.1"
                       [value]="waveDebug.spawnDelay()"
                       (input)="onSpawnDelayChange($event)" />
                <span class="value">{{ formatDelay(waveDebug.spawnDelay()) }}</span>
              </div>

              <div class="slider-row">
                <span class="label">Variation</span>
                <input type="range" min="0" max="0.5" step="0.05"
                       [value]="waveDebug.delayVariation()"
                       (input)="onDelayVariationChange($event)" />
                <span class="value">{{ formatPercent(waveDebug.delayVariation()) }}</span>
              </div>

              <div class="total-row">
                <span class="label">Total</span>
                <span class="total-count">{{ waveDebug.mixedTotalCount() }} enemies</span>
              </div>

              <button class="start-wave-btn mixed"
                      [disabled]="waveDebug.waveActive()"
                      (click)="onStartCustomWave()">
                <td-icon name="play" [size]="14"></td-icon>
                {{ waveDebug.waveActive() ? 'Wave running...' : 'Start Mixed Wave' }}
              </button>
            </div>
          }
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

    /* Mode Toggle */
    .mode-toggle {
      display: flex;
      gap: 0;
      margin-bottom: 8px;
    }

    .mode-btn {
      flex: 1;
      padding: 5px 8px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .mode-btn:first-child {
      border-right: none;
    }

    .mode-btn.active {
      background: var(--td-teal);
      color: var(--td-bg-dark);
      border-color: var(--td-teal);
    }

    .mode-btn:hover:not(.active) {
      background: var(--td-frame-mid);
    }

    /* Sections */
    .section {
      padding: 8px 0;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .section:first-of-type {
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

    /* Slider Rows */
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

    /* Toggle Row */
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

    /* Select Row */
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
      border-radius: 2px;
      color: var(--td-text-primary);
      font-family: inherit;
      font-size: 10px;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23c9a44c' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 8px center;
      padding-right: 28px;
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

    .enemy-select.compact {
      padding: 4px 6px;
      font-size: 9px;
      padding-right: 24px;
    }

    /* Start Wave Button */
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
      border-top-color: var(--td-teal-light);
      border-bottom-color: var(--td-teal-dark);
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
      background: var(--td-teal-light);
    }

    .start-wave-btn:disabled {
      background: var(--td-frame-mid);
      border-color: var(--td-frame-mid);
      color: var(--td-text-muted);
      cursor: not-allowed;
    }

    .start-wave-btn.mixed {
      background: var(--td-gold);
      border-color: var(--td-gold);
      border-top-color: var(--td-gold-light);
      border-bottom-color: var(--td-gold-dark);
    }

    .start-wave-btn.mixed:hover:not(:disabled) {
      background: var(--td-gold-light);
    }

    /* Group Cards */
    .group-card {
      background: var(--td-panel-shadow);
      border: 1px solid var(--td-frame-mid);
      padding: 6px 8px;
      margin-bottom: 6px;
    }

    .group-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .group-label {
      font-size: 9px;
      font-weight: 600;
      color: var(--td-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .remove-btn {
      background: none;
      border: none;
      color: var(--td-text-muted);
      cursor: pointer;
      padding: 0;
      display: flex;
      align-items: center;
    }

    .remove-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .remove-btn:hover:not(:disabled) {
      color: var(--td-health-red);
    }

    .remove-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    .group-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    .group-row:last-child {
      margin-bottom: 0;
    }

    .count-input {
      width: 45px;
      padding: 3px 4px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-teal);
      font-family: inherit;
      font-size: 10px;
      font-weight: 600;
      text-align: right;
      -moz-appearance: textfield;
    }

    .count-input::-webkit-outer-spin-button,
    .count-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .count-input:focus {
      outline: none;
      border-color: var(--td-teal);
    }

    .multipliers {
      gap: 4px;
    }

    .mult-label {
      color: var(--td-text-muted);
      font-size: 8px;
      min-width: 20px;
    }

    .delay-input {
      width: 48px;
      padding: 2px 3px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 9px;
      text-align: right;
      -moz-appearance: textfield;
    }

    .delay-input::placeholder {
      color: var(--td-text-muted);
      font-style: italic;
      font-size: 8px;
    }

    .delay-input::-webkit-outer-spin-button,
    .delay-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .delay-input:focus {
      outline: none;
      border-color: var(--td-teal);
    }

    .mult-input {
      width: 38px;
      padding: 2px 3px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 9px;
      text-align: right;
      -moz-appearance: textfield;
    }

    .mult-input::-webkit-outer-spin-button,
    .mult-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }

    .mult-input:focus {
      outline: none;
      border-color: var(--td-teal);
    }

    .add-group-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      width: 100%;
      padding: 5px 8px;
      background: var(--td-panel-secondary);
      border: 1px dashed var(--td-frame-mid);
      color: var(--td-text-muted);
      font-family: inherit;
      font-size: 9px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .add-group-btn mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    .add-group-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
      border-color: var(--td-text-muted);
    }

    /* Pattern Grid */
    .pattern-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 3px;
      margin-bottom: 8px;
    }

    .pattern-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
      padding: 4px 2px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-muted);
      font-family: inherit;
      font-size: 7px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .pattern-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .pattern-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .pattern-btn.active {
      background: var(--td-gold);
      color: var(--td-bg-dark);
      border-color: var(--td-gold);
    }

    /* Total Row */
    .total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid var(--td-frame-dark);
    }

    .total-count {
      color: var(--td-gold);
      font-weight: 600;
      font-size: 11px;
    }
  `,
})
export class WaveDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly waveDebug = inject(WaveDebugService);

  readonly eventBus = input<GameEventBus>();

  readonly patternLabels = PATTERN_LABELS;
  readonly patternIcons = PATTERN_ICONS;
  onStartCustomWave(): void {
    const bus = this.eventBus();
    if (bus) {
      bus.emit({ type: 'debug:start-custom-wave' });
    }
  }

  // === Single Mode Handlers ===

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

  // === Mixed Mode Handlers ===

  onGroupTypeChange(groupId: number, event: Event): void {
    const value = (event.target as HTMLSelectElement).value as EnemyTypeId;
    this.waveDebug.updateGroup(groupId, { enemyType: value });
  }

  onGroupCountChange(groupId: number, event: Event): void {
    const value = Math.max(1, parseInt((event.target as HTMLInputElement).value, 10) || 1);
    this.waveDebug.updateGroup(groupId, { count: value });
  }

  onGroupHealthMultChange(groupId: number, event: Event): void {
    const value = Math.max(0.1, parseFloat((event.target as HTMLInputElement).value) || 1);
    this.waveDebug.updateGroup(groupId, { healthMultiplier: this.roundTo(value, 1) });
  }

  onGroupSpeedMultChange(groupId: number, event: Event): void {
    const value = Math.max(0.1, parseFloat((event.target as HTMLInputElement).value) || 1);
    this.waveDebug.updateGroup(groupId, { speedMultiplier: this.roundTo(value, 1) });
  }

  onGroupDelayChange(groupId: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    const delay = raw === '' ? undefined : Math.max(10, parseInt(raw, 10) || 0);
    this.waveDebug.updateGroup(groupId, { spawnDelay: delay });
  }

  onClusterSizeChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setClusterSize(value);
  }

  onSubWavePauseChange(event: Event): void {
    const value = parseInt((event.target as HTMLInputElement).value, 10);
    this.waveDebug.setSubWavePause(value);
  }

  onDelayVariationChange(event: Event): void {
    const value = parseFloat((event.target as HTMLInputElement).value);
    this.waveDebug.setDelayVariation(this.roundTo(value, 2));
  }

  // === Formatting ===

  formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
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
