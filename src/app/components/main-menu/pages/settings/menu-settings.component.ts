import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { MainMenuService } from '../../main-menu.service';
import { SettingsSectionsComponent } from './settings-sections.component';

/**
 * The menu's Settings page: audio, graphics, gameplay, map key, coop,
 * privacy. "Change key" makes way for the key step in a game; before a run
 * the menu stays, the key step stands in front of it.
 */
@Component({
  selector: 'app-menu-settings',
  standalone: true,
  imports: [SettingsSectionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-settings-sections (leave)="makeWay()" />`,
})
export class MenuSettingsComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  private readonly menu = inject(MainMenuService);

  makeWay(): void {
    if (this.layer() === 'pause') this.menu.close();
  }
}
