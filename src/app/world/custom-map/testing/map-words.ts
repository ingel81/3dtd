import { en } from '../../../i18n/messages/en';
import { mapErrorMessage, mapProblemText, mapText, type MapProblem, type MapText } from '../map-text';

/*
 * The map checks' sentences in English, for the specs: the checks say what
 * they find as data (map-text.ts), the specs read it as the player would.
 */

/** Problems or sentences in English */
export function words(list: readonly (MapProblem | MapText)[]): string[] {
  return list.map((q) => ('part' in q ? mapProblemText(en, q) : mapText(en, q)));
}

/** One sentence in English, null for none */
export function wordsOf(text: MapText | null | undefined): string | null {
  return text ? mapText(en, text) : null;
}

/** What `fn` throws, in English words; empty when it throws nothing */
export function errorWords(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return mapErrorMessage(en, e);
  }
  return '';
}

/** What `promise` rejects with, in English words; empty when it resolves */
export async function rejectionWords(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return mapErrorMessage(en, e);
  }
  return '';
}
