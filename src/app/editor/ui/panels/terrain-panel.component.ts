import { ModePickerComponent } from './mode-picker.component';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TERRAIN_MODES, type TerrainMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';

@Component({
  selector: 'app-terrain-panel',
  standalone: true,
  imports: [ModePickerComponent, BrushPanelComponent, RangeRowComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <app-editor-modes label="Terrain brush" [modes]="modes" [value]="t().mode" (picked)="setMode($any($event))" />
    @if (t().mode === 'level' || t().mode === 'terrace') {
      <app-editor-range [label]="t().mode === 'level' ? 'Height' : 'Base'" unit="m" [min]="-100" [max]="400" [step]="0.5"
                        [value]="t().level" (changing)="set('level', $event)" />
      <p class="td-note">Ctrl click on the map picks the height there.</p>
    }
    @if (t().mode === 'terrace' || t().mode === 'plateau') {
      <app-editor-range label="Step" unit="m" [min]="1" [max]="40" [step]="0.5" [value]="t().step" (changing)="set('step', $event)" />
    }
    @if (t().mode === 'ramp') {
      <app-editor-range label="Width" unit="m" [min]="4" [max]="120" [step]="1" [value]="t().rampWidth" (changing)="set('rampWidth', $event)" />
    }
    @if (t().mode !== 'ramp') {
      <app-brush-panel />
    }
    <p class="td-note">Shift reverses raise and lower and builds a cliff level downward.</p>
  `,
  styles: [`.ep-wrap { flex-wrap: wrap; height: auto; } .ep-wrap > * { flex: 1 0 30%; }`],
})
export class TerrainPanelComponent {
  private readonly session = inject(EditorSession);
  readonly modes = TERRAIN_MODES;
  readonly t = computed(() => (this.session.settingsRev(), { ...this.session.settings.terrain }));

  setMode(mode: TerrainMode): void {
    this.session.patchSettings((s) => (s.terrain.mode = mode));
  }

  set(key: 'level' | 'step' | 'rampWidth', value: number): void {
    this.session.patchSettings((s) => (s.terrain[key] = value));
  }
}
