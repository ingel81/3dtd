import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** One choice of a tool's mode; modes with the same `group` stand together under its name */
export interface EditorMode {
  id: string;
  label: string;
  hint: string;
  group?: string;
}

/**
 * A tool's modes as a grid of buttons, grouped where the modes say so, and
 * under it what the chosen one does: the hint is read where the choice is
 * made, not only in a tooltip or the status bar.
 */
@Component({
  selector: 'app-editor-modes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'em-host' },
  template: `
    @for (g of groups(); track g.name) {
      @if (g.name) {
        <span class="td-caps em-head">{{ g.name }}</span>
      }
      <div class="em-grid" role="radiogroup" [attr.aria-label]="g.name || label()">
        @for (m of g.modes; track m.id) {
          <button type="button" class="em-mode" role="radio" [attr.aria-checked]="value() === m.id" (click)="picked.emit(m.id)"
                  [attr.data-mode]="m.id">{{ m.label }}</button>
        }
      </div>
    }
    @if (chosen(); as c) {
      <p class="td-note em-hint" data-test="mode-hint">{{ c.hint }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .em-head {
        font-size: 10px;
        opacity: 0.65;
        margin-top: 4px;
      }
      .em-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 3px;
      }
      .em-mode {
        min-width: 0;
        padding: 6px 4px;
        border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
        border-radius: var(--td-radius);
        background: color-mix(in srgb, currentColor 4%, transparent);
        color: inherit;
        font: inherit;
        font-size: var(--td-fs-small);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: pointer;
      }
      .em-mode:hover {
        background: color-mix(in srgb, currentColor 10%, transparent);
      }
      .em-mode[aria-checked='true'] {
        color: var(--td-brass-light);
        border-color: color-mix(in srgb, var(--td-brass-light) 55%, transparent);
        background: color-mix(in srgb, var(--td-brass-light) 12%, transparent);
      }
      .em-mode:focus-visible {
        outline: 2px solid var(--td-brass-light);
        outline-offset: 1px;
      }
      .em-hint {
        margin: 2px 0 0;
        min-height: 2.6em;
      }
    `,
  ],
})
export class ModePickerComponent {
  readonly modes = input.required<readonly EditorMode[]>();
  readonly value = input.required<string>();
  /** Names the whole set for screen readers when it has no groups */
  readonly label = input('Mode');
  readonly picked = output<string>();

  readonly groups = computed(() => {
    const out: { name: string; modes: EditorMode[] }[] = [];
    for (const m of this.modes()) {
      const name = m.group ?? '';
      const last = out[out.length - 1];
      if (last && last.name === name) last.modes.push(m);
      else out.push({ name, modes: [m] });
    }
    return out;
  });
  readonly chosen = computed(() => this.modes().find((m) => m.id === this.value()) ?? null);
}
