import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { MainMenuService } from '../../main-menu.service';
import { UIStore } from '../../../../store/ui.store';
import { LocationChangeCoordinatorService } from '../../../../services/location/location-change-coordinator.service';
import type { PlaceChoice } from '../../../../services/location/place-choice';
import { RovingGroupDirective } from '../../../roving-group.directive';
import { WorldContext } from '../../../../world/world-context.service';
import { WorldChoiceService } from '../../../../world/world-choice.service';
import { CUSTOM_MAPS_OPEN } from '../../../../world/custom-maps-open';
import { MapPickerComponent } from './map-picker.component';
import { PlacePickerComponent } from './place-picker.component';

/** What the page shows: real places of the 3D tiles, or the maps */
export type NewGameView = 'places' | 'maps';

/**
 * The menu's New game page: where to play, a real place (the place picker,
 * loaded behind the menu) or a map (the map picker, which loads the page
 * on it). A place goes to LocationChangeCoordinatorService.choosePlace
 * (the waiting start, or a change in a game) and the menu goes to its
 * start list, where the loading plate shows and Play starts the new place;
 * a change that did not come about leaves Continue to the old one. On a
 * world without real places (a custom map) the places view offers the way
 * back to them. A coop guest's map is the host's: no choice there.
 */
@Component({
  selector: 'app-menu-new-game',
  standalone: true,
  imports: [PlacePickerComponent, MapPickerComponent, RovingGroupDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ui.coopMapLocked()) {
      <p class="td-note">The host picks the place of this room.</p>
    } @else {
      <div class="td-stack">
        <div class="td-seg" role="tablist" aria-label="Where to play" tdRovingGroup>
          <button type="button" role="tab" id="td-play-tab-places" aria-controls="td-play-panel"
                  [attr.aria-selected]="view() === 'places'" (click)="view.set('places')">Real places</button>
          <button type="button" role="tab" id="td-play-tab-maps" aria-controls="td-play-panel"
                  [attr.aria-selected]="view() === 'maps'" [disabled]="!mapsOpen && view() !== 'maps'"
                  [attr.title]="mapsOpen ? null : 'Coming soon'" (click)="view.set('maps')">Maps</button>
        </div>
        <div role="tabpanel" id="td-play-panel" class="td-stack" [attr.aria-labelledby]="'td-play-tab-' + view()">
          @if (view() === 'maps') {
            <app-map-picker />
          } @else if (world.capabilities().realPlace) {
            <app-place-picker (chosen)="choose($event)" />
          } @else {
            <section class="td-group">
              <p class="td-note">This game plays on a map. Real places load the 3D tiles again and ask where.</p>
              <div class="td-actions">
                <button type="button" class="td-btn-primary" (click)="worlds.playRealPlaces()">Play on real places</button>
              </div>
            </section>
          }
        </div>
      </div>
    }
  `,
})
export class MenuNewGameComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  readonly ui = inject(UIStore);
  readonly world = inject(WorldContext);
  readonly worlds = inject(WorldChoiceService);
  /** The maps open; until their release the tab shows disabled (but not on a map the page already plays) */
  readonly mapsOpen = inject(CUSTOM_MAPS_OPEN);
  private readonly menu = inject(MainMenuService);
  private readonly coordinator = inject(LocationChangeCoordinatorService);

  /** The places first on a world with real places (the tiles, an own tileset), else the maps */
  readonly view = signal<NewGameView>(this.world.capabilities().realPlace ? 'places' : 'maps');

  choose(choice: PlaceChoice): void {
    this.menu.home('start');
    void this.coordinator.choosePlace(choice);
  }
}
