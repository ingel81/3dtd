import { en, type Messages } from './messages/en';

/**
 * The shipped maps' descriptions in the player's language (TODO E245,
 * docs/I18N_PLAN.md 4.7). A map's name is never translated: the lists show
 * it as `public/maps/index.json` has it. `index.json` and the maps
 * themselves stay English (their hashes and `maps:bake` untouched); the
 * lists look the description up here by the map's id. A map of another
 * origin shows what its author wrote.
 */
export type ShippedMapId = keyof Messages['maps'];

export function isShippedMapId(id: string): id is ShippedMapId {
  return Object.prototype.hasOwnProperty.call(en.maps, id);
}

/** A shipped map's description, null for an id the game does not ship */
export function shippedMapDescription(t: Messages, id: string): string | null {
  return isShippedMapId(id) ? t.maps[id].description : null;
}
