import type { Messages } from '../../i18n/messages/en';
import { say, type Said } from '../../i18n/said';
import type { CustomMapDocument } from './map-document';
import { MapFileError, MapStoreError } from './map-file-kind';

/**
 * What the checks of a map file say, as data (TODO E245, docs/I18N_PLAN.md
 * 4.8): the key of a sentence in `mapFile.says` with its values. Reading a
 * file runs in a worker and for the agents; whoever shows a problem words
 * it, the editor and the game in the player's language, the agents and the
 * logs in English. Field names (`meta.id`, `gameplay.lanes`) and the file's
 * own values stay as the file has them, in every language.
 */

/** A thing of a map file a sentence names; without `id`, the kind of thing ("a river") */
export interface MapThing {
  kind: MapThingKind;
  id?: string | number;
}

export type MapThingKind =
  | 'node' | 'edge' | 'spawn' | 'hq' | 'water' | 'waterBody' | 'river' | 'object' | 'groundLayer' | 'lifeArea'
  | 'surface' | 'prefab' | 'waveEvent' | 'building' | 'marking';

/** The unit after a range */
export type MapUnit = 'none' | 'm' | 'percent' | 'degrees';

/** A binary of the file that can be missing */
export type MapFilePart = 'heights' | 'splat' | 'water' | 'waterBody' | 'prefabHeights' | 'prefabPaint' | 'prefabWater';

/** What a sentence is about: a field of the file by its name, or a thing */
export type MapRef = string | MapThing;

type Says = Messages['mapFile']['says'];

/** One sentence of a check, of `of` when it is one thing's (`life area 3: density must be 0.2 to 4`) */
export type MapText = Said<Says> & { of?: MapThing };

/** What reading did about a problem it names */
export type MapOutcome = keyof Messages['mapFile']['then'];

/** A sentence in the language of `t` */
export function mapText(t: Messages, text: MapText): string {
  const body = say(t.mapFile.says, text);
  return text.of ? t.mapFile.of(t.mapFile.thing(text.of), body) : body;
}

/** A sentence and what reading did about it */
export function mapOutcomeText(t: Messages, text: MapText, then?: MapOutcome): string {
  const line = mapText(t, text);
  return then ? t.mapFile.then[then](line) : line;
}

/** The part of the document a problem lies in: where the editor sends the player to fix it */
export type MapProblemPart = Exclude<keyof CustomMapDocument, 'format' | 'version'>;

/** One problem of a document: what it says, what reading does about it, the part it lies in and, where it is one thing, that thing */
export interface MapProblem {
  text: MapText;
  then?: MapOutcome;
  part: MapProblemPart;
  at?: { kind: 'object' | 'node' | 'edge' | 'spawn' | 'hq'; id?: string };
}

export function mapProblemText(t: Messages, problem: MapProblem): string {
  return mapOutcomeText(t, problem.text, problem.then);
}

/**
 * Why a file is no map (MapFileError): a sentence of `mapFile.errors`, or a
 * map whose structure does not hold, with its problems
 */
export type MapFault = Said<Messages['mapFile']['errors']> | { key: 'invalid' | 'broken' };

export function mapFaultText(t: Messages, fault: MapFault, problems: readonly MapProblem[]): string {
  if (fault.key === 'invalid' || fault.key === 'broken') return t.mapFile[fault.key](problems.length ? mapProblemText(t, problems[0]) : '');
  return say(t.mapFile.errors, fault as Said<Messages['mapFile']['errors']>);
}

/** What the map store says */
export type MapStoreText = Said<Messages['mapFile']['store']>;

/** What went wrong with a map, for the player: a MapFileError worded in the language of `t`, another error by its message */
export function mapErrorMessage(t: Messages, error: unknown): string {
  if (error instanceof MapFileError) return mapFaultText(t, error.fault, error.problems);
  if (error instanceof MapStoreError) return say(t.mapFile.store, error.said);
  return error instanceof Error ? error.message : String(error);
}
