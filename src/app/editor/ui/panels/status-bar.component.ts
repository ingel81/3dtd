import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EditorSession } from '../editor-session.service';

/** The foot line: what the tool does, where the pointer is, what the map costs */
@Component({
  selector: 'app-editor-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-topbar' },
  template: `
    <span class="sb-hint td-trunc">{{ session.hint() }}</span>
    @if (session.hover(); as h) {
      <span class="td-num" data-test="cursor">{{ round(h.x) }}, {{ round(h.y) }} m</span>
      <span class="td-num">height {{ h.height.toFixed(1) }} m</span>
      <span class="sb-mat td-trunc">{{ h.material }}</span>
    }
    <span class="td-num">{{ objects() }} objects</span>
    @if (session.stats(); as s) {
      <span class="td-num">{{ thousands(s.triangles) }} triangles</span>
      <span class="td-num" data-test="fps">{{ s.fps }} fps</span>
    }
  `,
  styles: [
    `:host { height: 30px; gap: 16px; padding: 0 12px; font-size: var(--td-fs-small); color: var(--td-text-muted); }
     .sb-hint { flex: 1 1 auto; color: var(--td-text-secondary); }
     .sb-mat { max-width: 120px; }`,
  ],
})
export class StatusBarComponent {
  readonly session = inject(EditorSession);
  readonly objects = computed(() => (this.session.docRev(), this.session.doc?.objects.length ?? 0));

  round(v: number): number {
    return Math.round(v);
  }

  thousands(n: number): string {
    return n >= 10000 ? `${Math.round(n / 1000)}k` : String(n);
  }
}
