import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, input, output, signal, viewChild } from '@angular/core';
import { rankCommands, type EditorCommand } from './commands';

/**
 * The command palette (Ctrl+K): a search field over every command; arrow
 * keys move, Enter runs, Esc closes.
 */
@Component({
  selector: 'app-command-palette',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cp-veil" (click)="closed.emit()" aria-hidden="true"></div>
    <section class="cp td-dlg" role="dialog" aria-modal="true" aria-label="Commands" data-test="palette">
      <input #field class="td-input cp-field" type="text" placeholder="Type a command, a tool, a biome or an object"
             role="combobox" aria-controls="cp-list" aria-expanded="true" [attr.aria-activedescendant]="'cp-' + active()"
             [value]="query()" (input)="setQuery($any($event.target).value)" (keydown)="onKey($event)" data-test="palette-field" />
      <ul class="cp-list" id="cp-list" role="listbox" aria-label="Commands">
        @for (c of found(); track c.id; let i = $index) {
          <li class="cp-row" role="option" [id]="'cp-' + i" [attr.aria-selected]="i === active()" [class.is-active]="i === active()"
              tabindex="-1" (mousemove)="active.set(i)" (click)="run(c)" (keydown.enter)="run(c)">
            <span class="td-trunc cp-label">{{ c.label }}</span>
            <span class="td-muted cp-group">{{ c.group }}</span>
            @if (c.keys) {
              <kbd class="td-kbd">{{ c.keys }}</kbd>
            }
          </li>
        } @empty {
          <li class="td-note cp-none">Nothing matches.</li>
        }
      </ul>
    </section>
  `,
  styles: [
    `
      .cp-veil {
        position: fixed;
        inset: 0;
        z-index: 30;
      }
      .cp {
        position: fixed;
        top: 72px;
        left: 50%;
        z-index: 31;
        width: min(620px, calc(100vw - 32px));
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        gap: var(--td-sp-2);
        padding: var(--td-sp-3);
      }
      .cp-list {
        list-style: none;
        margin: 0;
        padding: 0;
        max-height: min(420px, calc(100vh - 200px));
        overflow-y: auto;
      }
      .cp-row {
        display: flex;
        align-items: center;
        gap: var(--td-sp-2);
        min-height: 32px;
        padding: 0 var(--td-sp-2);
        cursor: pointer;
      }
      .cp-row.is-active {
        background: var(--td-tint-overlay);
      }
      .cp-label {
        flex: 1 1 auto;
      }
      .cp-group {
        flex: 0 0 auto;
        font-size: var(--td-fs-small);
      }
      .cp-none {
        padding: var(--td-sp-2);
      }
    `,
  ],
})
export class CommandPaletteComponent {
  readonly commands = input.required<readonly EditorCommand[]>();
  readonly closed = output<void>();
  readonly query = signal('');
  readonly active = signal(0);
  readonly found = computed(() => rankCommands(this.query(), this.commands()));
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  constructor() {
    afterNextRender(() => this.field().nativeElement.focus());
  }

  setQuery(q: string): void {
    this.query.set(q);
    this.active.set(0);
  }

  onKey(e: KeyboardEvent): void {
    const n = this.found().length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (n) this.active.set((this.active() + 1) % n);
        this.reveal();
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (n) this.active.set((this.active() - 1 + n) % n);
        this.reveal();
        return;
      case 'Enter': {
        e.preventDefault();
        const c = this.found()[this.active()];
        if (c) this.run(c);
        return;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        this.closed.emit();
        return;
    }
  }

  run(c: EditorCommand): void {
    this.closed.emit();
    c.run();
  }

  private reveal(): void {
    queueMicrotask(() => document.getElementById(`cp-${this.active()}`)?.scrollIntoView({ block: 'nearest' }));
  }
}
