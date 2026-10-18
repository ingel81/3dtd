import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { MainMenuService } from '../../main-menu.service';
import { UIStore } from '../../../../store/ui.store';
import { LocationChangeCoordinatorService } from '../../../../services/location/location-change-coordinator.service';
import type { PlaceChoice } from '../../../../services/location/place-choice';
import { WorldContext } from '../../../../world/world-context.service';
import type { OsmFrameRequest } from '../../../osm-frame/osm-frame-request';
import { PlacePickerComponent } from './place-picker.component';

/**
 * The menu's New game page: another place of this world (the place picker,
 * loaded behind the menu). A place goes to
 * LocationChangeCoordinatorService.choosePlace (the waiting start, or a
 * change in a game) and the menu goes to its start list, where the loading
 * plate shows and Play starts the new place; a change that did not come
 * about leaves Continue to the old one. A map of a place opens the
 * OpenStreetMap frame on the globes, the game held behind them. Maps and the
 * other worlds are the globes' (docs/WORLDS_STATE_PLAN.md, 3.3): on a map
 * the page leads there. A coop guest's place is the host's: no choice there.
 */
@Component({
  selector: 'app-menu-new-game',
  standalone: true,
  imports: [PlacePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ui.coopMapLocked()) {
      <p class="td-note">The host picks the place of this room.</p>
    } @else if (world.capabilities().realPlace) {
      <app-place-picker (chosen)="choose($event)" (mapOfPlace)="mapOf($event)" />
      @if (menu.leaveWhy(); as why) {
        <p class="td-note">A map of a place: {{ why }}.</p>
      }
    } @else {
      <section class="td-group">
        <p class="td-note">This game plays on a map. Another map, or a real place, is picked in the worlds: the game waits behind them.</p>
        <div class="td-actions is-start">
          @if (menu.worldMenuLabel(); as name) {
            <button type="button" class="td-btn-primary" [attr.aria-disabled]="menu.leaveWhy() ? true : null" [attr.title]="menu.leaveWhy()"
                    (click)="menu.leaveTo('world')">{{ name }}</button>
          }
          <button type="button" class="td-btn-secondary" [attr.aria-disabled]="menu.leaveWhy() ? true : null" [attr.title]="menu.leaveWhy()"
                  (click)="menu.leaveTo('globes')">All worlds</button>
        </div>
      </section>
    }
  `,
})
export class MenuNewGameComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  readonly ui = inject(UIStore);
  readonly world = inject(WorldContext);
  readonly menu = inject(MainMenuService);
  private readonly coordinator = inject(LocationChangeCoordinatorService);

  /** A map of a place: its frame under OpenStreetMap on the globes, this game held behind them */
  mapOf(request: OsmFrameRequest): void {
    this.menu.makeMapOf(request);
  }

  choose(choice: PlaceChoice): void {
    this.menu.home('start');
    void this.coordinator.choosePlace(choice);
  }
}
