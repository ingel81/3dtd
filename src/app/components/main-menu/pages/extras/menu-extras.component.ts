import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';

/** The menu's Extras page: replays and runs, what's new, keys, credits, legal. */
@Component({
  selector: 'app-menu-extras',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ``,
})
export class MenuExtrasComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
}
