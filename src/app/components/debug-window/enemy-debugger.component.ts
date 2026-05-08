import { Component, inject, ChangeDetectionStrategy, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { EnemyDebugService } from '../../services/enemy-debug.service';
import { WaveDebugService } from '../../services/wave-debug.service';
import { ENEMY_TYPES, EnemyTypeId } from '../../models/enemy-types';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../../styles/td-theme';
import { TdIconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-enemy-debugger',
  standalone: true,
  imports: [CommonModule, DraggableDebugPanelComponent, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowService.enemyWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="enemy"
        title="Enemy Debug"
        icon="bug"
        [position]="windowService.enemyWindow().position"
        [zIndex]="windowService.enemyWindow().zIndex"
        [size]="windowService.enemyWindow().size ?? { width: 320, height: 650 }"
        [resizable]="true"
        (closed)="windowService.close('enemy')"
        (positionChange)="windowService.updatePosition('enemy', $event)"
        (sizeChange)="windowService.updateSize('enemy', $event)"
        (focused)="windowService.bringToFront('enemy')"
      >
        <div class="enemy-debug-content">
          <!-- Placement Section -->
          <div class="section">
            <div class="section-title">Placement</div>
            <div class="placement-row">
              <select class="enemy-select" [value]="enemyDebug.selectedEnemyId()" (change)="onEnemyTypeSelect($event)">
                @for (id of enemyDebug.enemyTypes(); track id) {
                  <option [value]="id">{{ getEnemyName(id) }}</option>
                }
              </select>
              <button
                class="action-btn place-btn"
                [class.active]="enemyDebug.placementMode()"
                (click)="enemyDebug.togglePlacementMode()"
                title="Place enemy on route"
              >
                <td-icon [name]="enemyDebug.placementMode() ? 'cross' : 'pin'" [size]="14"></td-icon>
              </button>
            </div>
            @if (enemyDebug.placementMode()) {
              <div class="placement-hint">Click on route to place enemy</div>
            }
          </div>

          <!-- Debug Enemies List -->
          <div class="section">
            <div class="section-title">Debug Enemies ({{ enemyDebug.debugEnemies().length }})</div>
            @if (enemyDebug.debugEnemies().length > 0) {
              <div class="debug-enemies-list">
                @for (de of enemyDebug.debugEnemies(); track de.id) {
                  <div class="debug-enemy-item"
                       [class.selected]="de.id === enemyDebug.selectedDebugEnemyId()"
                       (click)="enemyDebug.toggleDebugEnemySelection(de.id)"
                       (keydown.enter)="enemyDebug.toggleDebugEnemySelection(de.id)"
                       tabindex="0"
                       role="button">
                    <span class="enemy-info">
                      <td-icon class="enemy-icon" [size]="14"
                        [name]="de.enemy.alive ? (de.enemy.movement.paused ? 'pause' : 'run') : 'skull'"></td-icon>
                      <span class="enemy-name">{{ getEnemyName(de.typeId) }}</span>
                      <span class="enemy-hp">{{ de.enemy.health.hp | number:'1.0-0' }}/{{ de.enemy.health.maxHp }}</span>
                    </span>
                    <button class="remove-btn" (click)="onRemoveEnemy($event, de.id)" title="Remove">
                      <td-icon name="cross" [size]="14"></td-icon>
                    </button>
                  </div>
                }
              </div>
              <button class="action-btn danger small" (click)="onClearAll()">
                <td-icon name="trash" [size]="14"></td-icon>
                Clear All
              </button>
            } @else {
              <div class="empty-hint">No debug enemies placed</div>
            }
          </div>

          <!-- Selected Enemy Controls -->
          @if (enemyDebug.selectedDebugEnemy(); as selected) {
            <div class="section selected-section">
              <div class="section-title">
                <td-icon class="title-icon" name="edit" [size]="14"></td-icon>
                {{ getEnemyName(selected.typeId) }} #{{ selected.id.slice(-4) }}
              </div>

              <!-- Live Sliders -->
              <div class="slider-row">
                <span class="label">Scale</span>
                <input type="range" min="0.001" max="10" step="0.001"
                       [value]="selected.overrides.scale"
                       (input)="onSelectedSliderChange('scale', $event)" />
                <input type="number" class="number-input" min="0.001" max="10" step="0.001"
                       [value]="selected.overrides.scale"
                       (change)="onSelectedSliderChange('scale', $event)" />
              </div>

              <div class="slider-row">
                <span class="label">Height</span>
                <input type="range" min="0" max="30" step="0.5"
                       [value]="selected.overrides.heightOffset"
                       (input)="onSelectedSliderChange('heightOffset', $event)" />
                <input type="number" class="number-input" min="0" max="30" step="0.5"
                       [value]="selected.overrides.heightOffset"
                       (change)="onSelectedSliderChange('heightOffset', $event)" />
              </div>

              <div class="slider-row">
                <span class="label">HP Bar</span>
                <input type="range" min="0" max="20" step="0.5"
                       [value]="selected.overrides.healthBarOffset"
                       (input)="onSelectedSliderChange('healthBarOffset', $event)" />
                <input type="number" class="number-input" min="0" max="20" step="0.5"
                       [value]="selected.overrides.healthBarOffset"
                       (change)="onSelectedSliderChange('healthBarOffset', $event)" />
              </div>

              <div class="slider-row">
                <span class="label">Speed</span>
                <input type="range" min="0.5" max="20" step="0.1"
                       [value]="selected.overrides.baseSpeed"
                       (input)="onSelectedSliderChange('baseSpeed', $event)" />
                <input type="number" class="number-input" min="0.5" max="20" step="0.1"
                       [value]="selected.overrides.baseSpeed"
                       (change)="onSelectedSliderChange('baseSpeed', $event)" />
                <span class="unit">m/s</span>
              </div>

              <div class="slider-row">
                <span class="label">Rotate</span>
                <input type="range" min="-180" max="180" step="1"
                       [value]="radToDeg(selected.overrides.rotation)"
                       (input)="onRotationChange($event)" />
                <input type="number" class="number-input" min="-180" max="180" step="1"
                       [value]="radToDeg(selected.overrides.rotation)"
                       (change)="onRotationChange($event)" />
                <span class="unit">°</span>
              </div>

              <div class="slider-row">
                <span class="label">Anim</span>
                <input type="range" min="0.01" max="20" step="0.01"
                       [value]="selected.overrides.animationSpeed"
                       (input)="onSelectedSliderChange('animationSpeed', $event)" />
                <input type="number" class="number-input" min="0.01" max="20" step="0.01"
                       [value]="selected.overrides.animationSpeed"
                       (change)="onSelectedSliderChange('animationSpeed', $event)" />
                <span class="unit">×</span>
              </div>

              <!-- Preview Section -->
              <div class="subsection-title">Preview</div>

              <div class="slider-row">
                <span class="label">Scale</span>
                <input type="range" min="0.001" max="5" step="0.001"
                       [value]="selected.overrides.previewScale"
                       (input)="onSelectedSliderChange('previewScale', $event)" />
                <input type="number" class="number-input" min="0.001" max="5" step="0.001"
                       [value]="selected.overrides.previewScale"
                       (change)="onSelectedSliderChange('previewScale', $event)" />
                <span class="unit">×</span>
              </div>

              <div class="slider-row">
                <span class="label">Cam Dist</span>
                <input type="range" min="1" max="30" step="0.5"
                       [value]="selected.overrides.previewCameraDistance"
                       (input)="onSelectedSliderChange('previewCameraDistance', $event)" />
                <input type="number" class="number-input" min="1" max="30" step="0.5"
                       [value]="selected.overrides.previewCameraDistance"
                       (change)="onSelectedSliderChange('previewCameraDistance', $event)" />
              </div>

              <div class="slider-row">
                <span class="label">Cam Angle</span>
                <input type="range" min="0" max="1.57" step="0.01"
                       [value]="selected.overrides.previewCameraAngle"
                       (input)="onSelectedSliderChange('previewCameraAngle', $event)" />
                <input type="number" class="number-input" min="0" max="1.57" step="0.01"
                       [value]="selected.overrides.previewCameraAngle"
                       (change)="onSelectedSliderChange('previewCameraAngle', $event)" />
                <span class="unit">rad</span>
              </div>

              <div class="slider-row">
                <span class="label">Offset Y</span>
                <input type="range" min="-3" max="3" step="0.1"
                       [value]="selected.overrides.previewOffsetY"
                       (input)="onSelectedSliderChange('previewOffsetY', $event)" />
                <input type="number" class="number-input" min="-3" max="3" step="0.1"
                       [value]="selected.overrides.previewOffsetY"
                       (change)="onSelectedSliderChange('previewOffsetY', $event)" />
              </div>

              <!-- Animation Controls -->
              <div class="control-group">
                <div class="control-label">Animation</div>
                <div class="btn-row">
                  <button class="control-btn" (click)="playIdle.emit(selected.id)" title="Idle">
                    <td-icon name="user" [size]="14"></td-icon>
                  </button>
                  <button class="control-btn" (click)="playWalk.emit(selected.id)" title="Walk">
                    <td-icon name="walk" [size]="14"></td-icon>
                  </button>
                  <button class="control-btn" (click)="playRun.emit(selected.id)" title="Run">
                    <td-icon name="run" [size]="14"></td-icon>
                  </button>
                </div>
              </div>

              <!-- Movement Controls -->
              <div class="control-group">
                <div class="control-label">Movement</div>
                <div class="btn-row">
                  <button class="control-btn start" (click)="startMovement.emit(selected.id)" title="Start moving">
                    <td-icon name="play" [size]="14"></td-icon>
                    Start
                  </button>
                  <button class="control-btn stop" (click)="stopMovement.emit(selected.id)" title="Stop moving">
                    <td-icon name="stop" [size]="14"></td-icon>
                    Stop
                  </button>
                </div>
              </div>

              <!-- Reset Button -->
              <button class="action-btn small" (click)="enemyDebug.resetSelectedEnemy()" title="Reset to original values">
                <td-icon name="undo" [size]="14"></td-icon>
                Reset Values
              </button>
            </div>
          }

          <!-- JSON Export -->
          <div class="section">
            <div class="section-title">Export</div>
            <button class="action-btn primary" (click)="onCopyJson()" title="Copy selected enemy as JSON">
              <td-icon name="copy" [size]="14"></td-icon>
              Copy JSON
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

    .enemy-debug-content {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      min-width: 300px;
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
      color: var(--td-gold);
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .title-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    .placement-row {
      display: flex;
      gap: 8px;
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
    }

    .enemy-select:focus {
      outline: none;
      border-color: var(--td-teal);
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

    .enemy-select option {
      background: var(--td-panel-secondary);
      color: var(--td-text-primary);
      padding: 4px;
    }

    .place-btn {
      width: 36px;
      flex-shrink: 0;
    }

    .place-btn.active {
      background: var(--td-gold);
      border-color: var(--td-gold);
      color: var(--td-bg-dark);
    }

    .placement-hint {
      color: var(--td-gold);
      font-size: 9px;
      text-align: center;
      padding: 4px;
      margin-top: 6px;
      background: var(--td-panel-dark);
      border-radius: 2px;
    }

    .empty-hint {
      color: var(--td-text-secondary);
      font-size: 9px;
      text-align: center;
      padding: 8px;
    }

    .debug-enemies-list {
      max-height: 120px;
      overflow-y: auto;
      margin-bottom: 8px;
    }

    .debug-enemy-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      background: var(--td-panel-dark);
      border: 1px solid transparent;
      border-radius: 2px;
      margin-bottom: 4px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .debug-enemy-item:hover {
      background: var(--td-frame-mid);
    }

    .debug-enemy-item.selected {
      background: var(--td-teal);
      color: var(--td-bg-dark);
      border-color: var(--td-teal-light);
    }

    .debug-enemy-item.selected .enemy-hp {
      color: var(--td-bg-dark);
      opacity: 0.8;
    }

    .debug-enemy-item.selected .enemy-icon {
      color: var(--td-bg-dark);
    }

    .enemy-info {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .enemy-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--td-teal);
    }

    .enemy-name {
      font-weight: 500;
    }

    .enemy-hp {
      color: var(--td-text-secondary);
      font-size: 8px;
    }

    .remove-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      min-width: 22px;
      padding: 0;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-health-red);
      border-radius: 3px;
      color: var(--td-health-red);
      cursor: pointer;
      transition: all 0.15s;
      line-height: 1;
    }

    .remove-btn:hover {
      background: var(--td-health-red);
      border-color: var(--td-health-red);
      color: var(--td-text-primary);
    }

    .remove-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      line-height: 14px;
    }

    .selected-section {
      background: var(--td-panel-dark);
      margin: 0 -12px;
      padding: 8px 12px !important;
      border-left: 3px solid var(--td-teal);
    }

    .slider-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .slider-row .label {
      width: 45px;
      color: var(--td-text-secondary);
      flex-shrink: 0;
      font-size: 9px;
    }

    .slider-row input[type="range"] {
      flex: 1;
      height: 4px;
      background: var(--td-frame-dark);
      border-radius: 2px;
      cursor: pointer;
      -webkit-appearance: none;
    }

    .slider-row input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      background: var(--td-teal);
      border-radius: 50%;
      cursor: pointer;
    }

    .number-input {
      width: 50px;
      padding: 2px 4px;
      background: var(--td-bg-dark);
      border: 1px solid var(--td-frame-mid);
      border-radius: 2px;
      color: var(--td-text-primary);
      font-family: inherit;
      font-size: 9px;
      text-align: right;
    }

    .number-input:focus {
      outline: none;
      border-color: var(--td-teal);
    }

    .unit {
      color: var(--td-text-secondary);
      font-size: 8px;
      width: 20px;
    }

    .subsection-title {
      color: var(--td-text-secondary);
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 8px 0 4px;
      padding-top: 6px;
      border-top: 1px solid var(--td-frame-dark);
    }

    .control-group {
      margin: 8px 0;
    }

    .control-label {
      color: var(--td-text-secondary);
      font-size: 8px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .btn-row {
      display: flex;
      gap: 6px;
    }

    .action-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 6px 8px;
      background: var(--td-panel-dark);
      border: 1px solid var(--td-frame-mid);
      border-radius: 2px;
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 9px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .action-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .action-btn.primary {
      background: var(--td-teal);
      border-color: var(--td-teal);
      color: var(--td-bg-dark);
    }

    .action-btn.primary:hover {
      background: var(--td-teal-light);
    }

    .action-btn.danger {
      background: transparent;
      border-color: var(--td-red);
      color: var(--td-red);
    }

    .action-btn.danger:hover {
      background: var(--td-red);
      color: var(--td-bg-dark);
    }

    .action-btn.small {
      padding: 4px 6px;
      font-size: 8px;
    }

    .action-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .control-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 6px;
      background: var(--td-bg-dark);
      border: 1px solid var(--td-frame-mid);
      border-radius: 2px;
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 8px;
      cursor: pointer;
      transition: all 0.15s;
    }

    .control-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .control-btn.start:hover {
      background: var(--td-green);
      border-color: var(--td-green);
      color: var(--td-bg-dark);
    }

    .control-btn.stop:hover {
      background: var(--td-red);
      border-color: var(--td-red);
      color: var(--td-bg-dark);
    }

    .control-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }
  `,
})
export class EnemyDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly enemyDebug = inject(EnemyDebugService);
  private readonly waveDebug = inject(WaveDebugService);

  // Outputs for removing enemies
  readonly removeEnemy = output<string>();
  readonly clearAllEnemies = output<void>();

  // Outputs for animation/movement control
  readonly playIdle = output<string>();
  readonly playWalk = output<string>();
  readonly playRun = output<string>();
  readonly startMovement = output<string>();
  readonly stopMovement = output<string>();

  getEnemyName(id: EnemyTypeId): string {
    return ENEMY_TYPES[id].name;
  }

  onEnemyTypeSelect(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const typeId = select.value as EnemyTypeId;
    this.enemyDebug.selectEnemy(typeId);
    // Also update wave debug so the sidebar preview shows the correct enemy type
    this.waveDebug.setEnemyType(typeId);
  }

  onSelectedSliderChange(key: 'scale' | 'heightOffset' | 'healthBarOffset' | 'baseSpeed' | 'animationSpeed' | 'previewScale' | 'previewCameraDistance' | 'previewCameraAngle' | 'previewOffsetY', event: Event): void {
    const input = event.target as HTMLInputElement;
    this.enemyDebug.updateSelectedOverride(key, parseFloat(input.value));
  }

  onRotationChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const deg = parseFloat(input.value);
    this.enemyDebug.updateSelectedOverride('rotation', this.degToRad(deg));
  }

  radToDeg(rad: number): number {
    return Math.round((rad * 180) / Math.PI);
  }

  degToRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  onRemoveEnemy(event: Event, enemyId: string): void {
    event.stopPropagation(); // Don't trigger selection
    this.removeEnemy.emit(enemyId);
  }

  onClearAll(): void {
    this.clearAllEnemies.emit();
  }

  onCopyJson(): void {
    const selected = this.enemyDebug.selectedDebugEnemy();
    if (selected) {
      const json = JSON.stringify({
        typeId: selected.typeId,
        overrides: {
          scale: Math.round(selected.overrides.scale * 1000) / 1000,
          heightOffset: Math.round(selected.overrides.heightOffset * 10) / 10,
          healthBarOffset: Math.round(selected.overrides.healthBarOffset * 10) / 10,
          baseSpeed: Math.round(selected.overrides.baseSpeed * 10) / 10,
          animationSpeed: Math.round(selected.overrides.animationSpeed * 100) / 100,
          rotation: Math.round(selected.overrides.rotation * 1000) / 1000,
          previewScale: Math.round(selected.overrides.previewScale * 1000) / 1000,
          previewCameraDistance: Math.round(selected.overrides.previewCameraDistance * 10) / 10,
          previewCameraAngle: Math.round(selected.overrides.previewCameraAngle * 100) / 100,
          previewOffsetY: Math.round(selected.overrides.previewOffsetY * 10) / 10,
        }
      }, null, 2);
      navigator.clipboard.writeText(json);
      console.log('[EnemyDebug] Selected enemy JSON copied');
    } else {
      this.enemyDebug.copyJsonToClipboard();
    }
  }
}
