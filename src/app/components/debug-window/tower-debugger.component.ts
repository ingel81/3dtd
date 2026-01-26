import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DraggableDebugPanelComponent } from './draggable-debug-panel.component';
import { DebugWindowService } from '../../services/debug-window.service';
import { TowerDebugService } from '../../services/tower-debug.service';
import { TOWER_TYPES, TowerTypeId } from '../../configs/tower-types.config';
import { TD_CSS_VARS } from '../../styles/td-theme';

@Component({
  selector: 'app-tower-debugger',
  standalone: true,
  imports: [CommonModule, MatIconModule, DraggableDebugPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (windowService.towerWindow().isOpen) {
      <app-draggable-debug-panel
        windowId="tower"
        title="Tower Debug"
        icon="settings"
        [position]="windowService.towerWindow().position"
        [zIndex]="windowService.towerWindow().zIndex"
        [size]="windowService.towerWindow().size ?? { width: 300, height: 550 }"
        [resizable]="true"
        (closed)="windowService.close('tower')"
        (positionChange)="windowService.updatePosition('tower', $event)"
        (sizeChange)="windowService.updateSize('tower', $event)"
        (focused)="windowService.bringToFront('tower')"
      >
        <div class="tower-debug-content">
          <!-- Tower Selection -->
          <div class="section">
            <div class="section-title">Tower</div>
            <select class="tower-select" [value]="towerDebug.selectedTowerId()" (change)="onTowerSelect($event)">
              @for (id of towerDebug.towerTypes(); track id) {
                <option [value]="id">{{ getTowerName(id) }}</option>
              }
            </select>
          </div>

          <!-- Sliders -->
          <div class="section">
            <div class="section-title">Werte</div>

            <div class="slider-row">
              <span class="label">Scale</span>
              <input type="range" min="0.5" max="30" step="0.1"
                     [value]="towerDebug.currentOverrides().scale"
                     (input)="onSliderChange('scale', $event)" />
              <input type="number" class="number-input" min="0.5" max="30" step="0.1"
                     [value]="towerDebug.currentOverrides().scale"
                     (change)="onSliderChange('scale', $event)" />
            </div>

            <div class="slider-row">
              <span class="label">Preview</span>
              <input type="range" min="0.5" max="50" step="0.1"
                     [value]="towerDebug.currentOverrides().previewScale"
                     (input)="onSliderChange('previewScale', $event)" />
              <input type="number" class="number-input" min="0.5" max="50" step="0.1"
                     [value]="towerDebug.currentOverrides().previewScale"
                     (change)="onSliderChange('previewScale', $event)" />
            </div>

            <div class="slider-row">
              <span class="label">Height</span>
              <input type="range" min="0" max="20" step="0.1"
                     [value]="towerDebug.currentOverrides().heightOffset"
                     (input)="onSliderChange('heightOffset', $event)" />
              <input type="number" class="number-input" min="0" max="20" step="0.1"
                     [value]="towerDebug.currentOverrides().heightOffset"
                     (change)="onSliderChange('heightOffset', $event)" />
            </div>

            <div class="slider-row">
              <span class="label">Shoot</span>
              <input type="range" min="0" max="20" step="0.05"
                     [value]="towerDebug.currentOverrides().shootHeight"
                     (input)="onSliderChange('shootHeight', $event)" />
              <input type="number" class="number-input" min="0" max="20" step="0.05"
                     [value]="towerDebug.currentOverrides().shootHeight"
                     (change)="onSliderChange('shootHeight', $event)" />
            </div>

            <div class="slider-row">
              <span class="label">Rotation</span>
              <input type="range" min="-180" max="180" step="1"
                     [value]="towerDebug.radToDeg(towerDebug.currentOverrides().rotationY)"
                     (input)="onRotationChange($event)" />
              <input type="number" class="number-input" min="-180" max="180" step="1"
                     [value]="towerDebug.radToDeg(towerDebug.currentOverrides().rotationY) | number:'1.0-0'"
                     (change)="onRotationChange($event)" />
              <span class="unit">°</span>
            </div>
          </div>

          <!-- Visualization -->
          <div class="section">
            <div class="section-title">Visualisierung</div>
            <label class="checkbox-row">
              <input type="checkbox"
                     [checked]="towerDebug.showShootHeight()"
                     (change)="towerDebug.showShootHeight.set($any($event.target).checked)" />
              <span>Shoot Height anzeigen</span>
            </label>
          </div>

          <!-- Actions -->
          <div class="section">
            <div class="section-title">Aktionen</div>
            <div class="btn-row">
              <button class="action-btn" (click)="towerDebug.resetCurrentTower()" title="Aktuellen Tower zurücksetzen">
                <mat-icon>undo</mat-icon>
                Reset
              </button>
              <button class="action-btn primary" (click)="towerDebug.copyJsonToClipboard()" title="Alle Tower als JSON kopieren">
                <mat-icon>content_copy</mat-icon>
                Copy JSON
              </button>
            </div>
          </div>

          <!-- JSON Preview -->
          <div class="section json-section">
            <div class="section-title">JSON Export (alle Tower)</div>
            <pre class="json-preview">{{ towerDebug.exportAllAsJson() }}</pre>
          </div>
        </div>
      </app-draggable-debug-panel>
    }
  `,
  styles: `
    :host {
      ${TD_CSS_VARS}
    }

    .tower-debug-content {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
      min-width: 280px;
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
    }

    .tower-select {
      width: 100%;
      padding: 6px 8px;
      background: var(--td-panel-dark);
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

    .tower-select:focus {
      outline: none;
      border-color: var(--td-teal);
    }

    .tower-select option {
      background: var(--td-panel-dark);
      color: var(--td-text-primary);
      padding: 4px 8px;
    }

    .slider-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }

    .slider-row .label {
      width: 50px;
      color: var(--td-text-secondary);
      flex-shrink: 0;
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
      width: 55px;
      padding: 2px 4px;
      background: var(--td-panel-dark);
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
      font-size: 9px;
      width: 15px;
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      color: var(--td-text-secondary);
    }

    .checkbox-row input[type="checkbox"] {
      width: 14px;
      height: 14px;
      cursor: pointer;
      accent-color: var(--td-teal);
    }

    .checkbox-row:hover {
      color: var(--td-text-primary);
    }

    .btn-row {
      display: flex;
      gap: 8px;
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

    .action-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .json-section {
      max-height: 200px;
      overflow: hidden;
    }

    .json-preview {
      margin: 0;
      padding: 8px;
      background: var(--td-panel-dark);
      border: 1px solid var(--td-frame-dark);
      border-radius: 2px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 8px;
      color: var(--td-text-secondary);
      overflow: auto;
      max-height: 150px;
      white-space: pre;
    }
  `,
})
export class TowerDebuggerComponent {
  readonly windowService = inject(DebugWindowService);
  readonly towerDebug = inject(TowerDebugService);

  getTowerName(id: TowerTypeId): string {
    return TOWER_TYPES[id].name;
  }

  onTowerSelect(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.towerDebug.selectTower(select.value as TowerTypeId);
  }

  onSliderChange(key: 'scale' | 'previewScale' | 'heightOffset' | 'shootHeight', event: Event): void {
    const input = event.target as HTMLInputElement;
    this.towerDebug.setOverride(key, parseFloat(input.value));
  }

  onRotationChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const deg = parseFloat(input.value);
    this.towerDebug.setOverride('rotationY', this.towerDebug.degToRad(deg));
  }
}
