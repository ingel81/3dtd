import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TdIconComponent } from '../components/icon/icon.component';
import type { WorldId } from './world-rules';
import { WorldsStageService } from './worlds-stage.service';

/**
 * The first row of a world's menu (docs/WORLDS_STATE_PLAN.md, 3.3): the
 * world's Continue, or Back to the place still loaded; a run's Continue has
 * Discard beside it, which asks first. Nothing when the world has neither.
 */
@Component({
  selector: 'app-stage-continue',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (item(); as it) {
      <div class="td-rows">
        <div class="sc-row">
          <button type="button" class="td-row sc-main" data-stage-continue [attr.aria-disabled]="why() ? true : null"
                  [attr.title]="why()" (click)="stage.resume(it)">
            <span class="td-name">{{ it.label }}</span>
            <span class="td-note td-num" [class.is-warn]="!!why()">{{ why() ?? it.line }}</span>
          </button>
          @if (it.run) {
            <button type="button" class="td-tool" data-stage-discard [attr.aria-label]="'Discard ' + it.line" title="Discard this run"
                    (click)="stage.discard(it)">
              <td-icon name="trash" [size]="16" />
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .sc-row { display: flex; align-items: center; gap: var(--td-sp-2); }
    .sc-main { flex: 1 1 auto; min-width: 0; justify-content: space-between; gap: var(--td-sp-3); }
  `],
})
export class StageContinueComponent {
  readonly stage = inject(WorldsStageService);
  readonly world = input.required<WorldId>();
  readonly item = computed(() => this.stage.continueOf(this.world()));
  readonly why = computed(() => this.stage.whyNot('play', this.world()));
}
