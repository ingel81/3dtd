import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { MainMenuService } from './main-menu.service';
import { MENU_PAGE_TITLES } from './menu-page';
import { MenuHomeComponent } from './pages/home/menu-home.component';
import { MenuNewGameComponent } from './pages/new-game/menu-new-game.component';
import { MenuCoopComponent } from './pages/coop/menu-coop.component';
import { MenuSaveComponent } from './pages/save/menu-save.component';
import { MenuLoadComponent } from './pages/load/menu-load.component';
import { MenuSettingsComponent } from './pages/settings/menu-settings.component';
import { MenuExtrasComponent } from './pages/extras/menu-extras.component';

/**
 * The main menu (docs/MAIN_MENU_UI_PLAN.md): one place for everything that
 * is not playing. An overlay in the game's template, not a MatDialog, so its
 * pages reach the game's services. The list stands left under the logo, a
 * page opens as a plate beside it.
 *
 * A modal dialog named by the page showing: the focus stays inside
 * (cdkTrapFocus) and goes back where it was when the menu closes. Esc steps
 * back (MainMenuService.back): page, list, and from the list in the game
 * back to the game.
 */
@Component({
  selector: 'app-main-menu',
  standalone: true,
  imports: [
    CdkTrapFocus,
    MenuHomeComponent,
    MenuNewGameComponent,
    MenuCoopComponent,
    MenuSaveComponent,
    MenuLoadComponent,
    MenuSettingsComponent,
    MenuExtrasComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './main-menu.component.html',
  styleUrl: './main-menu.component.scss',
})
export class MainMenuComponent {
  readonly menu = inject(MainMenuService);
  readonly layer = this.menu.layer;
  readonly page = this.menu.page;
  readonly title = computed(() => MENU_PAGE_TITLES[this.page()]);

  /** Esc: one step back; on the start list it does nothing, there is no game behind it */
  onEscape(event: Event): void {
    if (this.menu.back()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
}
