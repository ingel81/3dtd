import { ChangeDetectionStrategy, Component, effect, inject, input, untracked } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { MainMenuService } from '../../main-menu.service';
import { UIStore } from '../../../../store/ui.store';
import { COOP } from '../../../../services/coop.token';
import { LocationChangeCoordinatorService } from '../../../../services/location/location-change-coordinator.service';
import { CoopWaysComponent } from './coop-ways.component';
import { CoopAppHintComponent } from './coop-app-hint.component';

/**
 * The menu's Coop page: host online, join online, same network
 * (CoopWaysComponent); in a browser on the site only the pointer to the
 * desktop app (E114). Hosting or joining hands over to the coop dock: once
 * a room is entered the menu closes and the dock (opened by the CoopService)
 * holds the lobby. A guest who joined before the first place stays in the
 * menu while the host's place loads behind it (followStartPlaces).
 */
@Component({
  selector: 'app-menu-coop',
  standalone: true,
  imports: [CoopWaysComponent, CoopAppHintComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (coop; as c) {
      @if (c.access === 'hint') {
        <app-coop-app-hint [roomCode]="c.roomFromUrl" />
      } @else {
        <app-coop-ways (changePlace)="menu.open('new-game')" (openRoom)="openRoom()" />
      }
    }
  `,
  styles: `:host { display: block; }`,
})
export class MenuCoopComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  readonly menu = inject(MainMenuService);
  readonly coop = inject(COOP, { optional: true });
  private readonly ui = inject(UIStore);
  private readonly coordinator = inject(LocationChangeCoordinatorService);

  constructor() {
    const coop = this.coop;
    if (!coop) return;
    // Entered a room from here: the dock takes over, unless the start still waits for the host's place
    let inRoom = coop.room() !== null;
    effect(() => {
      const now = coop.room() !== null;
      if (now && !inRoom && !untracked(() => this.coordinator.awaitingStartChoice())) untracked(() => this.menu.close());
      inRoom = now;
    });
  }

  openRoom(): void {
    this.ui.coopDockOpen.set(true);
    this.menu.close();
  }
}
