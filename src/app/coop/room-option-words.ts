import type { Messages } from '../i18n/messages/en';
import type { RoomOptionKey } from './room-options';

/**
 * The words of a room option's value in the player's language (the game's
 * `coop.options`), the value itself where it has none. Apart from
 * room-options.ts, which the relay imports and which knows only the values.
 */
export function optionLabel(t: Messages, key: RoomOptionKey, value: string): string {
  const words: Readonly<Record<string, string>> = t.coop.options[key];
  return value !== 'label' && Object.hasOwn(words, value) ? words[value] : value;
}
