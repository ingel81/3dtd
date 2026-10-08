import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { MainMenuService } from '../../main-menu.service';
import { UIStore } from '../../../../store/ui.store';
import { LocationChangeCoordinatorService } from '../../../../services/location/location-change-coordinator.service';
import type { PlaceChoice } from '../../../../services/location/place-choice';
import { PlacePickerComponent } from './place-picker.component';

/**
 * The menu's New game page: where to play (the place picker), loaded behind
 * the menu. The choice goes to LocationChangeCoordinatorService.choosePlace
 * (the waiting start, or a change in a game) and the menu goes to its start
 * list, where the loading plate shows and Play starts the new place; a
 * change that did not come about leaves Continue to the old one. A coop
 * guest's map is the host's: no choice there.
 */
@Component({
  selector: 'app-menu-new-game',
  standalone: true,
  imports: [PlacePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ui.coopMapLocked()) {
      <p class="note">The host picks the place of this room.</p>
    } @else {
      <app-place-picker (chosen)="choose($event)" />
    }
  `,
  styles: `
    :host { display: block; }
    .note { margin: 0; font-size: 13px; color: var(--td-text-secondary); }
  `,
})
export class MenuNewGameComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  readonly ui = inject(UIStore);
  private readonly menu = inject(MainMenuService);
  private readonly coordinator = inject(LocationChangeCoordinatorService);

  choose(choice: PlaceChoice): void {
    this.menu.home('start');
    void this.coordinator.choosePlace(choice);
  }
}
