import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EditorSession } from '../editor-session.service';
import { injectT } from '../../../i18n/i18n.service';

/**
 * The history as a list: the map as opened, every step done, then the steps
 * undone (dimmed). A click goes back or forward to that step, as that many
 * Ctrl+Z or Ctrl+Y would.
 */
@Component({
  selector: 'app-editor-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="td-side-head"><span class="td-side-name">{{ t().editor.history.title }}</span><span class="td-note">{{ t().editor.history.step(steps().done, steps().total) }}</span></header>
    <div class="td-side-body">
      <div class="td-rows" role="listbox" [attr.aria-label]="t().editor.history.title" data-test="history">
        @for (s of rows(); track s.index) {
          <button class="td-row hp-row" type="button" role="option" [attr.aria-selected]="s.current" [class.is-undone]="s.undone"
                  (click)="jump(s.index)" [attr.data-step]="s.index">
            <span class="td-muted td-num hp-num">{{ s.index }}</span><span class="td-trunc">{{ s.label }}</span>
          </button>
        }
      </div>
      <p class="td-note">{{ t().editor.history.note }}</p>
    </div>
  `,
  styles: [`.hp-row { justify-content: flex-start; gap: 8px; } .hp-num { min-width: 2.5em; } .hp-row.is-undone { opacity: 0.55; }`],
})
export class HistoryPanelComponent {
  protected readonly t = injectT();
  private readonly session = inject(EditorSession);
  readonly steps = computed(() => {
    const { done, undone } = this.session.state.steps();
    return { done: done.length, total: done.length + undone.length };
  });
  /** Newest first: what the eye looks for is the last thing done */
  readonly rows = computed(() => {
    const { done, undone } = this.session.state.steps();
    const rows = [
      { index: 0, label: this.t().editor.history.opened, undone: false, current: done.length === 0 },
      ...done.map((label, k) => ({ index: k + 1, label, undone: false, current: k === done.length - 1 })),
      ...undone.map((label, k) => ({ index: done.length + k + 1, label, undone: true, current: false })),
    ];
    return rows.reverse();
  });

  jump(index: number): void {
    this.session.jumpTo(index);
  }
}
