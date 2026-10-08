import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';

/** The menu's Save page: the slots to save the run in. */
@Component({
  selector: 'app-menu-save',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class MenuSaveComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
}
