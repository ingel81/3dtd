import { Component, ChangeDetectionStrategy, inject, output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DevWorldService, TerrainPreset } from './devworld.service';
import { TD_CSS_VARS, TD_SCROLLBAR_STYLES, TD_SCROLLBAR_WEBKIT } from '../styles/td-theme';

/**
 * Terrain categories for organized display
 */
const TERRAIN_CATEGORIES: { name: string; presets: TerrainPreset[] }[] = [
  { name: 'Basic', presets: ['flat', 'gentle', 'default'] },
  { name: 'Slopes', presets: ['slope_ns', 'slope_ew', 'slope_diag'] },
  { name: 'Mountains', presets: ['mountains', 'peaks'] },
  { name: 'Valleys', presets: ['crater', 'bowl', 'dome'] },
  { name: 'Plateaus', presets: ['mesa', 'terraces', 'steps'] },
  { name: 'Cellular', presets: ['canyon', 'cells', 'cracks'] },
  { name: 'Waves', presets: ['waves', 'dunes', 'ripples'] },
  { name: 'Patterns', presets: ['spiral', 'rings'] },
  { name: 'Eroded', presets: ['eroded', 'weathered'] },
  { name: 'Biomes', presets: ['islands', 'highlands', 'badlands'] },
  { name: 'Extreme', presets: ['chaos', 'alien', 'fractal'] },
];

