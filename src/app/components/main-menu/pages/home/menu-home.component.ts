import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MainMenuService } from '../../main-menu.service';
import { MENU_PAGE_TITLES, type MenuLayer, type MenuPage } from '../../menu-page';

/** The menu's list: Continue, Play, New game and the other entries. */
@Component({
  selector: 'app-menu-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="mm-list" aria-label="Menu">
      @if (layer() === 'pause') {
        <button type="button" class="mm-item" (click)="menu.close()">Continue</button>
      }
      @for (entry of pages; track entry) {
        <button type="button" class="mm-item" (click)="menu.open(entry)">{{ titles[entry] }}</button>
      }
    </nav>
  `,
})
export class MenuHomeComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  readonly menu = inject(MainMenuService);
  readonly titles = MENU_PAGE_TITLES;
  readonly pages: readonly MenuPage[] = ['new-game', 'coop', 'save', 'load', 'settings', 'extras'];
}
