import type { Messages } from '../../i18n/messages/en';

/**
 * What a map check says, as data: the key of a sentence in the dictionary
 * (i18n `check.issues`) and its values. The check runs in the editor's
 * worker and for the agents; whoever shows it words it, the editor in the
 * player's language, the agents in English (TODO E245).
 */

/** A thing of the map an issue names: the HQ, a spawn, a road by its number, a water */
export type CheckThing =
  | { kind: 'hq' }
  | { kind: 'spawn'; name: string }
  | { kind: 'road' | 'path' | 'bridge'; n: number }
  | { kind: 'main-water'; water: string }
  | { kind: 'water-body'; n: number; water: string }
  | { kind: 'main-water-short' }
  | { kind: 'body' | 'river' | 'lava-flow'; n: number };

type Issues = Messages['check']['issues'];

/** One sentence of the check with its values, typed by the dictionary's own signature */
export type CheckText = {
  [K in keyof Issues]: Parameters<Issues[K]> extends [] ? { key: K } : { key: K; v: Parameters<Issues[K]>[0] };
}[keyof Issues];

/** The sentence in the language of `t` */
export function checkText(t: Messages, text: CheckText): string {
  const say = t.check.issues[text.key] as (v?: unknown) => string;
  return say('v' in text ? text.v : undefined);
}