@Component({
  selector: 'app-devworld-debug-panel',
  standalone: true,
  imports: [CommonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="devworld-panel">
      <div class="badge">
        <mat-icon>videogame_asset</mat-icon>
        <span>DevWorld</span>
      </div>

      <div class="section">
        <div class="section-title">Terrain</div>
        <select class="terrain-select" (change)="onTerrainChange($event)">
          @for (category of categories; track category.name) {
            <optgroup [label]="category.name">
              @for (preset of category.presets; track preset) {
                <option [value]="preset" [selected]="preset === devWorld.config.terrain">{{ preset }}</option>
              }
            </optgroup>
          }
        </select>
      </div>

      <div class="section">
        <div class="section-title">Seed</div>
        <div class="seed-row">
          <input
            type="number"
            class="seed-input"
            [value]="devWorld.config.seed"
            (change)="onSeedChange($event)"
            min="0"
            max="99999"
          />
          <button class="seed-btn" (click)="randomSeed()" title="Random Seed">
            <mat-icon>casino</mat-icon>
          </button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Buildings</div>
        <div class="btn-row">
          @for (preset of buildingPresets; track preset) {
            <button
              class="building-btn"
              [class.active]="devWorld.config.buildings === preset"
              (click)="selectBuildings(preset)"
            >
              {{ preset }}
            </button>
          }
        </div>
      </div>

      <div class="section">
        <div class="section-title">Actions</div>
        <button class="regenerate-btn" [class.loading]="isRegenerating()" [disabled]="isRegenerating()" (click)="regenerate()" title="Regenerate world with current settings">
          <mat-icon [class.spinning]="isRegenerating()">{{ isRegenerating() ? 'sync' : 'refresh' }}</mat-icon>
          {{ isRegenerating() ? 'Regenerating...' : 'Regenerate World' }}
        </button>
        <button class="copy-btn" (click)="copyUrl()" title="Copy shareable URL">
          <mat-icon>link</mat-icon>
          Copy URL
        </button>
      </div>

      <div class="info">
        <div class="info-row">
          <span class="label">Size:</span>
          <span class="value">1000m x 1000m</span>
        </div>
        <div class="info-row">
          <span class="label">Max Height:</span>
          <span class="value">150m</span>
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      ${TD_CSS_VARS}
    }

    .devworld-panel {
      font-family: 'JetBrains Mono', monospace;
      font-size: 10px;
    }

    .badge {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: linear-gradient(135deg, #2d5a2d 0%, #1a3d1a 100%);
      border-bottom: 2px solid #4a8a4a;
      color: #8fdf8f;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .badge mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
    }

    .section {
      padding: 8px;
      border-bottom: 1px solid var(--td-frame-dark);
    }

    .section:last-of-type {
      border-bottom: none;
    }

    .section-title {
      font-size: 9px;
      font-weight: 600;
      color: var(--td-gold);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }

    .terrain-select {
      width: 100%;
      padding: 6px 8px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-primary);
      font-family: inherit;
      font-size: 10px;
      cursor: pointer;
      ${TD_SCROLLBAR_STYLES}
    }

    .terrain-select::-webkit-scrollbar {
      ${TD_SCROLLBAR_WEBKIT.scrollbar}
    }

    .terrain-select::-webkit-scrollbar-track {
      ${TD_SCROLLBAR_WEBKIT.track}
    }

    .terrain-select::-webkit-scrollbar-thumb {
      ${TD_SCROLLBAR_WEBKIT.thumb}
    }

    .terrain-select::-webkit-scrollbar-thumb:hover {
      ${TD_SCROLLBAR_WEBKIT.thumbHover}
    }

    .terrain-select:focus {
      outline: none;
      border-color: #4a8a4a;
    }

    .terrain-select optgroup {
      background: var(--td-panel-primary);
      color: var(--td-gold);
      font-weight: 600;
    }

    .terrain-select option {
      background: var(--td-panel-secondary);
      color: var(--td-text-primary);
      padding: 4px;
    }

    .seed-row {
      display: flex;
      gap: 4px;
    }

    .seed-input {
      flex: 1;
      padding: 6px 8px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-primary);
      font-family: inherit;
      font-size: 10px;
    }

    .seed-input:focus {
      outline: none;
      border-color: #4a8a4a;
    }

    .seed-btn {
      padding: 6px 10px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .seed-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .seed-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .btn-row {
      display: flex;
      gap: 4px;
    }

    .building-btn {
      flex: 1;
      padding: 4px 8px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 9px;
      cursor: pointer;
      transition: all 0.15s ease;
      text-transform: capitalize;
    }

    .building-btn:hover {
      background: var(--td-frame-mid);
    }

    .building-btn.active {
      background: var(--td-gold-dark);
      border-color: var(--td-gold);
      color: var(--td-text-primary);
    }

    .regenerate-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px;
      background: linear-gradient(135deg, #2d5a2d 0%, #1a3d1a 100%);
      border: 1px solid #4a8a4a;
      color: #8fdf8f;
      font-family: inherit;
      font-size: 10px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      margin-bottom: 6px;
    }

    .regenerate-btn:hover {
      background: linear-gradient(135deg, #3d6a3d 0%, #2a4d2a 100%);
    }

    .regenerate-btn mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .regenerate-btn.loading {
      opacity: 0.7;
      cursor: wait;
    }

    .regenerate-btn:disabled {
      pointer-events: none;
    }

    .spinning {
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .copy-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 6px 8px;
      background: var(--td-panel-secondary);
      border: 1px solid var(--td-frame-mid);
      color: var(--td-text-secondary);
      font-family: inherit;
      font-size: 9px;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .copy-btn:hover {
      background: var(--td-frame-mid);
      color: var(--td-text-primary);
    }

    .copy-btn mat-icon {
      font-size: 12px;
      width: 12px;
      height: 12px;
    }

    .info {
      padding: 6px 8px;
      background: var(--td-panel-shadow);
      font-size: 9px;
    }

    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 2px;
    }

    .info-row:last-child {
      margin-bottom: 0;
    }

    .info .label {
      color: var(--td-text-muted);
    }

    .info .value {
      color: var(--td-teal);
    }
  `,
})
export class DevWorldDebugPanelComponent {
  readonly devWorld = inject(DevWorldService);
  readonly categories = TERRAIN_CATEGORIES;
  readonly buildingPresets = ['none', 'sparse', 'dense', 'maze'] as const;

  // Input for loading state
  readonly isRegenerating = input(false);

  // Output for terrain refresh request
  readonly terrainRefresh = output<void>();

  onTerrainChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const preset = select.value as TerrainPreset;
    if (this.devWorld.config.terrain === preset) return;

    this.devWorld.updateConfig({ terrain: preset });
  }

  onSeedChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const seed = parseInt(input.value, 10);
    if (isNaN(seed) || seed < 0) return;

    this.devWorld.updateConfig({ seed });
  }

  randomSeed(): void {
    const seed = Math.floor(Math.random() * 100000);
    this.devWorld.updateConfig({ seed });
  }

  selectBuildings(preset: string): void {
    if (this.devWorld.config.buildings === preset) return;
    this.devWorld.updateConfig({ buildings: preset as 'none' | 'sparse' | 'dense' | 'maze' });
  }

  regenerate(): void {
    this.terrainRefresh.emit();
  }

  copyUrl(): void {
    const url = this.devWorld.getShareUrl();
    navigator.clipboard.writeText(url).then(() => {
      console.log('[DevWorld] URL copied to clipboard:', url);
    });
  }
}
