import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';

/** The menu's Load page: the slots and a file to load a run from. */
@Component({
  selector: 'app-menu-load',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class MenuLoadComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
}
