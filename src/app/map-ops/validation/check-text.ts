import type { Messages } from '../../i18n/messages/en';
import { mapProblemText, type MapProblem } from '../../world/custom-map/map-text';

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

/** The issues that name a problem of the map file (map-text.ts), worded inside their sentence */
type FileIssue = 'mapFile' | 'mapValues';

/** One sentence of the check with its values, typed by the dictionary's own signature */
export type CheckText =
  | {
      [K in Exclude<keyof Issues, FileIssue>]: Parameters<Issues[K]> extends [] ? { key: K } : { key: K; v: Parameters<Issues[K]>[0] };
    }[Exclude<keyof Issues, FileIssue>]
  | { key: FileIssue; v: { problem: MapProblem } };

/** The sentence in the language of `t` */
export function checkText(t: Messages, text: CheckText): string {
  if (text.key === 'mapFile' || text.key === 'mapValues') return t.check.issues[text.key]({ problem: mapProblemText(t, text.v.problem) });
  const say = t.check.issues[text.key] as (v?: unknown) => string;
  return say('v' in text ? text.v : undefined);
}
