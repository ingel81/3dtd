import { isSamePlace, type RecentLocation } from '../../services/location/recent-locations';
import type { SavedSpawn } from '../../models/location.types';
import { coordKey } from '../../utils/geo-utils';
import { shortPlaceName } from '../../services/save-game/slot-name';
import type { SaveSlotInfo } from '../../services/save-game/save-game.port';

/** A place the start may load when the link names none (startPlaceGuess) */
export interface StartPlaceGuess {
  hq: { lat: number; lon: number };
  spawns: SavedSpawn[];
  /** Where it came from */
  source: 'last run' | 'last played';
}

/**
 * The autosave stands at another place than the one loaded (E120): by the
 * HQ at the URL's precision, the way a coop guest tells a host's place
 * (WorldPackageLoader.sameHq); by the place's name for a slot without its
 * HQ. False with no place loaded: there is nothing to leave.
 */
export function autosaveElsewhere(
  autosave: SaveSlotInfo,
  here: { hq: { lat: number; lon: number } | null; name: string },
): boolean {
  if (!here.hq) return false;
  const hq = autosave.hq;
  if (hq) return coordKey(hq) !== coordKey(here.hq);
  return shortPlaceName(autosave.location) !== shortPlaceName(here.name);
}

/**
 * The place a start without a link loads behind the main menu
 * (docs/MAIN_MENU_UI_PLAN.md, Menü 5): the autosave's, with the spawns its
 * entry on the recent list has (all lanes of the run), so Continue is quick;
 * else the last one played; none for an invite link (`?room=`), which loads
 * the host's, and none for a first visit: the menu asks.
 */
export function startPlaceGuess(
  autosave: SaveSlotInfo | null,
  recents: readonly RecentLocation[],
  search: string,
): StartPlaceGuess | null {
  if (new URLSearchParams(search).has('room')) return null;
  const autosaveHq = autosave?.hq ?? null;
  if (autosaveHq) {
    const recent = recents.find((entry) => isSamePlace(entry.hq, autosaveHq));
    return { hq: autosaveHq, spawns: recent?.spawns ?? [], source: 'last run' };
  }
  const [last] = recents;
  return last ? { hq: last.hq, spawns: last.spawns, source: 'last played' } : null;
}
