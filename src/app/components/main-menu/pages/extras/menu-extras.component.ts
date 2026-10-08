import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { MainMenuService } from '../../main-menu.service';
import { ExtrasListComponent } from './extras-list.component';

/** The menu's Extras page: replays and runs, what's new, keys, credits, legal. A replay that starts closes the menu. */
@Component({
  selector: 'app-menu-extras',
  standalone: true,
  imports: [ExtrasListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-extras-list (leave)="menu.close()" />`,
})
export class MenuExtrasComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  readonly menu = inject(MainMenuService);
}
