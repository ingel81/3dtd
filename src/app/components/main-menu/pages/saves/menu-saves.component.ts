import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { MainMenuService } from '../../main-menu.service';
import { SAVE_GAME } from '../../../../services/save-game/save-game.port';
import { SaveSlotsComponent } from '../save-load/save-slots.component';
import { RovingGroupDirective } from '../../../roving-group.directive';
import { injectT } from '../../../../i18n/i18n.service';

/**
 * The menu's Saves page: Save and Load as two tabs of one page (the slots,
 * a file in and out), and the run's own way to start over. Save is the
 * first tab while saving is possible, else Load. A load that went through
 * without a word to say plays (MainMenuService.requestPlay); the run
 * stands before its next wave.
 */
@Component({
  selector: 'app-menu-saves',
  standalone: true,
  imports: [SaveSlotsComponent, RovingGroupDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="td-seg" role="tablist" [attr.aria-label]="t().menu.savesTabs" tdRovingGroup>
      <button type="button" role="tab" [attr.aria-selected]="tab() === 'save'" (click)="tab.set('save')" data-tab="save">{{ t().menu.save }}</button>
      <button type="button" role="tab" [attr.aria-selected]="tab() === 'load'" (click)="tab.set('load')" data-tab="load">{{ t().menu.load }}</button>
    </div>
    @if (tab() === 'save') {
      <app-save-slots mode="save" />
    } @else {
      <app-save-slots mode="load" (loaded)="menu.requestPlay()" />
    }
    @if (menu.canRestart() && layer() === 'pause') {
      <section class="td-group td-line-top" [attr.aria-label]="t().menu.thisRun">
        @if (asking()) {
          <p class="td-text">{{ t().menu.restartAsk }}</p>
          <div class="td-actions is-start">
            <button type="button" class="td-btn-primary" (click)="restart()">{{ t().menu.restart }}</button>
            <button type="button" class="td-btn-secondary" (click)="asking.set(false)">{{ t().common.cancel }}</button>
          </div>
        } @else {
          <div class="td-actions is-start">
            <button type="button" class="td-btn-secondary td-btn-sm" (click)="askRestart()" data-test="restart">{{ menu.restartLabel() }}</button>
          </div>
        }
      </section>
    }
  `,
  host: { class: 'td-stack is-loose' },
})
export class MenuSavesComponent {
  /** The layer the menu stands in: Restart only over a game */
  readonly layer = input.required<MenuLayer>();
  readonly menu = inject(MainMenuService);
  protected readonly t = injectT();
  private readonly saves = inject(SAVE_GAME);
  readonly tab = signal<'save' | 'load'>(this.saves.canSave() ? 'save' : 'load');
  /** Restart asks first while a run is under way */
  readonly asking = signal(false);

  askRestart(): void {
    if (this.menu.underWay()) this.asking.set(true);
    else this.restart();
  }

  restart(): void {
    this.asking.set(false);
    this.menu.restart();
  }
}
