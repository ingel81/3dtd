import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { SaveSlotsComponent } from '../save-load/save-slots.component';

/** The menu's Save page: the slots to save the run in. */
@Component({
  selector: 'app-menu-save',
  standalone: true,
  imports: [SaveSlotsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-save-slots mode="save" />`,
})
export class MenuSaveComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
}
