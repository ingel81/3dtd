import { ChangeDetectionStrategy, Component, booleanAttribute, computed, inject, input } from '@angular/core';
import { TdIconComponent } from '../components/icon/icon.component';
import type { WorldId } from './world-rules';
import { WorldsStageService, continueLine, type StageContinue } from './worlds-stage.service';
import { injectT } from '../i18n/i18n.service';

/**
 * The first row of a world's menu (docs/WORLDS_STATE_PLAN.md, 3.3): the
 * world's Continue, or Back to the place still loaded; a run's Continue has
 * Discard beside it, which asks first. Nothing when the world has neither.
 *
 * `block`: the running game as one sunken block (Built Worlds): its map's
 * picture, "Running game", the map's name, "Wave 2 | today 9:41 AM", then
 * Continue as the main button and Discard as a stone with the bin.
 */
@Component({
  selector: 'app-stage-continue',
  standalone: true,
  imports: [TdIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (item(); as it) {
      @let w = t().worlds;
      @if (block()) {
        <div class="td-well is-deep sc-block" data-test="running-game">
          @if (picture(); as src) {
            <img class="sc-thumb" [src]="src" alt="" />
          } @else {
            <span class="sc-thumb td-well" aria-hidden="true"></span>
          }
          <div class="sc-text">
            <span class="td-caps td-trunc">{{ it.kind === 'back' ? w.stillLoaded : w.runningGame }}</span>
            <span class="td-name">{{ it.name }}</span>
            <span class="td-note td-num td-trunc" [class.is-warn]="!!why()" [attr.title]="why()">{{ why() ?? sub(it) }}</span>
          </div>
          <button type="button" class="td-btn-primary" data-stage-continue [attr.aria-disabled]="why() ? true : null"
                  [attr.title]="why()" (click)="stage.resume(it)">
            <td-icon name="play" [size]="12" /><span>{{ it.kind === 'back' ? w.backToGame : w.continue }}</span>
          </button>
          @if (it.run) {
            <button type="button" class="td-icon-btn" data-stage-discard [attr.aria-label]="w.discardLine(it.line)" [attr.title]="w.discardRun"
                    (click)="stage.discard(it)">
              <td-icon name="trash" [size]="16" />
            </button>
          }
        </div>
      } @else {
        <div class="td-rows">
          <div class="sc-row">
            <button type="button" class="td-row sc-main" data-stage-continue [attr.aria-disabled]="why() ? true : null"
                    [attr.title]="why()" (click)="stage.resume(it)">
              <span class="td-name">{{ it.label }}</span>
              <span class="td-note td-num" [class.is-warn]="!!why()">{{ why() ?? line(it) }}</span>
            </button>
            @if (it.run) {
              <button type="button" class="td-tool" data-stage-discard [attr.aria-label]="w.discardLine(it.line)" [attr.title]="w.discardRun"
                      (click)="stage.discard(it)">
                <td-icon name="trash" [size]="16" />
              </button>
            }
          </div>
        </div>
      }
    }
  `,
  styles: [`
    .sc-row { display: flex; align-items: center; gap: var(--td-sp-2); }
    .sc-main { flex: 1 1 auto; min-width: 0; justify-content: space-between; gap: var(--td-sp-3); }
    .sc-block { display: flex; align-items: center; gap: var(--td-sp-2); padding: var(--td-sp-3); }
    .sc-block > button { flex: 0 0 auto; }
    .sc-thumb { flex: 0 0 auto; width: 56px; height: 42px; margin-right: var(--td-sp-1); border-radius: var(--td-radius); object-fit: cover; }
    .sc-text { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; }
  `],
})
export class StageContinueComponent {
  readonly stage = inject(WorldsStageService);
  protected readonly t = injectT();
  readonly world = input.required<WorldId>();
  /** The running game as one block with its picture (Built Worlds), not a row */
  readonly block = input(false, { transform: booleanAttribute });
  readonly item = computed(() => this.stage.continueOf(this.world()));
  readonly why = computed(() => this.stage.whyNot('play', this.world()));
  /** The picture of the map it plays, as the list has it; null for a place */
  readonly picture = computed(() => {
    const pick = this.item()?.pick;
    return pick?.kind === 'map' ? (this.stage.maps().find((m) => m.id === pick.id)?.picture ?? null) : null;
  });

  /** "Heilbronn | wave 12 | today 6:42 PM" */
  line(go: StageContinue): string {
    return continueLine(this.t(), go);
  }

  /** Under the name in the block: "Wave 2 | today 9:41 AM", or what is left of a place still loaded */
  sub(go: StageContinue): string {
    const w = this.t().worlds;
    if (go.wave === null) return go.over ? w.runOver : w.noRunYet;
    return w.runSub(go.wave, go.at ? w.playedAt(go.at) : null);
  }
}
