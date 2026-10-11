import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { MapEnvironment } from '../../../world/custom-map/map-document';
import { SnapshotCommand } from '../../model/editor-document';
import { EditorSession } from '../editor-session.service';
import { RangeRowComponent } from './range-row.component';

const SKIES: { id: MapEnvironment['sky']; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'dusk', label: 'Dusk' },
  { id: 'night', label: 'Night' },
  { id: 'overcast', label: 'Overcast' },
];

/**
 * Sky, sun and fog. Sliders show the change live while they move and land
 * as one undo step when let go.
 */
@Component({
  selector: 'app-environment-panel',
  standalone: true,
  imports: [RangeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-field">
      <span class="td-label" id="ep-sky">Sky</span>
      <div class="td-seg is-sm" role="radiogroup" aria-labelledby="ep-sky">
        @for (s of skies; track s.id) {
          <button type="button" role="radio" [attr.aria-checked]="env()?.sky === s.id" (click)="commit({ sky: s.id }, 'Sky')">{{ s.label }}</button>
        }
      </div>
    </div>
    @if (env(); as e) {
      <div class="td-group">
        <h3 class="td-section">Sun</h3>
        <app-editor-range label="Direction" unit="deg" [min]="0" [max]="359" [value]="e.sunAzimuth"
                          (changing)="live({ sunAzimuth: $event })" (changed)="commit({ sunAzimuth: $event }, 'Sun direction')" />
        <app-editor-range label="Height" unit="deg" [min]="2" [max]="90" [value]="e.sunElevation"
                          (changing)="live({ sunElevation: $event })" (changed)="commit({ sunElevation: $event }, 'Sun height')" />
      </div>
      <div class="td-group">
        <h3 class="td-section">Air</h3>
        <app-editor-range label="Fog" unit="" [min]="0" [max]="40" [step]="0.5" [value]="e.fogDensity * 10000"
                          (changing)="live({ fogDensity: $event / 10000 })" (changed)="commit({ fogDensity: $event / 10000 }, 'Fog')" />
        <label class="td-setting">
          <span>Tint</span>
          <input type="color" [value]="e.tint" (input)="live({ tint: $any($event.target).value })"
                 (change)="commit({ tint: $any($event.target).value }, 'Tint')" aria-label="Tint" />
        </label>
      </div>
    }
  `,
})
export class EnvironmentPanelComponent {
  private readonly session = inject(EditorSession);
  readonly skies = SKIES;
  readonly env = computed(() => (this.session.docRev(), this.session.doc ? { ...this.session.doc.environment } : null));
  /** The environment before the slider started moving */
  private before: MapEnvironment | null = null;

  live(patch: Partial<MapEnvironment>): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.before ??= { ...editor.doc.environment };
    editor.doc.environment = { ...editor.doc.environment, ...patch };
    editor.emit({ environment: true });
  }

  commit(patch: Partial<MapEnvironment>, label: string): void {
    const editor = this.session.editor;
    if (!editor) return;
    const before = this.before ?? { ...editor.doc.environment };
    this.before = null;
    editor.doc.environment = { ...editor.doc.environment, ...patch };
    this.session.execute(new SnapshotCommand(label, { environment: before }, { environment: { ...editor.doc.environment } }));
  }
}
