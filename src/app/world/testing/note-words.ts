import { en } from '../../i18n/messages/en';
import { say } from '../../i18n/said';
import type { ImportNote } from '../import-notes';

/** What an import says, in English, for the specs (the import says it as data, import-notes.ts) */
export function noteWords(notes: readonly ImportNote[]): string[] {
  return notes.map((note) => say(en.importNotes, note));
}
