import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { MainMenuService } from '../../main-menu.service';
import { SaveSlotsComponent } from '../save-load/save-slots.component';

/**
 * The menu's Load page: the slots and a file to load a run from. A load
 * that went through without a word to say plays (MainMenuService.requestPlay:
 * at once, or once its place stands); the run stands before its next wave.
 */
@Component({
  selector: 'app-menu-load',
  standalone: true,
  imports: [SaveSlotsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-save-slots mode="load" (loaded)="menu.requestPlay()" />`,
})
export class MenuLoadComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  readonly menu = inject(MainMenuService);
}
