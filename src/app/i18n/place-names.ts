import type { Messages } from './messages/en';

/**
 * The fixed English names a place, a world or a spawn carries as data
 * (TODO E245, docs/I18N_PLAN.md 4.2): the location before its address
 * comes, a spawn on a street without a name, DevWorld. They stay English
 * where they are kept (saves, recent places, the world package, the run
 * log), so every player and every language holds the same words; the HUD
 * words them on display. Any other name is the place's own and shows as
 * it is.
 */
const FIXED: Readonly<Record<string, keyof Messages['places']['fixed']>> = {
  'Loading...': 'loading',
  'Map center': 'mapCenter',
  'Random Spawn': 'randomSpawn',
  'Fallback Spawn': 'fallbackSpawn',
  Spawn: 'spawn',
  'Unknown location': 'unknown',
  'No location': 'none',
  'Unnamed Street': 'unnamedStreet',
  'Dev world': 'devWorld',
};

/** A place's or a spawn's name in the player's words where it is one of the game's own, else as it is */
export function placeName(t: Messages, name: string): string {
  const key = Object.hasOwn(FIXED, name) ? FIXED[name] : undefined;
  return key ? t.places.fixed[key] : name;
}

/** The fixed names, for the spec that holds them equal to where they are made */
export const FIXED_PLACE_NAMES: readonly string[] = Object.keys(FIXED);
