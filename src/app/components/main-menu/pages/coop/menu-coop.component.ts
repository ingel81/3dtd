import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import type { MenuLayer } from '../../menu-page';
import { MainMenuService } from '../../main-menu.service';
import { UIStore } from '../../../../store/ui.store';
import { COOP } from '../../../../services/coop.token';
import { CoopWaysComponent } from './coop-ways.component';
import { CoopAppHintComponent } from './coop-app-hint.component';

/**
 * The menu's Coop page: host online, join online, same network
 * (CoopWaysComponent); in a browser on the site only the pointer to the
 * desktop app (E114). Hosting or joining hands over to the coop dock: once
 * a room is entered the menu plays (MainMenuService.requestPlay) as soon as
 * the place stands, and the dock (opened by the CoopService) holds the
 * lobby. Until then the start menu with its loading plate stays in front:
 * a guest without a place waits for the host's (followStartPlaces), an
 * invite link for its map.
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
})
export class MenuCoopComponent {
  /** The layer the menu stands in: some entries differ before a run and in it */
  readonly layer = input.required<MenuLayer>();
  readonly menu = inject(MainMenuService);
  readonly coop = inject(COOP, { optional: true });
  private readonly ui = inject(UIStore);

  /** A room was entered from here: the game shows once the place stands */
  private readonly playWhenPlaced = signal(false);

  constructor() {
    const coop = this.coop;
    if (!coop) return;
    // Entered a room: the dock (opened by the CoopService) takes over once the place stands. A guest
    // without a place of their own waits for the host's to be chosen (followStartPlaces) and to load,
    // an invite link's for its map to load; the start menu with its plate stays in front meanwhile.
    let inRoom = coop.room() !== null;
    effect(() => {
      const now = coop.room() !== null;
      if (now && !inRoom) untracked(() => this.playWhenPlaced.set(true));
      inRoom = now;
    });
    effect(() => {
      if (!this.playWhenPlaced() || !this.menu.hasPlace()) return;
      untracked(() => {
        this.playWhenPlaced.set(false);
        this.menu.requestPlay();
      });
    });
  }

  openRoom(): void {
    this.ui.coopDockOpen.set(true);
    this.menu.close();
  }
}
