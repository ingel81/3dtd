import { effect, inject, untracked } from '@angular/core';
import { COOP } from '../../../services/coop.token';
import { SAVE_GAME } from '../../../services/save-game/save-game.port';
import { LocationChangeCoordinatorService } from '../../../services/location/location-change-coordinator.service';
import { storedPlace } from '../../../services/location/place-choice';

/**
 * A start without a place takes the place another way brings: the host's
 * place once a coop guest joined from the menu (E30), or the place of a save
 * loaded before the first (SAVE_GAME.startPlace, E110). Either goes to the
 * waiting start as a stored place with every spawn. Called in the injection
 * context of the menu, which stands while the start waits.
 */
export function followStartPlaces(): void {
  const coordinator = inject(LocationChangeCoordinatorService);
  const saves = inject(SAVE_GAME);
  const coop = inject(COOP, { optional: true });
  effect(() => {
    const place = saves.startPlace() ?? coop?.hostPlace() ?? null;
    if (!place || !coordinator.awaitingStartChoice()) return;
    untracked(() => void coordinator.choosePlace(storedPlace(place.hq, place.spawns)));
  });
}
