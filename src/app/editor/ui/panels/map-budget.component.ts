import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { EditorSession } from '../editor-session.service';
import { mapBudget, mapSceneCost } from '../../validation/map-budget';

/** The Map panel's budget: the objects' scene cost against what keeps a map fluid, the file against what coop sends */
@Component({
  selector: 'app-map-budget',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'td-group', 'data-test': 'map-budget' },
  template: `
    <h3 class="td-section">Budget</h3>
    @for (b of budget(); track b.label) {
      <div class="mb-line">
        <span>{{ b.label }}</span>
        <span class="td-note td-num" [class.is-warn]="b.state === 'warn'" [class.is-error]="b.state === 'over'">{{ b.text }}</span>
      </div>
      <div class="td-progress" aria-hidden="true"><i [style.width.%]="b.share * 100"></i></div>
      @if (b.detail) {
        <span class="td-note td-num">{{ b.detail }}</span>
      }
    }
    <p class="td-note">{{ note() }}</p>
  `,
  styles: [`.mb-line { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }`],
})
export class MapBudgetComponent {
  private readonly session = inject(EditorSession);

  /** The file as the last manual save packed it (the one a coop room sends); autosaves pack lighter */
  private readonly fileBytes = computed(() => this.session.versions().find((v) => v.manual)?.size ?? null);
  readonly budget = computed(() => {
    this.session.docRev();
    const doc = this.session.doc;
    return mapBudget(doc ? mapSceneCost(doc, this.session.catalog()) : 0, doc?.objects.length ?? 0, this.fileBytes());
  });
  readonly note = computed(() => {
    const over = this.budget().find((b) => b.state === 'over');
    if (over?.label === 'Scene cost') return 'More than a map draws fluidly: thin out buildings, trees and props first, grass and flowers cost little.';
    if (over?.label === 'File') return 'Too big to send in coop: only players who have the map can join.';
    return this.fileBytes() === null
      ? 'Scene cost: what the objects draw, by triangles and view distance; up to 100 % the map stays fluid. Save (Ctrl+S) to measure the file; coop sends up to 32 MB.'
      : 'Scene cost: what the objects draw, by triangles and view distance; up to 100 % the map stays fluid. The file as of the last Ctrl+S (autosaves pack lighter); coop sends up to 32 MB.';
  });
}
