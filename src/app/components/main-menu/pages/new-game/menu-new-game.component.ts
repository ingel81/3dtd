import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { MainMenuService } from '../../main-menu.service';
import { UIStore } from '../../../../store/ui.store';
import { LocationChangeCoordinatorService } from '../../../../services/location/location-change-coordinator.service';
import type { PlaceChoice } from '../../../../services/location/place-choice';
import { PlacePickerComponent } from './place-picker.component';

/**
 * The menu's New game page: where to play (the place picker), loaded behind
 * the menu. Before the first place the choice goes to the waiting start and
 * the menu goes back to its list, where the load shows; in a game the menu
 * steps aside and the change runs as before (LocationChangeCoordinatorService
 * .choosePlace). A coop guest's map is the host's: no choice there.
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
    if (this.coordinator.awaitingStartChoice()) this.menu.back();
    else this.menu.close();
    void this.coordinator.choosePlace(choice);
  }
}
