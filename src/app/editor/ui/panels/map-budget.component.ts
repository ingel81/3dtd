import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EditorSession } from '../editor-session.service';
import { panelRev } from './panel-shown';
import { mapBudget, mapSceneCost } from '../../../map-ops/validation/map-budget';
import { injectT } from '../../../i18n/i18n.service';

/** The Map panel's budget: the objects' scene cost against what keeps a map fluid, the file against what coop sends */
@Component({
  selector: 'app-map-budget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-group', 'data-test': 'map-budget' },
  template: `
    <h3 class="td-section">{{ t().editor.budget.title }}</h3>
    @for (b of budget(); track b.kind) {
      <div class="mb-line">
        <span>{{ t().editor.budget[b.kind] }}</span>
        <span class="td-note td-num" [class.is-warn]="b.state === 'warn'" [class.is-error]="b.state === 'over'">{{ b.kind === 'scene' ? t().editor.budget.percent(b.share) : t().editor.budget.fileText(b.used, b.limit) }}</span>
      </div>
      <div class="td-progress" aria-hidden="true"><i [style.width.%]="b.share * 100"></i></div>
      @if (b.objects !== undefined) {
        <span class="td-note td-num">{{ t().editor.budget.objects(b.objects) }}</span>
      }
    }
    <p class="td-note">{{ note() }}</p>
  `,
  styles: [`.mb-line { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }`],
})
export class MapBudgetComponent {
  protected readonly t = injectT();
  private readonly session = inject(EditorSession);
  /** The revision of the map's parts this panel shows, while it is in sight (PanelShown) */
  private readonly rev = panelRev('objects', 'terrain');

  /** The file as the last manual save packed it (the one a coop room sends); autosaves pack lighter */
  private readonly fileBytes = computed(() => this.session.saves.versions().find((v) => v.manual)?.size ?? null);
  readonly budget = computed(() => {
    this.rev();
    const doc = this.session.doc;
    return mapBudget(doc ? mapSceneCost(doc, this.session.catalog()) : 0, doc?.objects.length ?? 0, this.fileBytes());
  });
  readonly note = computed(() => {
    const says = this.t().editor.budget;
    const over = this.budget().find((b) => b.state === 'over');
    if (over) return over.kind === 'scene' ? says.sceneOver : says.fileOver;
    return this.fileBytes() === null ? says.noteUnsaved : says.noteSaved;
  });
}
