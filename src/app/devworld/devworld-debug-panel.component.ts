import { Component, ChangeDetectionStrategy, inject, output, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DevWorldService, TerrainPreset } from './devworld.service';
import { TD_CSS_VARS } from '../styles/td-theme';
import { TdIconComponent } from '../components/icon/icon.component';

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
  imports: [CommonModule, TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './devworld-debug-panel.component.html',
  styleUrl: './devworld-debug-panel.component.scss',
  styles: `
    :host {
      ${TD_CSS_VARS}
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
