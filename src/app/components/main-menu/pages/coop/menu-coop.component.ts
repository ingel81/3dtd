import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';

/** The menu's Coop page: host online, join online, same network. */
@Component({
  selector: 'app-menu-coop',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class MenuCoopComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
}
