import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EditorSession } from '../editor-session.service';

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
    <header class="td-side-head"><span class="td-side-name">History</span><span class="td-note">step {{ steps().done }} of {{ steps().total }}</span></header>
    <div class="td-side-body">
      <div class="td-rows" role="listbox" aria-label="History" data-test="history">
        @for (s of rows(); track s.index) {
          <button class="td-row hp-row" type="button" role="option" [attr.aria-selected]="s.current" [class.is-undone]="s.undone"
                  (click)="jump(s.index)" [attr.data-step]="s.index">
            <span class="td-muted td-num hp-num">{{ s.index }}</span><span class="td-trunc">{{ s.label }}</span>
          </button>
        }
      </div>
      <p class="td-note">A click goes back or forward to that step; changes made then drop the steps after it, as with Ctrl+Z.</p>
    </div>
  `,
  styles: [`.hp-row { justify-content: flex-start; gap: 8px; } .hp-num { min-width: 2.5em; } .hp-row.is-undone { opacity: 0.55; }`],
})
export class HistoryPanelComponent {
  private readonly session = inject(EditorSession);
  readonly steps = computed(() => {
    const { done, undone } = this.session.steps();
    return { done: done.length, total: done.length + undone.length };
  });
  /** Newest first: what the eye looks for is the last thing done */
  readonly rows = computed(() => {
    const { done, undone } = this.session.steps();
    const rows = [
      { index: 0, label: 'Opened', undone: false, current: done.length === 0 },
      ...done.map((label, k) => ({ index: k + 1, label, undone: false, current: k === done.length - 1 })),
      ...undone.map((label, k) => ({ index: done.length + k + 1, label, undone: true, current: false })),
    ];
    return rows.reverse();
  });

  jump(index: number): void {
    this.session.jumpTo(index);
  }
}
