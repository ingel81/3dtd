import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { waterCommands } from '../../tools/water-tool';
import { EditorSession } from '../editor-session.service';
import { BrushPanelComponent } from './brush-panel.component';
import { RangeRowComponent } from './range-row.component';

@Component({
  selector: 'app-water-panel',
  standalone: true,
  imports: [BrushPanelComponent, RangeRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-stack is-loose' },
  template: `
    <div class="td-group">
      <div class="td-setting">
        <span>Water on this map</span>
        <input class="td-switch" type="checkbox" [checked]="!!water()" (change)="toggle($any($event.target).checked)" aria-label="Water" />
      </div>
      @if (water(); as w) {
        <app-editor-range label="Level" unit="m" [min]="-100" [max]="300" [step]="0.5" [value]="w.level" (changed)="setLevel($event)" />
        <label class="td-setting">
          <span>Colour</span>
          <input type="color" [value]="w.color" (change)="setColor($any($event.target).value)" aria-label="Water colour" />
        </label>
      }
    </div>
    <div class="td-seg is-sm" role="radiogroup" aria-label="Water tool">
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'fill'" (click)="setMode('fill')">Fill basin</button>
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'paint'" (click)="setMode('paint')">Paint</button>
      <button type="button" role="radio" [attr.aria-checked]="mode() === 'erase'" (click)="setMode('erase')">Erase</button>
    </div>
    @if (mode() === 'fill') {
      <p class="td-note">A click into a hollow floods every connected spot below the level. Lower ground first, then fill.</p>
    } @else {
      <app-brush-panel />
    }
  `,
})
export class WaterPanelComponent {
  private readonly session = inject(EditorSession);
  readonly water = computed(() => {
    this.session.docRev();
    const w = this.session.doc?.terrain.water;
    return w ? { level: w.level, color: w.color } : null;
  });
  readonly mode = computed(() => (this.session.settingsRev(), this.session.settings.water.mode));

  setMode(mode: 'fill' | 'paint' | 'erase'): void {
    this.session.patchSettings((s) => (s.water.mode = mode));
  }

  toggle(on: boolean): void {
    const editor = this.session.editor;
    if (!editor) return;
    this.session.execute(on ? waterCommands.enable(editor, 0) : waterCommands.remove(editor));
  }

  setLevel(level: number): void {
    const editor = this.session.editor;
    if (editor) this.session.execute(waterCommands.setLevel(editor, level));
  }

  setColor(color: string): void {
    const editor = this.session.editor;
    if (editor) this.session.execute(waterCommands.setColor(editor, color));
  }
}
