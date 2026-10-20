import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EditorSession } from '../editor-session.service';
import { injectT } from '../../../i18n/i18n.service';
import { catalogName } from '../../ops/describe';

/** The foot line: what the tool does, where the pointer is, what the map costs */
@Component({
  selector: 'app-editor-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-topbar' },
  template: `
    <span class="sb-hint td-trunc">{{ session.tools.hint() }}</span>
    @if (session.view.hover(); as h) {
      <span class="td-num" data-test="cursor">{{ round(h.x) }}, {{ round(h.y) }} m</span>
      <span class="td-num" data-test="height">{{ t().editor.status.height(h.height) }}</span>
      <span class="sb-mat td-trunc">{{ materialName(h.material) }}</span>
    }
    <span class="td-num" data-test="objects">{{ t().editor.status.objects(objects()) }}</span>
    @if (session.view.stats(); as s) {
      <span class="td-num">{{ t().editor.status.triangles(thousands(s.triangles)) }}</span>
      <span class="td-num" data-test="fps">{{ t().editor.status.fps(s.fps) }}</span>
    }
  `,
  styles: [
    `:host { height: 30px; gap: 16px; padding: 0 12px; font-size: var(--td-fs-small); color: var(--td-text-muted); }
     .sb-hint { flex: 1 1 auto; color: var(--td-text-secondary); }
     .sb-mat { max-width: 120px; }`,
  ],
})
export class StatusBarComponent {
  protected readonly t = injectT();
  readonly session = inject(EditorSession);
  private readonly objectsRev = this.session.state.rev('objects');
  readonly objects = computed(() => (this.objectsRev(), this.session.doc?.objects.length ?? 0));

  /** The material under the pointer in the player's words */
  materialName(id: string): string {
    return id ? catalogName(this.t(), this.session.catalog().material(id)) : '';
  }

  round(v: number): number {
    return Math.round(v);
  }

  thousands(n: number): string {
    return n >= 10000 ? `${Math.round(n / 1000)}k` : String(n);
  }
}
