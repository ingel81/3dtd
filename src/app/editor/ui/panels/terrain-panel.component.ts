import { ModePickerComponent, type EditorMode } from './mode-picker.component';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { patch, TERRAIN_MODES, type TerrainMode } from '../../tools/tool';
import { EditorSession } from '../editor-session.service';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';
import { injectT } from '../../../i18n/i18n.service';

@Component({
  selector: 'app-terrain-panel',
  standalone: true,
  imports: [ModePickerComponent, BrushPanelComponent, RangeRowComponent, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <app-editor-modes [label]="t().editor.terrain.brush" [modes]="modes()" [value]="s().mode" (picked)="setMode($any($event))" />
    @if (s().mode === 'level' || s().mode === 'terrace') {
      <app-editor-range [label]="s().mode === 'level' ? t().editor.terrain.height : t().editor.terrain.base" unit="m" [min]="-100" [max]="400" [step]="0.5"
                        [value]="s().level" (changing)="set('level', $event)" />
      <p class="td-note">{{ t().editor.terrain.pickNote }}</p>
    }
    @if (s().mode === 'terrace' || s().mode === 'plateau') {
      <app-editor-range [label]="t().editor.terrain.step" unit="m" [min]="1" [max]="40" [step]="0.5" [value]="s().step" (changing)="set('step', $event)" />
    }
    @if (s().mode === 'ramp') {
      <app-editor-range [label]="t().editor.terrain.width" unit="m" [min]="4" [max]="120" [step]="1" [value]="s().rampWidth" (changing)="set('rampWidth', $event)" />
    }
    @if (s().mode !== 'ramp') {
      <app-brush-panel />
    }
    <p class="td-note">{{ t().editor.terrain.shiftNote }}</p>
  `,
  styles: [`.ep-wrap { flex-wrap: wrap; height: auto; } .ep-wrap > * { flex: 1 0 30%; }`],
})
export class TerrainPanelComponent {
  protected readonly t = injectT();
  private readonly session = inject(EditorSession);
  readonly modes = computed<EditorMode[]>(() => {
    const says = this.t().editor.terrain;
    return TERRAIN_MODES.map((m) => ({ id: m.id, ...says.modes[m.id], group: says.groups[m.group] }));
  });
  readonly s = this.session.tools.settings.terrain;

  setMode(mode: TerrainMode): void {
    patch(this.session.tools.settings.terrain, { mode });
  }

  set(key: 'level' | 'step' | 'rampWidth', value: number): void {
    patch(this.session.tools.settings.terrain, { [key]: value });
  }
}
