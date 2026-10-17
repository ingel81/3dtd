import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BRUSH_LIMITS } from '../../../map-ops/brush';
import { EditorSession } from '../editor-session.service';
import { RangeRowComponent } from './range-row.component';
import { patch } from '../../tools/tool';

/** Size, strength and falloff of the brush every painting tool shares */
@Component({
  selector: 'app-brush-panel',
  standalone: true,
  imports: [RangeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-group' },
  template: `
    <h3 class="td-section">Brush <span class="td-note"><kbd class="td-kbd">[</kbd> <kbd class="td-kbd">]</kbd> size</span></h3>
    <app-editor-range label="Size" unit="m" [min]="limits.radius.min" [max]="limits.radius.max" [step]="0.5"
                      [value]="brush().radius" (changing)="set('radius', $event)" data-test="brush-size" />
    <app-editor-range label="Strength" unit="%" [min]="5" [max]="100" [step]="1"
                      [value]="brush().strength * 100" (changing)="set('strength', $event / 100)" />
    <app-editor-range label="Falloff" unit="%" [min]="0" [max]="100" [step]="1"
                      [value]="brush().falloff * 100" (changing)="set('falloff', $event / 100)" />
  `,
})
export class BrushPanelComponent {
  private readonly session = inject(EditorSession);
  readonly limits = BRUSH_LIMITS;
  readonly brush = this.session.tools.settings.brush;

  set(key: 'radius' | 'strength' | 'falloff', value: number): void {
    patch(this.session.tools.settings.brush, { [key]: value });
  }
}
