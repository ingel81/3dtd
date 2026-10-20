import { en, type Messages } from './messages/en';

/**
 * The shipped maps' names and descriptions in the player's language (TODO
 * E245, docs/I18N_PLAN.md 4.7). `public/maps/index.json` and the maps
 * themselves stay English (their hashes and `maps:bake` untouched); the
 * lists look the words up here by the map's id. A map of another origin
 * shows what its author wrote.
 */
export type ShippedMapId = keyof Messages['maps'];

export function isShippedMapId(id: string): id is ShippedMapId {
  return Object.prototype.hasOwnProperty.call(en.maps, id);
}

/** A shipped map's words, null for an id the game does not ship */
export function shippedMap(t: Messages, id: string): { name: string; description: string } | null {
  return isShippedMapId(id) ? t.maps[id] : null;
}

/** A shipped map named by its English name (a copy says what it is a copy of by name): its name in the player's language */
export function shippedMapName(t: Messages, englishName: string): string {
  const id = (Object.keys(en.maps) as ShippedMapId[]).find((key) => en.maps[key].name === englishName);
  return id ? t.maps[id].name : englishName;
}
