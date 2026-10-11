import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TdIconComponent } from '../../../components/icon/icon.component';
import type { MapIssue } from '../../validation/map-validation';
import { EditorSession } from '../editor-session.service';

/**
 * The result of "Check" over the view: errors first, then warnings; a
 * click selects the thing and frames it. It updates while the map changes.
 */
@Component({
  selector: 'app-editor-check',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-overlay' },
  template: `
    <header class="ck-head td-line-bottom">
      <h2 class="td-section">Check</h2>
      <span class="td-note">{{ summary() }}</span>
      <button class="td-close" type="button" aria-label="Close the check" (click)="close()"><td-icon name="close" [size]="12" /></button>
    </header>
    @if (issues().length) {
      <div class="td-rows ck-list" data-test="issues">
        @for (i of issues(); track $index) {
          <button class="td-row ck-row" type="button" role="button" (click)="focus(i)" [attr.data-code]="i.code">
            <td-icon [name]="i.severity === 'error' ? 'warn' : 'info'" [size]="14" [class.td-tone-hurt]="i.severity === 'error'" [class.td-tone-brass]="i.severity === 'warning'" />
            <span class="ck-text">{{ i.message }}</span>
          </button>
        }
      </div>
    } @else {
      <p class="td-note is-ok ck-ok" data-test="issues-none">Paths connect, every spawn reaches the HQ. Ready to test.</p>
    }
  `,
  styles: [
    `:host { display: block; padding: 8px 12px 10px; }
     .ck-head { display: flex; align-items: center; gap: 8px; padding-bottom: 6px; margin-bottom: 6px; }
     .ck-head .td-note { flex: 1 1 auto; }
     .ck-list { max-height: 260px; overflow-y: auto; }
     .ck-row { justify-content: flex-start; gap: 8px; min-height: 30px; padding: 4px 6px; text-align: left; }
     .ck-text { flex: 1 1 auto; white-space: normal; }
     .ck-ok { margin: 4px 0 0; }`,
  ],
})
export class CheckPanelComponent {
  private readonly session = inject(EditorSession);
  readonly issues = computed(() => this.session.issues() ?? []);
  readonly summary = computed(() => {
    const list = this.issues();
    const errors = list.filter((i) => i.severity === 'error').length;
    const warnings = list.length - errors;
    if (!list.length) return 'No problems';
    return [errors ? `${errors} ${errors === 1 ? 'error' : 'errors'}` : '', warnings ? `${warnings} ${warnings === 1 ? 'warning' : 'warnings'}` : '']
      .filter(Boolean)
      .join(' | ');
  });

  focus(issue: MapIssue): void {
    const editor = this.session.editor;
    const vp = this.session.viewport;
    if (!editor || !vp) return;
    const t = issue.target;
    if (t?.kind === 'spawn' && t.id) {
      editor.select({ kind: 'spawn', id: t.id });
      this.session.selectTool('markers');
    } else if (t?.kind === 'hq') {
      editor.select({ kind: 'hq' });
      this.session.selectTool('markers');
    } else if ((t?.kind === 'edge' || t?.kind === 'node') && t.id) {
      editor.select({ kind: t.kind, id: t.id });
      this.session.selectTool('paths');
      this.session.patchSettings((s) => (s.paths.mode = 'edit'));
    } else if (t?.kind === 'object' && t.id) {
      editor.select({ kind: 'objects', ids: [t.id] });
      this.session.selectTool('objects');
      this.session.patchSettings((s) => (s.objects.mode = 'select'));
    }
    if (issue.focus) vp.focusOn(issue.focus, 80);
  }

  close(): void {
    this.session.issues.set(null);
  }
}
