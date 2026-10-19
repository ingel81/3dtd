import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BRUSH_LIMITS } from '../../../map-ops/brush';
import { EditorSession } from '../editor-session.service';
import { RangeRowComponent } from './range-row.component';
import { patch } from '../../tools/tool';
import { injectT } from '../../../i18n/i18n.service';

/** Size, strength and falloff of the brush every painting tool shares */
@Component({
  selector: 'app-brush-panel',
  standalone: true,
  imports: [RangeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-group' },
  template: `
    <h3 class="td-section">{{ t().editor.brush.title }} <span class="td-note"><kbd class="td-kbd">[</kbd> <kbd class="td-kbd">]</kbd> {{ t().editor.brush.sizeKeys }}</span></h3>
    <app-editor-range [label]="t().editor.brush.size" unit="m" [min]="limits.radius.min" [max]="limits.radius.max" [step]="0.5"
                      [value]="brush().radius" (changing)="set('radius', $event)" data-test="brush-size" />
    <app-editor-range [label]="t().editor.brush.strength" unit="%" [min]="5" [max]="100" [step]="1"
                      [value]="brush().strength * 100" (changing)="set('strength', $event / 100)" />
    <app-editor-range [label]="t().editor.brush.falloff" unit="%" [min]="0" [max]="100" [step]="1"
                      [value]="brush().falloff * 100" (changing)="set('falloff', $event / 100)" />
  `,
})
export class BrushPanelComponent {
  protected readonly t = injectT();
  private readonly session = inject(EditorSession);
  readonly limits = BRUSH_LIMITS;
  readonly brush = this.session.tools.settings.brush;

  set(key: 'radius' | 'strength' | 'falloff', value: number): void {
    patch(this.session.tools.settings.brush, { [key]: value });
  }
}
